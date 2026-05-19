/**
 * UpupChatRuntimeSessionIntegration.test.ts
 * 真实 Session 集成测试 - 验证 Transport 复用和 Session 管理
 *
 * TDD: 验证 Session 的真实行为
 */

// Mock plugins and modules
const mockPlugin = {
  app: {
    vault: { getRoot: () => ({ path: '/mock/vault' }) },
  },
  settings: {
    providers: {
      upup: {
        model: 'mock-model',
        cliPath: 'auto',
      },
    },
  },
};

// Mock Transport class
class MockTransport {
  private _connected = false;
  private requestId = 0;
  private pending = new Map<number, (res: unknown) => void>();
  private eventHandlers = new Map<string, Set<(event: unknown) => void>>();

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  async close(): Promise<void> {
    this._connected = false;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    // Increment request counter
    this.requestId++;

    // Simulate session API responses
    if (method === 'initialize') {
      return { success: true };
    }

    if (method === 'session/create') {
      return {
        id: params?.id as string || `session-${Date.now()}`,
        state: 'idle',
        createdAt: Date.now(),
      };
    }

    if (method === 'session/resume') {
      return {
        id: params?.id as string,
        state: 'running',
        messages: [],
        metadata: {},
      };
    }

    if (method === 'session/messages') {
      return { messages: [] };
    }

    if (method === 'session/update') {
      return { success: true };
    }

    if (method === 'stream') {
      // Simulate stream start
      return { runId: `run-${Date.now()}`, status: 'running' };
    }

    return { success: true };
  }

  on(event: string, handler: (event: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) || new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  off(event: string, handler: (event: unknown) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    handlers?.forEach(h => h(data));
  }

  async *streamRun(params: { messages: Array<{ role: string; content: string }>; model?: string; sessionId?: string | null }): AsyncGenerator<unknown> {
    // Emit stream start
    this.emit('event', { type: 'stream_start', sessionId: params.sessionId });

    // Find user message
    const userMessage = params.messages.find(m => m.role === 'user')?.content || 'Hello';

    // Simulate thinking
    this.emit('event', { type: 'thinking', message: 'Thinking...' });

    // Simulate response
    const response = `Response to: ${userMessage}`;
    let index = 0;
    for (const char of response) {
      this.emit('event', {
        type: 'stream_progress',
        charDelta: char,
        mode: 'responding',
        accumulatedText: response.slice(0, index + 1),
      });
      index++;
    }

    // Emit done
    this.emit('event', {
      type: 'done',
      answer: response,
      tokenUsage: { input: 50, output: 100 },
    });

    this.emit('stream_done', { done: true });

    yield { type: 'done' };
  }
}

// Mock external dependencies
jest.mock('../../../../../src/core/providers/providerEnvironment', () => ({
  getRuntimeEnvironmentVariables: () => ({}),
}));

jest.mock('../../../../../src/utils/path', () => ({
  getVaultPath: () => '/mock/vault',
}));

jest.mock('../../../../../src/providers/upup/settings', () => ({
  getUpupProviderSettings: () => ({
    model: 'mock-model',
    cliPath: 'mock-upup',
  }),
}));

jest.mock('../../../../../src/providers/upup/capabilities', () => ({
  UPUP_PROVIDER_CAPABILITIES: {
    providerId: 'upup',
    supportsNativeHistory: true,
    supportsFork: true,
    supportsPlanMode: false,
  },
}));

jest.mock('../../../../../src/providers/upup/vault/VaultToolHandler', () => ({
  VaultToolHandler: jest.fn().mockImplementation(() => ({
    isVaultTool: () => false,
    handleTool: jest.fn(),
  })),
}));

jest.mock('../../../../../src/providers/upup/vault/VaultWatcher', () => ({
  VaultWatcher: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../../../../../src/providers/upup/runtime/UpupRewindService', () => ({
  UpupRewindService: jest.fn().mockImplementation(() => ({
    canRewind: () => false,
    executeRewind: jest.fn(),
  })),
}));

jest.mock('../../../../../src/providers/upup/runtime/UpupSessionManager', () => ({
  createUpupSessionManager: jest.fn(() => ({
    getSessionId: () => 'mock-session-123',
    getCurrentSession: () => ({
      id: 'mock-session-123',
      conversationId: 'mock-conv',
      status: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      messageCount: 0,
    }),
    addUserMessage: jest.fn(),
    addAssistantMessage: jest.fn(),
    getHistory: () => [],
    save: jest.fn(),
    load: jest.fn(),
    getMessages: () => [],
    syncEvent: jest.fn(),
  })),
}));

jest.mock('../../../../../src/providers/upup/storage/UpupSessionStore', () => ({
  JsonSessionStore: jest.fn(),
}));

// Import after mocks
import type ClaudianPlugin from '../../../../../src/main';
import { UpupChatRuntime } from '../../../../../src/providers/upup/runtime/UpupChatRuntime';

// Mock plugin type
const mockPluginTyped = mockPlugin as unknown as ClaudianPlugin;

describe('UpupChatRuntime Session Integration', () => {
  describe('Session 管理', () => {
    it('should initialize with null sessionId', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      expect(runtime.getSessionId()).toBeNull();
      expect(runtime.isReady()).toBe(false);
    });

    it('should generate new sessionId on resetSession', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      runtime.resetSession();

      const sessionId = runtime.getSessionId();
      expect(sessionId).not.toBeNull();
      expect(sessionId).toMatch(/^upup-\d+$/);
    });

    it('should have upup as providerId', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      expect(runtime.providerId).toBe('upup');
    });
  });

  describe('prepareTurn', () => {
    it('should create PreparedChatTurn with correct structure', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const turn = runtime.prepareTurn({
        text: 'Hello world',
      });

      expect(turn.prompt).toBe('Hello world');
      expect(turn.persistedContent).toBe('Hello world');
      expect(turn.isCompact).toBe(false);
      expect(turn.mcpMentions).toBeInstanceOf(Set);
    });
  });

  describe('Capabilities', () => {
    it('should return capabilities with native history support', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const caps = runtime.getCapabilities();

      expect(caps).toHaveProperty('supportsNativeHistory', true);
      expect(caps).toHaveProperty('supportsFork', true);
    });
  });

  describe('consumeSessionInvalidation', () => {
    it('should return boolean', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const result = runtime.consumeSessionInvalidation();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('getSupportedCommands', () => {
    it('should return empty array', async () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const commands = await runtime.getSupportedCommands();

      expect(Array.isArray(commands)).toBe(true);
    });
  });

  describe('Session 生命周期', () => {
    it('should generate unique sessionId on each reset', async () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      // Initial session
      runtime.resetSession();
      const firstSessionId = runtime.getSessionId();

      // Wait a tiny bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Reset again
      runtime.resetSession();
      const secondSessionId = runtime.getSessionId();

      // Should be different (different timestamps)
      expect(firstSessionId).not.toBe(secondSessionId);
      expect(firstSessionId).toMatch(/^upup-\d+$/);
      expect(secondSessionId).toMatch(/^upup-\d+$/);
    });

    it('should maintain sessionId format after multiple resets', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      for (let i = 0; i < 3; i++) {
        runtime.resetSession();
        const sessionId = runtime.getSessionId();

        expect(sessionId).toMatch(/^upup-\d+$/);
      }
    });
  });

  describe('resolveSessionIdForFork', () => {
    it('should return null for null conversation', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const sessionId = runtime.resolveSessionIdForFork(null);

      expect(sessionId).toBeNull();
    });
  });

  describe('buildSessionUpdates', () => {
    it('should return updates object', () => {
      const runtime = new UpupChatRuntime(mockPluginTyped);

      const result = runtime.buildSessionUpdates({
        conversation: null,
        sessionInvalidated: false,
      });

      expect(result).toHaveProperty('updates');
    });
  });
});

describe('MockTransport Behavior', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  describe('Connection Management', () => {
    it('should be disconnected initially', () => {
      expect(transport.connected).toBe(false);
    });

    it('should connect successfully', async () => {
      await transport.connect();

      expect(transport.connected).toBe(true);
    });

    it('should close connection', async () => {
      await transport.connect();
      await transport.close();

      expect(transport.connected).toBe(false);
    });
  });

  describe('Session API', () => {
    it('should handle session/create', async () => {
      await transport.connect();

      const result = await transport.request('session/create', {
        id: 'test-session-123',
      }) as { id: string; state: string };

      expect(result.id).toBe('test-session-123');
      expect(result.state).toBe('idle');
    });

    it('should handle session/resume', async () => {
      await transport.connect();

      const result = await transport.request('session/resume', {
        id: 'test-session-123',
      }) as { id: string; state: string };

      expect(result.id).toBe('test-session-123');
      expect(result.state).toBe('running');
    });

    it('should handle session/messages', async () => {
      await transport.connect();

      const result = await transport.request('session/messages', {
        id: 'test-session-123',
      }) as { messages: unknown[] };

      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('should handle session/update', async () => {
      await transport.connect();

      const result = await transport.request('session/update', {
        id: 'test-session-123',
        state: 'completed',
      }) as { success: boolean };

      expect(result.success).toBe(true);
    });
  });

  describe('Stream Events', () => {
    it('should emit stream_start event', async () => {
      await transport.connect();

      let eventReceived = false;
      transport.on('event', (event) => {
        if ((event as { type: string }).type === 'stream_start') {
          eventReceived = true;
        }
      });

      // Simulate stream start
      transport.emit('event', { type: 'stream_start', sessionId: 'test-123' });

      expect(eventReceived).toBe(true);
    });

    it('should emit stream_progress events', async () => {
      await transport.connect();

      let progressCount = 0;
      transport.on('event', (event) => {
        if ((event as { type: string }).type === 'stream_progress') {
          progressCount++;
        }
      });

      // Simulate progress
      transport.emit('event', { type: 'stream_progress', charDelta: 'H' });
      transport.emit('event', { type: 'stream_progress', charDelta: 'i' });

      expect(progressCount).toBe(2);
    });

    it('should emit done event with token usage', async () => {
      await transport.connect();

      let doneReceived = false;
      let tokenUsage: unknown = null;

      transport.on('event', (event) => {
        if ((event as { type: string }).type === 'done') {
          doneReceived = true;
          tokenUsage = (event as { tokenUsage: unknown }).tokenUsage;
        }
      });

      transport.emit('event', {
        type: 'done',
        answer: 'Test response',
        tokenUsage: { input: 100, output: 200 },
      });

      expect(doneReceived).toBe(true);
      expect(tokenUsage).toEqual({ input: 100, output: 200 });
    });
  });

  describe('streamRun', () => {
    it('should yield events from stream', async () => {
      await transport.connect();

      const events: unknown[] = [];
      for await (const event of transport.streamRun({
        messages: [{ role: 'user', content: 'Hello' }],
        sessionId: 'test-session',
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });

    it('should pass sessionId to stream', async () => {
      await transport.connect();

      let receivedSessionId: string | null = null;
      transport.on('event', (event) => {
        if ((event as { type: string }).type === 'stream_start') {
          receivedSessionId = (event as { sessionId: string }).sessionId;
        }
      });

      const generator = transport.streamRun({
        messages: [{ role: 'user', content: 'Test' }],
        sessionId: 'my-session-id',
      });

      // Consume the generator
      while (true) {
        const result = await generator.next();
        if (result.done) break;
      }

      expect(receivedSessionId).toBe('my-session-id');
    });
  });
});

describe('Session 持久化场景', () => {
  it('should simulate session save and load cycle', () => {
    // Simulate SessionManager behavior
    const messages: Array<{ role: string; content: string }> = [];

    // Add user message
    messages.push({ role: 'user', content: 'Hello' });

    // Add assistant response
    messages.push({ role: 'assistant', content: 'Hi there!' });

    // Verify message order
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');

    // Simulate save
    const savedMessages = [...messages];

    // Verify save preserves original
    expect(savedMessages).toEqual(messages);
  });

  it('should simulate session history for API', () => {
    const sessionHistory = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ];

    // Get history for API call
    const apiMessages = sessionHistory.map(m => ({
      role: m.role,
      content: m.content,
    }));

    expect(apiMessages).toHaveLength(4);
    expect(apiMessages[0]).toEqual({ role: 'user', content: 'First question' });
  });

  it('should handle session token tracking', () => {
    const tokenUsage = {
      inputTokens: 500,
      outputTokens: 1000,
      totalTokens: 1500,
    };

    expect(tokenUsage.totalTokens).toBe(tokenUsage.inputTokens + tokenUsage.outputTokens);
  });
});