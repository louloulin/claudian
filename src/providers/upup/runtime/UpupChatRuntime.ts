import { type ChildProcess,spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';

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
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { UPUP_PROVIDER_CAPABILITIES } from '../capabilities';
import { getUpupProviderSettings } from '../settings';
import { createStreamState, transformUpupEvent } from '../stream/transformUpupEvent';

// ============ JSON-RPC 类型 ============

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
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface StreamEvent {
  type: string;
  data?: unknown;
}

// ============ StdioClient（内联实现）============

class UpupStdioClient {
  private proc: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private eventHandlers = new Map<string, Set<(event: unknown) => void>>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(
    command: string,
    args: string[],
    options?: { env?: Record<string, string>; cwd?: string },
  ): Promise<void> {
    const env = { ...process.env, ...options?.env };

    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: options?.cwd,
      windowsHide: true,
    });

    // 设置 stdout 处理 - 使用 createInterface 正确处理换行
    if (this.proc.stdout) {
      const rl = createInterface({ input: this.proc.stdout as Readable });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
          this.handleMessage(msg);
        } catch (err) {
          console.error('[upup parse error]', err, 'line:', line.slice(0, 100));
        }
      });
    }

    // 处理 stderr
    (this.proc.stderr as Readable)?.on('data', (data: Buffer) => {
      console.error('[upup stderr]', data.toString().slice(0, 200));
    });

    // 进程退出处理
    this.proc.on('exit', (code) => {
      this._connected = false;
      console.log(`[upup process exited with code ${code}]`);
    });

    this.proc.on('error', (err) => {
      console.error('[upup process error]', err.message);
    });

    // 初始化握手
    try {
      await this.request('initialize', {
        clientName: '@claudian/upup',
        clientVersion: '1.0.0',
        capabilities: { streaming: true, tools: true },
      });
      this._connected = true;
    } catch (err) {
      this.proc.kill();
      throw new Error(`Failed to initialize upup agent: ${err}`, { cause: err });
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
      throw new Error('Upup process not running');
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
        (this.proc!.stdin as Writable).write(JSON.stringify(msg) + '\n');
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ('id' in msg && msg.id !== undefined) {
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg);
      }
      return;
    }

    if ('method' in msg) {
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch (err) {
            console.error(`Handler error for ${msg.method}:`, err);
          }
        }
      }
    }
  }

  async *streamRun(params: Record<string, unknown>): AsyncGenerator<StreamEvent> {
    console.log('[UpupStdioClient] streamRun params:', JSON.stringify(params).slice(0, 200));
    // 收集事件 - 先注册处理器，确保不丢失事件
    const events: StreamEvent[] = [];
    let resolvePromise: () => void;
    const eventPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const handler = (data: unknown) => {
      console.log('[UpupStdioClient] received event:', JSON.stringify(data).slice(0, 200));
      events.push(data as StreamEvent);
    };
    this.on('event', handler);

    const doneHandler = (data: unknown) => {
      console.log('[UpupStdioClient] received stream_done:', JSON.stringify(data).slice(0, 200));
      const d = data as Record<string, unknown>;
      // Server sends {"type":"done","data":{"done":true,...}} or {"done":true}
      const isDone = d.done === true || (d.data && (d.data as Record<string, unknown>).done === true);
      if (isDone) {
        this.off('event', handler);
        this.off('stream_done', doneHandler);
        resolvePromise?.();
      }
    };
    this.on('stream_done', doneHandler);

    // 超时保护
    const timeout = setTimeout(() => {
      console.log('[UpupStdioClient] stream timeout!');
      this.off('event', handler);
      this.off('stream_done', doneHandler);
      resolvePromise?.();
    }, 300_000);

    try {
      // 发送流式请求 - 事件处理器已注册
      console.log('[UpupStdioClient] sending stream request');
      await this.request('stream', params);
      console.log('[UpupStdioClient] waiting for events...');
      await eventPromise;
      console.log('[UpupStdioClient] events complete, collected:', events.length);
    } finally {
      clearTimeout(timeout);
    }

    for (const event of events) {
      yield event;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown');
    } catch {
      // 忽略错误
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this._connected = false;
  }
}

// ============ Constants ============

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

// ============ UpupChatRuntime ============

export class UpupChatRuntime implements ChatRuntime {
  readonly providerId = 'upup' as const;
  private client: UpupStdioClient | null = null;
  private sessionId: string | null = null;
  private readyState = false;
  private reconnectAttempts = 0;

  constructor(private plugin: ClaudianPlugin) {}

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
    // If already connected, check if the process is still alive
    if (this.client?.connected) {
      this.readyState = true;
      return true;
    }

    // Connection lost or not initialized - attempt reconnection
    return this.attemptConnection(options);
  }

  /**
   * Attempt to connect to upup agent with retry logic.
   */
  private async attemptConnection(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    console.log('[UpupChatRuntime] attemptConnection called, force:', options?.force);
    const maxAttempts = options?.force ? MAX_RETRY_ATTEMPTS + 1 : MAX_RETRY_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log('[UpupChatRuntime] connection attempt:', attempt + 1);
        // Clean up any existing connection
        if (this.client) {
          await this.client.shutdown().catch(() => {});
          this.client = null;
        }

        const settings = getUpupProviderSettings(this.plugin.settings);
        console.log('[UpupChatRuntime] settings:', JSON.stringify(settings).slice(0, 200));
        const enhancedPath = await getEnhancedPath();
        const vaultPath = getVaultPath(this.plugin.app);
        console.log('[UpupChatRuntime] vaultPath:', vaultPath);

        // Determine command and args
        let command: string;
        let args: string[];

        if (settings.cliPath && settings.cliPath !== 'bun' && settings.cliPath !== 'npx' && settings.cliPath !== '') {
          // Use custom path
          console.log('[UpupChatRuntime] using custom cliPath:', settings.cliPath);
          command = settings.cliPath;
          args = ['--stdio'];
        } else {
          // Check for existing agent or create bundled one
          const foundPath = this.findUpupAgentPath();
          console.log('[UpupChatRuntime] foundPath:', foundPath);
          if (foundPath) {
            command = 'node';
            args = [foundPath];
          } else {
            // Create bundled agent and use it
            console.log('[UpupChatRuntime] creating bundled agent...');
            const bundledPath = await this.ensureBundledAgent();
            console.log('[UpupChatRuntime] bundledPath:', bundledPath);
            command = 'node';
            args = [bundledPath];
          }
        }

        console.log('[UpupChatRuntime] spawning:', command, args.join(' '));

        // Build environment with API keys from settings
        const env: Record<string, string> = {
          ...process.env,
          PATH: enhancedPath,
        };

        // Add API keys from settings
        if (settings.apiKeys) {
          if (settings.apiKeys.deepseek) {
            env.DEEPSEEK_API_KEY = settings.apiKeys.deepseek;
          }
          if (settings.apiKeys.openai) {
            env.OPENAI_API_KEY = settings.apiKeys.openai;
          }
          if (settings.apiKeys.anthropic) {
            env.ANTHROPIC_API_KEY = settings.apiKeys.anthropic;
          }
          if (settings.apiKeys.google) {
            env.GOOGLE_API_KEY = settings.apiKeys.google;
          }
        }

        // Add API base URLs
        if (settings.apiBases) {
          if (settings.apiBases.deepseek) {
            env.DEEPSEEK_BASE_URL = settings.apiBases.deepseek;
          }
          if (settings.apiBases.openai) {
            env.OPENAI_BASE_URL = settings.apiBases.openai;
          }
        }

        console.log('[UpupChatRuntime] API keys loaded:', Object.keys(env).filter(k => k.includes('API_KEY')).join(', '));

        this.client = new UpupStdioClient();
        await this.client.connect(command, args, {
          env,
          cwd: vaultPath || undefined,
        });

        console.log('[UpupChatRuntime] connection successful!');
        // Generate new session ID on reconnection
        this.sessionId = `upup-${Date.now()}`;
        this.readyState = true;
        this.reconnectAttempts = 0;
        return true;
      } catch (err) {
        console.error(`[UpupChatRuntime] Connection attempt ${attempt + 1} failed:`, err);
        this.reconnectAttempts++;

        // Wait before retry (except on last attempt)
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
   * Check if the current connection is dead and needs reconnection.
   */
  private isConnectionDead(): boolean {
    if (!this.client) return true;
    // The client tracks connection state internally
    return false;
  }

  /**
   * Force restart the upup agent process.
   */
  async forceRestart(): Promise<boolean> {
    console.log('[UpupChatRuntime] Force restarting upup agent...');
    return this.attemptConnection({ force: true });
  }

  /**
   * Find upup-agent CLI location.
   * Always returns null to force bundled agent creation (ensures latest version).
   */
  private findUpupAgentPath(): string | null {
    // Always return null to force fresh bundled agent creation
    // This ensures we always have the latest version
    return null;
  }

  /**
   * Write bundled agent to vault directory.
   * Always overwrites to ensure latest version.
   */
  private async ensureBundledAgent(): Promise<string> {
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      throw new Error('Cannot determine vault path');
    }
    const agentDir = path.join(vaultPath, '.claudian');
    const bundledAgentPath = path.join(agentDir, 'upup-agent.js');

    // Create directory if not exists
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }

    // Always write bundled agent (overwrites old versions)
    const agentCode = this.getBundledAgentCode();
    fs.writeFileSync(bundledAgentPath, agentCode, 'utf-8');
    fs.chmodSync(bundledAgentPath, 0o755);

    console.log('[UpupChatRuntime] Wrote bundled agent at:', bundledAgentPath);
    return bundledAgentPath;
  }

  /**
   * Get bundled agent code - a minimal stdio server.
   * This is embedded to avoid external dependencies.
   */
  private getBundledAgentCode(): string {
    // Enhanced bundled agent with robust message handling and debugging
    return `#!/usr/bin/env node
// Minimal Upup Agent - Bundled Version
// This is a simplified agent that provides basic chat functionality

const AGENT_VERSION = '1.0.5-LLM';
const DEBUG_SIGNATURE = '=== UPUP_DEBUG_V103 ===';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n');
}

function handleMessage(msg) {
  // Handle both raw strings and parsed objects
  let parsed;
  if (typeof msg === 'string') {
    try {
      parsed = JSON.parse(msg);
    } catch (e) {
      console.error('[upup-agent] Parse error:', e.message);
      return;
    }
  } else {
    parsed = msg;
  }

  const method = parsed && parsed.method;
  const params = parsed && parsed.params;
  const id = parsed && parsed.id;

  // Debug logging
  console.error('[upup-agent] Received method:', method);
  if (params && typeof params === 'object') {
    console.error('[upup-agent] Params keys:', Object.keys(params).join(', '));
  }

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: id,
        result: {
          version: AGENT_VERSION,
          capabilities: { streaming: true, tools: true },
          agentName: 'upup-agent-bundled',
        },
      });
      break;

    case 'stream': {
      // Extract query from params - handle multiple formats
      let query = 'Hello';
      let model = 'deepseek-chat';
      let provider = 'deepseek';

      if (params) {
        // Try direct query first
        if (typeof params.query === 'string') {
          query = params.query;
        }
        // Try messages array
        else if (Array.isArray(params.messages) && params.messages.length > 0) {
          const userMsg = params.messages.find(m => m && m.role === 'user');
          if (userMsg && userMsg.content) {
            query = userMsg.content;
          } else if (params.messages[0] && params.messages[0].content) {
            query = params.messages[0].content;
          }
        }
        // Get model and provider
        if (typeof params.model === 'string') {
          model = params.model;
        }
        if (typeof params.provider === 'string') {
          provider = params.provider;
        }
      }

      console.error('[upup-agent] Query:', query.substring(0, 50), '| Model:', model, '| Provider:', provider);

      // Send start event
      send({ jsonrpc: '2.0', method: 'event', params: { type: 'message_start', data: {} } });

      // Build messages for LLM
      const messages = [
        { role: 'user', content: query }
      ];

      // Call LLM API based on provider
      try {
        let apiKey = '';
        let baseUrl = '';

        if (provider === 'deepseek') {
          apiKey = process.env.DEEPSEEK_API_KEY || '';
          baseUrl = baseUrl || 'https://api.deepseek.com';
        } else if (provider === 'openai') {
          apiKey = process.env.OPENAI_API_KEY || '';
          baseUrl = baseUrl || 'https://api.openai.com/v1';
        } else if (provider === 'anthropic') {
          apiKey = process.env.ANTHROPIC_API_KEY || '';
          baseUrl = baseUrl || 'https://api.anthropic.com/v1';
        } else if (provider === 'google') {
          apiKey = process.env.GOOGLE_API_KEY || '';
          baseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        } else {
          throw new Error('Unsupported provider: ' + provider);
        }

        if (!apiKey) {
          throw new Error('No API key found for provider: ' + provider + '. Please configure API key in settings.');
        }

        console.error('[upup-agent] API Key found:', apiKey ? 'YES (length: ' + apiKey.length + ')' : 'NO');
        console.error('[upup-agent] Base URL:', baseUrl);

        // Make streaming API call
        let responseText = '';
        let fullResponse = '';

        if (provider === 'deepseek') {
          // DeepSeek API
          const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
              model: model || 'deepseek-chat',
              messages: messages,
              stream: true,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error('DeepSeek API error: ' + response.status + ' - ' + errorText);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) {
                    responseText += content;
                    send({ jsonrpc: '2.0', method: 'event', params: { type: 'content_delta', data: { content: content } } });
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
          fullResponse = responseText;
        } else {
          // OpenAI-compatible API
          const response = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
              model: model || 'gpt-4o',
              messages: messages,
              stream: true,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error('API error: ' + response.status + ' - ' + errorText);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) {
                    responseText += content;
                    send({ jsonrpc: '2.0', method: 'event', params: { type: 'content_delta', data: { content: content } } });
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
          fullResponse = responseText;
        }

        console.error('[upup-agent] LLM response length:', fullResponse.length);

        // Send done
        send({ jsonrpc: '2.0', method: 'event', params: { type: 'done', data: { done: true, output: fullResponse } } });
        send({ jsonrpc: '2.0', method: 'stream_done', params: { done: true } });

        // Send response
        send({
          jsonrpc: '2.0',
          id: id,
          result: { output: fullResponse, toolCalls: 0, runId: 'run-' + Date.now() },
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[upup-agent] LLM error:', errorMessage);

        // Send error as content
        const errorResponse = 'Error: ' + errorMessage;
        send({ jsonrpc: '2.0', method: 'event', params: { type: 'content_delta', data: { content: errorResponse } } });
        send({ jsonrpc: '2.0', method: 'event', params: { type: 'done', data: { done: true, output: errorResponse } } });
        send({ jsonrpc: '2.0', method: 'stream_done', params: { done: true } });
        send({
          jsonrpc: '2.0',
          id: id,
          result: { output: errorResponse, toolCalls: 0, runId: 'run-' + Date.now() },
        });
      }
      break;
    }

    case 'shutdown':
      send({ jsonrpc: '2.0', id: id, result: { shutdown: true } });
      process.exit(0);
      break;

    default:
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id: id, error: { code: -32601, message: 'Method not found: ' + method } });
      }
  }
}

// Use readline for proper line handling (like Codex does)
const rl = require('readline').createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  console.error('[upup-agent] stdin line received:', line.substring(0, 100));
  if (!line.trim()) return;
  handleMessage(line);
});

rl.on('close', () => {
  console.error('[upup-agent] stdin closed');
  process.exit(0);
});

rl.on('error', (err) => {
  console.error('[upup-agent] readline error:', err.message);
});

console.error('[upup-agent] Bundled agent v' + AGENT_VERSION + ' ready (with LLM support), waiting for input...');
`;
  }

  private resolveCliArgs(cliPath: string): { command: string; args: string[] } {
    // If custom path is provided and not empty, use it directly
    if (cliPath && cliPath !== 'bun' && cliPath !== 'npx' && cliPath !== '') {
      return { command: cliPath, args: ['--stdio'] };
    }

    // Try to find existing agent
    const foundPath = this.findUpupAgentPath();
    if (foundPath) {
      return { command: 'node', args: [foundPath] };
    }

    // Will use bundled agent (spawned after ensureReady)
    return { command: 'node', args: ['__BUNDLED_AGENT__'] };
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    // Ensure connection is alive with retry
    if (!this.client?.connected) {
      const ready = await this.ensureReady();
      if (!ready) {
        yield { type: 'error', content: 'Failed to connect to upup agent' };
        yield { type: 'done' };
        return;
      }
    }

    const settings = getUpupProviderSettings(this.plugin.settings);
    const model = queryOptions?.model ?? settings.model;
    const provider = settings.provider;

    console.log('[UpupChatRuntime] query:', { model, provider, prompt: turn.prompt.slice(0, 50) });

    const messages = [
      { role: 'user' as const, content: turn.prompt },
    ];

    try {
      const streamState = createStreamState();
      let eventCount = 0;

      for await (const event of this.client!.streamRun({
        messages,
        model,
        provider,
        sessionId: this.sessionId,
      })) {
        eventCount++;
        console.log('[UpupChatRuntime] event:', event.type, JSON.stringify(event.data || '').slice(0, 100));
        for (const chunk of transformUpupEvent(event, { streamState })) {
          yield chunk;
        }
      }
      console.log('[UpupChatRuntime] stream complete, events:', eventCount);
    } catch (err) {
      // Check if connection was lost
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('process') || errorMessage.includes('ENOENT')) {
        console.error('[UpupChatRuntime] Connection lost during query, attempting reconnect...');
        this.readyState = false;
        this.client = null;

        // Attempt reconnection and retry once
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
    // JSON-RPC 取消需要 runId，暂时不实现
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
    if (this.client) {
      this.client.shutdown().catch(() => {});
      this.client = null;
    }
    this.readyState = false;
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
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

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    // For fork, generate a new session ID
    return `upup-fork-${Date.now()}`;
  }
}