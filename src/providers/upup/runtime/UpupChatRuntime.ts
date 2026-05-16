import type { ChildProcess } from 'child_process';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { UPUP_PROVIDER_CAPABILITIES } from '../capabilities';
import { getUpupProviderSettings } from '../settings';
import { UpupSessionManager, createUpupSessionManager } from './UpupSessionManager';
import { JsonSessionStore } from '../storage/UpupSessionStore';
import { UpupHistorySync } from './UpupHistorySync';
import { VaultToolHandler, VaultToolName } from '../vault/VaultToolHandler';
import { VaultWatcher } from '../vault/VaultWatcher';
import { UpupRewindService } from './UpupRewindService';

// ============ Constants ============

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

// ============ Binary Detection ============

interface BinaryLocation {
  command: string;
  args: string[];
  source: 'path' | 'node_modules' | 'bunx' | 'development' | 'explicit';
}

function detectRuntime(): 'bun' | 'node' {
  try {
    execSync('bun --version', { stdio: 'ignore', timeout: 5000 });
    return 'bun';
  } catch {
    // bun not available, assume node
    return 'node';
  }
}

function findUpupBinary(): BinaryLocation {
  // Check UPUP_BIN env var first
  if (process.env.UPUP_BIN) {
    return { command: process.env.UPUP_BIN, args: ['--stdio'], source: 'path' };
  }

  // Check PATH
  try {
    const whichResult = execSync('which upup 2>/dev/null || true', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      return { command: whichResult, args: ['--stdio'], source: 'path' };
    }
  } catch {
    // which failed, continue to fallback
  }

  // Check common global locations on macOS
  const commonPaths = [
    '/usr/local/bin/upup',
    '/opt/homebrew/bin/upup',
    path.join(process.env.HOME || '', '.local/bin/upup'),
    path.join(process.env.HOME || '', '.bun/bin/upup'),
  ];

  for (const binPath of commonPaths) {
    if (fs.existsSync(binPath)) {
      return { command: binPath, args: ['--stdio'], source: 'path' };
    }
  }

  // Fallback to bunx
  const runtime = detectRuntime();
  return { command: runtime, args: ['x', 'upup', '--stdio'], source: 'bunx' };
}

// ============ JSON-RPC Types ============

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ============ Stream Event Types ============

interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

// ============ UpupTransport ============

class UpupTransport {
  private proc: ChildProcess | null = null;
  private reader: readline.Interface | null = null;
  private requestId = 0;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private eventHandlers = new Map<string, Set<(event: unknown) => void>>();
  private messageQueue: unknown[] = [];
  private _connected = false;
  private binaryLocation: BinaryLocation | null = null;
  private debug: boolean;

  get connected(): boolean {
    return this._connected;
  }

  get binarySource(): string {
    return this.binaryLocation?.source ?? 'unknown';
  }

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
  }

  async connect(options?: { cwd?: string; env?: Record<string, string> }): Promise<void> {
    this.binaryLocation = findUpupBinary();

    if (this.debug) {
      console.log(`[UpupTransport] Using binary: ${this.binaryLocation.source}`);
      console.log(`[UpupTransport] Command: ${this.binaryLocation.command} ${this.binaryLocation.args.join(' ')}`);
    }

    // Build environment
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (options?.env) {
      Object.assign(env, options.env);
    }

    await this.startProcess(this.binaryLocation, env, options?.cwd);
  }

  private async startProcess(binary: BinaryLocation, env: Record<string, string>, cwd?: string): Promise<void> {
    this.proc = spawn(binary.command, binary.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: cwd || process.cwd(),
      windowsHide: true,
    });

    if (this.proc.stdout) {
      this.reader = readline.createInterface({ input: this.proc.stdout });
      this.reader.on('line', (line) => {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch {
            // Ignore parse errors
          }
        }
      });
    }

    this.proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        console.error('[upup stderr]', output);
      }
    });

    this.proc.on('exit', (code) => {
      console.log(`[upup exited with code ${code}]`);
      this._connected = false;
    });

    try {
      await this.request('initialize', {
        clientName: 'claudian',
        clientVersion: '1.0.0',
        capabilities: { streaming: true, tools: true },
      });
      this._connected = true;
    } catch (err) {
      this.proc.kill();
      throw new Error(`Failed to initialize upup: ${err}`, { cause: err });
    }
  }

  on(event: string, handler: (event: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) || new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  off(event: string, handler: (event: unknown) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.proc?.stdin) {
      throw new Error('upup process not running');
    }

    const id = ++this.requestId;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, (res) => {
        if (res.error) {
          reject(new Error(`${res.error.code}: ${res.error.message}`));
        } else {
          resolve(res.result);
        }
      });

      try {
        this.proc!.stdin!.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    // Response
    if ('id' in msg && msg.id !== undefined) {
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg);
      }
      return;
    }

    // Notification
    if ('method' in msg) {
      const eventName = msg.method;
      const params = msg.params as Record<string, unknown> | undefined;

      if (eventName === 'event' && params?.event) {
        // Server event
        const handlers = this.eventHandlers.get('event');
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(params.event);
            } catch (err) {
              console.error(`Handler error for event:`, err);
            }
          }
        }
      } else {
        // Other notification
        const handlers = this.eventHandlers.get(eventName);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(params);
            } catch (err) {
              console.error(`Handler error for ${eventName}:`, err);
            }
          }
        }
      }
    }
  }

  async *streamRun(params: { messages: Array<{ role: string; content: string }>; model?: string }): AsyncGenerator<ServerEvent> {
    // Extract prompt from messages
    const prompt = params.messages.find(m => m.role === 'user')?.content || 'Hello';

    // Real-time streaming: yield events immediately as they arrive
    const eventQueue: ServerEvent[] = [];
    let streamDone = false;
    let hasError = false;
    let errorMessage = '';
    let resolveNext: ((value: ServerEvent | null) => void) | null = null;

    // Register handlers BEFORE sending request to avoid race condition
    const eventHandler = (event: unknown) => {
      const e = event as ServerEvent;
      console.log('[UpupTransport] event collected:', e.type, JSON.stringify(e).slice(0, 150));

      if (resolveNext) {
        // Immediate consumer waiting - resolve immediately
        const resolve = resolveNext;
        resolveNext = null;
        resolve(e);
      } else {
        // Buffer the event
        eventQueue.push(e);
      }
    };

    const doneHandler = (data: unknown) => {
      const d = data as Record<string, unknown>;
      console.log('[UpupTransport] stream_done received:', JSON.stringify(d));
      if (d.done === true) {
        streamDone = true;
        this.off('stream_done', doneHandler);
        // Resolve any pending consumer with null to signal end
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve(null);
        }
      }
    };

    const errorHandler = (data: unknown) => {
      const d = data as Record<string, unknown>;
      hasError = true;
      errorMessage = String(d.error || 'Unknown error');
      this.off('error', errorHandler);
    };

    this.on('event', eventHandler);
    this.on('stream_done', doneHandler);
    this.on('error', errorHandler);

    // Send stream request AFTER registering handlers
    try {
      await this.request('stream', { prompt, model: params.model }) as { runId: string; status: string };
    } catch (err) {
      this.off('event', eventHandler);
      this.off('stream_done', doneHandler);
      this.off('error', errorHandler);
      throw err;
    }

    // Yield events in real-time as they arrive
    while (!streamDone) {
      if (eventQueue.length > 0) {
        // Yield buffered event immediately
        yield eventQueue.shift()!;
      } else {
        // Wait for next event
        const nextEvent = await new Promise<ServerEvent | null>((resolve) => {
          resolveNext = resolve;
        });
        if (nextEvent === null) {
          // null signals stream done
          break;
        }
        yield nextEvent;
      }
    }

    // Yield any remaining events in queue
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    // Cleanup handlers
    this.off('event', eventHandler);
    this.off('stream_done', doneHandler);
    this.off('error', errorHandler);

    // If there was an error, yield it as an event
    if (hasError) {
      yield { type: 'error', error: errorMessage } as unknown as ServerEvent;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown');
    } catch {
      // Ignore
    }
    await this.close();
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    this._connected = false;
  }
}

// ============ Event Transform ============

function transformServerEvent(event: ServerEvent, streamState: { currentToolId: string; accumulatedInput: string; partialJson: Record<string, unknown>; accumulatedText: string }): StreamChunk | null {
  switch (event.type) {
    case 'thinking':
      return { type: 'thinking', content: String(event.message || '') };

    case 'stream_progress':
      // Handle text streaming via charDelta
      if (event.mode === 'responding' && typeof event.charDelta === 'string') {
        streamState.accumulatedText += event.charDelta;
        return { type: 'text', content: event.charDelta };
      }
      // Handle tool-related stream_progress
      if (event.toolName) {
        const toolId = String(event.toolCallId || `tool-${Date.now()}`);
        if (event.partialJson) {
          streamState.currentToolId = toolId;
          streamState.partialJson = event.partialJson as Record<string, unknown>;
          return { type: 'tool_use', id: toolId, name: String(event.toolName), input: streamState.partialJson };
        }
        return { type: 'tool_use', id: toolId, name: String(event.toolName), input: {} };
      }
      return null;

    case 'tool_progress':
      // Tool-specific progress message (e.g., "Reading file...")
      if (event.tool) {
        return { type: 'tool_use', id: String(event.toolCallId || `tool-${Date.now()}`), name: String(event.tool), input: { _progress: String(event.message || '') } };
      }
      return null;

    case 'tool_start':
      return { type: 'tool_use', id: String(event.toolCallId || ''), name: String(event.tool || ''), input: (event.args || {}) as Record<string, unknown> };

    case 'tool_end':
      return { type: 'tool_result', id: String(event.toolCallId || ''), content: JSON.stringify(event.result || ''), isError: false };

    case 'tool_error':
      return { type: 'tool_result', id: String(event.toolCallId || ''), content: String(event.error || 'Unknown error'), isError: true };

    case 'tool_approval':
      return { type: 'tool_use', id: String(event.toolCallId || ''), name: String(event.tool || ''), input: (event.args || {}) as Record<string, unknown> };

    case 'tool_denied':
      return { type: 'error', content: `Tool '${event.tool}' was denied` };

    case 'done':
      // Extract answer from done event and emit as text chunk for UI display
      if (event.answer && typeof event.answer === 'string') {
        console.log('[UpupChatRuntime] done event has answer:', event.answer.slice(0, 100));
        return { type: 'text', content: event.answer };
      }
      return { type: 'done' };

    case 'error':
      return { type: 'error', content: String(event.error || 'Unknown error') };

    default:
      return null;
  }
}

// ============ UpupChatRuntime ============

export class UpupChatRuntime implements ChatRuntime {
  readonly providerId = 'upup' as const;
  private transport: UpupTransport | null = null;
  private sessionId: string | null = null;
  private readyState = false;
  private reconnectAttempts = 0;
  private vaultToolHandler: VaultToolHandler | null = null;
  private vaultWatcher: VaultWatcher | null = null;
  private rewindService: UpupRewindService | null = null;

  constructor(private plugin: ClaudianPlugin) {
    // Initialize rewind service
    this.rewindService = new UpupRewindService(plugin);
  }

  getCapabilities() {
    return UPUP_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: false,
      mcpMentions: new Set(),
    };
  }

  onReadyStateChange(_listener: (ready: boolean) => void): () => void {
    return () => {};
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  async syncConversationState(
    _conversation: ChatRuntimeConversationState | null,
    _externalContextPaths?: string[],
  ): Promise<void> {}

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    if (this.transport?.connected) {
      this.readyState = true;
      return true;
    }
    return this.attemptConnection(options);
  }

  private async attemptConnection(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    console.log('[UpupChatRuntime] attemptConnection called, force:', options?.force);
    const maxAttempts = options?.force ? MAX_RETRY_ATTEMPTS + 1 : MAX_RETRY_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log('[UpupChatRuntime] connection attempt:', attempt + 1);

        if (this.transport) {
          await this.transport.shutdown().catch(() => {});
          this.transport = null;
        }

        const settings = getUpupProviderSettings(this.plugin.settings);

        // Determine command
        let binary: BinaryLocation;

        if (settings.cliPath && settings.cliPath !== 'auto') {
          // Custom path - use as executable with --stdio
          binary = { command: settings.cliPath, args: ['--stdio'], source: 'explicit' };
        } else {
          // Auto-detect upup
          binary = findUpupBinary();
        }

        console.log('[UpupChatRuntime] using:', binary.command, binary.args.join(' '));

        // Build environment with API keys
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            env[key] = value;
          }
        }

        const envVars = getRuntimeEnvironmentVariables(this.plugin.settings, 'upup');
        for (const [key, value] of Object.entries(envVars)) {
          env[key] = value;
        }

        const apiKeyCount = Object.keys(envVars).filter(k => k.includes('API_KEY')).length;
        console.log('[UpupChatRuntime] Environment vars loaded:', apiKeyCount, 'API keys');

        // Get vault path for cwd
        const vaultPath = getVaultPath(this.plugin.app) ?? process.cwd();

        // Connect
        this.transport = new UpupTransport({ debug: false });
        await this.transport.connect({ cwd: vaultPath, env });

        console.log('[UpupChatRuntime] connection successful!');
        this.sessionId = `upup-${Date.now()}`;
        this.readyState = true;
        this.reconnectAttempts = 0;

        // Initialize vault handlers
        this.initVaultHandlers();

        return true;
      } catch (err) {
        console.error(`[UpupChatRuntime] Connection attempt ${attempt + 1} failed:`, err);
        this.reconnectAttempts++;

        if (attempt < maxAttempts - 1) {
          await this.delay(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    console.error('[UpupChatRuntime] All connection attempts exhausted');
    this.readyState = false;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize vault tool handler and watcher
   */
  private initVaultHandlers(): void {
    if (!this.vaultToolHandler) {
      this.vaultToolHandler = new VaultToolHandler(this.plugin);
      console.log('[UpupChatRuntime] VaultToolHandler initialized');
    }

    if (!this.vaultWatcher) {
      this.vaultWatcher = new VaultWatcher(this.plugin);
      this.vaultWatcher.start();
      console.log('[UpupChatRuntime] VaultWatcher started');
    }
  }

  async forceRestart(): Promise<boolean> {
    console.log('[UpupChatRuntime] Force restarting upup...');
    return this.attemptConnection({ force: true });
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!this.transport?.connected) {
      const ready = await this.ensureReady();
      if (!ready) {
        yield { type: 'error', content: 'Failed to connect to upup' };
        yield { type: 'done' };
        return;
      }
    }

    const settings = getUpupProviderSettings(this.plugin.settings);
    const model = queryOptions?.model ?? settings.model;

    // Get conversation ID from query options or generate new one
    const conversationId = (queryOptions as { conversationId?: string })?.conversationId ?? `conv-${Date.now()}`;

    // Get or create session manager for this conversation
    const sessionMgr = this.getSessionManager(conversationId);

    // Add user message to session
    sessionMgr.addUserMessage(turn.prompt);

    console.log('[UpupChatRuntime] query:', { model, conversationId, prompt: turn.prompt.slice(0, 50) });

    // Get history for context
    const history = sessionMgr.getHistory();

    // Build messages with history
    const messages = [
      ...history.slice(0, -1), // All except the new message
      { role: 'user' as const, content: turn.prompt },
    ];

    let assistantContent = '';
    let eventCount = 0;

    try {
      const streamState = {
        currentToolId: '',
        accumulatedInput: '',
        partialJson: {},
        accumulatedText: '',
      };

      for await (const event of this.transport!.streamRun({ messages, model })) {
        eventCount++;
        console.log('[UpupChatRuntime] event:', event.type, '|', JSON.stringify(event).slice(0, 200));

        // Handle vault tool interception
        if (event.type === 'tool_start' && this.vaultToolHandler) {
          const toolName = String(event.tool || '');
          const toolCallId = String(event.toolCallId || '');

          if (this.vaultToolHandler.isVaultTool(toolName)) {
            console.log('[UpupChatRuntime] intercepting vault tool:', toolName);

            // Execute tool and yield result
            const args = (event.args || {}) as Record<string, unknown>;
            const result = await this.vaultToolHandler.handleTool(toolName as VaultToolName, args);

            console.log('[UpupChatRuntime] vault tool result:', result.success ? 'OK' : 'ERROR');

            // Yield tool use chunk
            yield {
              type: 'tool_use' as const,
              id: toolCallId,
              name: toolName,
              input: args,
            };

            // Yield tool result chunk
            yield {
              type: 'tool_result' as const,
              id: toolCallId,
              content: result.content,
              isError: !result.success,
            };

            continue;
          }
        }

        // Track assistant content
        if (event.type === 'stream_progress') {
          const charDelta = (event as { charDelta?: string }).charDelta;
          if (typeof charDelta === 'string') {
            assistantContent += charDelta;
          }
        }

        const chunk = transformServerEvent(event, streamState);
        if (chunk) {
          console.log('[UpupChatRuntime] chunk:', chunk.type, '|', JSON.stringify(chunk).slice(0, 200));
          yield chunk;
        } else {
          console.log('[UpupChatRuntime] chunk: null (event type not handled)');
        }
      }

      console.log('[UpupChatRuntime] stream complete, events:', eventCount);

      // Add assistant response to session
      if (assistantContent) {
        sessionMgr.addAssistantMessage(assistantContent);
      }

      // Save session after completion
      await sessionMgr.save();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('process') || errorMessage.includes('ENOENT')) {
        console.error('[UpupChatRuntime] Connection lost, attempting reconnect...');
        this.readyState = false;
        this.transport = null;

        const reconnected = await this.ensureReady();
        if (reconnected) {
          yield { type: 'error', content: 'Connection lost and re-established. Please retry your request.' };
        } else {
          yield { type: 'error', content: `Upup error: ${err}` };
        }
      } else {
        yield { type: 'error', content: `Upup error: ${err}` };
      }
    }

    yield { type: 'done' };
  }

  cancel(): void {
    // Cancellation not yet implemented
  }

  resetSession(): void {
    this.sessionId = `upup-${Date.now()}`;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    return false;
  }

  isReady(): boolean {
    return this.readyState;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  cleanup(): void {
    // Stop vault watcher
    if (this.vaultWatcher) {
      this.vaultWatcher.stop();
      this.vaultWatcher = null;
    }
    this.vaultToolHandler = null;

    if (this.transport) {
      this.transport.shutdown().catch(() => {});
      this.transport = null;
    }
    this.readyState = false;
  }

  async rewind(
    userMessageId: string,
    _assistantMessageId: string,
  ): Promise<ChatRewindResult> {
    if (!this.rewindService) {
      return { canRewind: false, error: 'Rewind service not initialized' };
    }

    // 检查是否可以撤销
    if (!this.rewindService.canRewind()) {
      return { canRewind: false, error: 'No changes to rewind' };
    }

    // 执行撤销
    return this.rewindService.executeRewind(userMessageId);
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(
    _callback: ((sdkMode: string) => void) | null,
  ): void {}

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    return {};
  }

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return { updates: {} };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    if (!conversation?.providerState) return null;

    const providerState = conversation.providerState as Record<string, unknown>;

    // Check for fork source in provider state
    if (providerState.forkSource && typeof providerState.forkSource === 'object') {
      const forkSource = providerState.forkSource as { sessionId?: string };
      if (forkSource.sessionId) {
        return forkSource.sessionId;
      }
    }

    // Fall back to sessionId
    if (providerState.sessionId && typeof providerState.sessionId === 'string') {
      return providerState.sessionId;
    }

    return null;
  }

  // ============ Session Management ============

  private sessionManager: UpupSessionManager | null = null;
  private sessionStore: JsonSessionStore | null = null;

  /**
   * 获取会话管理器
   */
  private getSessionManager(conversationId: string): UpupSessionManager {
    if (!this.sessionManager || this.sessionManager.getCurrentSession()?.conversationId !== conversationId) {
      const vaultPath = getVaultPath(this.plugin.app) ?? process.cwd();
      const sessionPath = path.join(vaultPath, '.upup', 'sessions');

      // Create session store
      this.sessionStore = new JsonSessionStore(sessionPath);

      // Create session manager with auto-save
      this.sessionManager = createUpupSessionManager(conversationId, async (session, messages) => {
        if (this.sessionStore) {
          await this.sessionStore.save(session, messages);
        }
      });
    }
    return this.sessionManager;
  }

  /**
   * 加载会话
   */
  async loadSession(sessionId: string): Promise<boolean> {
    const vaultPath = getVaultPath(this.plugin.app) ?? process.cwd();
    const sessionPath = path.join(vaultPath, '.upup', 'sessions');
    const store = new JsonSessionStore(sessionPath);

    const data = await store.load(sessionId);
    if (!data) {
      return false;
    }

    this.sessionStore = store;
    this.sessionManager = createUpupSessionManager(data.session.conversationId);
    this.sessionManager.load(data.session, data.messages);

    return true;
  }

  /**
   * 保存当前会话
   */
  async saveCurrentSession(): Promise<void> {
    if (this.sessionManager) {
      await this.sessionManager.save();
    }
  }
}
