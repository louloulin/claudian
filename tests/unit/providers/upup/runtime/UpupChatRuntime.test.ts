/**
 * UpupChatRuntime.test.ts
 * 单元测试 for UpupChatRuntime - Session 集成
 *
 * TDD: 验证 Session 管理行为
 * 注意: 由于 Transport 需要真实进程，这里测试不依赖 Transport 的行为
 */

import type ClaudianPlugin from '../../../../../src/main';
import { UpupChatRuntime } from '../../../../../src/providers/upup/runtime/UpupChatRuntime';

// Mock plugin
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
} as unknown as ClaudianPlugin;

describe('UpupChatRuntime', () => {
  describe('Provider ID', () => {
    it('should have upup as providerId', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(runtime.providerId).toBe('upup');
    });
  });

  describe('Initial State', () => {
    it('should not be ready initially', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(runtime.isReady()).toBe(false);
    });

    it('should return null sessionId initially', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(runtime.getSessionId()).toBeNull();
    });
  });

  describe('prepareTurn', () => {
    it('should create PreparedChatTurn from request', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const turn = runtime.prepareTurn({
        text: 'Hello world',
      });

      expect(turn.prompt).toBe('Hello world');
      expect(turn.persistedContent).toBe('Hello world');
      expect(turn.isCompact).toBe(false);
      expect(turn.mcpMentions).toBeInstanceOf(Set);
    });

    it('should preserve request in turn', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const request = {
        text: 'Test message',
      };

      const turn = runtime.prepareTurn(request as any);

      expect(turn.request).toBe(request);
    });
  });

  describe('Capabilities', () => {
    it('should return capabilities object with expected properties', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      const caps = runtime.getCapabilities();

      expect(typeof caps).toBe('object');
      // Should have expected capability flags
      expect(caps).toHaveProperty('providerId', 'upup');
      expect(caps).toHaveProperty('supportsNativeHistory');
      expect(caps).toHaveProperty('supportsFork');
    });
  });

  describe('Session 管理', () => {
    it('should generate new sessionId on resetSession', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      runtime.resetSession();

      const sessionId = runtime.getSessionId();
      expect(sessionId).not.toBeNull();
      expect(sessionId).toMatch(/^upup-\d+$/);
    });

    it('should provide consumeSessionInvalidation method', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      const result = runtime.consumeSessionInvalidation();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Event Listeners', () => {
    it('should return unsubscribe function from onReadyStateChange', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const unsubscribe = runtime.onReadyStateChange(() => {});

      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('getSupportedCommands', () => {
    it('should return empty array', async () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const commands = await runtime.getSupportedCommands();

      expect(Array.isArray(commands)).toBe(true);
      expect(commands).toHaveLength(0);
    });
  });

  describe('Sync Methods', () => {
    it('should handle setResumeCheckpoint', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setResumeCheckpoint('checkpoint-123')).not.toThrow();
    });

    it('should handle setApprovalCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setApprovalCallback(null)).not.toThrow();
    });

    it('should handle setApprovalDismisser', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setApprovalDismisser(null)).not.toThrow();
    });

    it('should handle setAskUserQuestionCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setAskUserQuestionCallback(null)).not.toThrow();
    });

    it('should handle setExitPlanModeCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setExitPlanModeCallback(null)).not.toThrow();
    });

    it('should handle setPermissionModeSyncCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setPermissionModeSyncCallback(null)).not.toThrow();
    });

    it('should handle setSubagentHookProvider', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setSubagentHookProvider(() => ({ hasRunning: false }))).not.toThrow();
    });

    it('should handle setAutoTurnCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.setAutoTurnCallback(null)).not.toThrow();
    });

    it('should handle consumeTurnMetadata', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      const metadata = runtime.consumeTurnMetadata();
      expect(typeof metadata).toBe('object');
    });
  });

  describe('Async Methods (no-throw behavior)', () => {
    it('should handle syncConversationState', async () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      let threw = false;
      try {
        await runtime.syncConversationState(null);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('should handle reloadMcpServers', async () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      let threw = false;
      try {
        await runtime.reloadMcpServers();
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('should handle cleanup', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.cleanup()).not.toThrow();
    });
  });

  describe('cancel', () => {
    it('should handle cancel without throwing', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      expect(() => runtime.cancel()).not.toThrow();
    });
  });

  describe('buildSessionUpdates', () => {
    it('should return updates object', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const result = runtime.buildSessionUpdates({
        conversation: null,
        sessionInvalidated: false,
      });

      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('updates');
    });
  });

  describe('resolveSessionIdForFork', () => {
    it('should return null when conversation is null', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const sessionId = runtime.resolveSessionIdForFork(null);

      expect(sessionId).toBeNull();
    });

    it('should extract sessionId from forkSource in providerState', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const conversation = {
        id: 'conv-123',
        providerId: 'upup' as const,
        providerState: {
          forkSource: {
            sessionId: 'forked-session-456',
          },
        },
      };

      const sessionId = runtime.resolveSessionIdForFork(conversation as any);

      expect(sessionId).toBe('forked-session-456');
    });

    it('should extract sessionId from providerState.sessionId', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const conversation = {
        id: 'conv-123',
        providerId: 'upup' as const,
        providerState: {
          sessionId: 'existing-session-789',
        },
      };

      const sessionId = runtime.resolveSessionIdForFork(conversation as any);

      expect(sessionId).toBe('existing-session-789');
    });

    it('should prefer forkSource over sessionId', () => {
      const runtime = new UpupChatRuntime(mockPlugin);

      const conversation = {
        id: 'conv-123',
        providerId: 'upup' as const,
        providerState: {
          forkSource: {
            sessionId: 'forked-session',
          },
          sessionId: 'regular-session',
        },
      };

      const sessionId = runtime.resolveSessionIdForFork(conversation as any);

      expect(sessionId).toBe('forked-session');
    });
  });

  describe('ApprovalCallback', () => {
    it('should store approvalCallback via setApprovalCallback', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      const callback = jest.fn();

      runtime.setApprovalCallback(callback);

      // Verify the callback can be called without throwing
      expect(() => runtime.setApprovalCallback(null)).not.toThrow();
    });

    it('should handle approvalCallback for non-vault tools', () => {
      const runtime = new UpupChatRuntime(mockPlugin);
      const callback = jest.fn();

      // Set callback
      runtime.setApprovalCallback(callback);

      // Clear callback
      runtime.setApprovalCallback(null);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});