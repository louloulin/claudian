/**
 * UpupConversationHistoryService.test.ts
 * 单元测试 for UpupConversationHistoryService
 */

import { UpupConversationHistoryService } from '../../../../../src/providers/upup/history/UpupConversationHistoryService';
import type { Conversation } from '../../../../../src/core/types';

describe('UpupConversationHistoryService', () => {
  let service: UpupConversationHistoryService;

  beforeEach(() => {
    service = new UpupConversationHistoryService();
  });

  describe('resolveSessionIdForConversation', () => {
    it('should return null for null conversation', () => {
      expect(service.resolveSessionIdForConversation(null)).toBeNull();
    });

    it('should return null for conversation without providerState', () => {
      const conversation = {} as Conversation;
      expect(service.resolveSessionIdForConversation(conversation)).toBeNull();
    });

    it('should return sessionId from providerState', () => {
      const conversation = {
        providerState: { sessionId: 'test-session-123' },
      } as Conversation;
      expect(service.resolveSessionIdForConversation(conversation)).toBe('test-session-123');
    });

    it('should return forkSource sessionId when present', () => {
      const conversation = {
        providerState: {
          sessionId: 'main-session',
          forkSource: {
            sessionId: 'fork-source-session',
            resumeAt: 'msg-5',
          },
        },
      } as Conversation;
      expect(service.resolveSessionIdForConversation(conversation)).toBe('fork-source-session');
    });

    it('should prefer forkSource over sessionId', () => {
      const conversation = {
        providerState: {
          sessionId: 'main-session',
          forkSource: {
            sessionId: 'fork-session',
            resumeAt: 'msg-10',
          },
        },
      } as Conversation;
      const result = service.resolveSessionIdForConversation(conversation);
      expect(result).toBe('fork-session');
    });
  });

  describe('isPendingForkConversation', () => {
    it('should return false for null conversation', () => {
      const conversation = {} as Conversation;
      expect(service.isPendingForkConversation(conversation)).toBe(false);
    });

    it('should return false for conversation without forkSource', () => {
      const conversation = {
        providerState: { sessionId: 'test-session' },
      } as Conversation;
      expect(service.isPendingForkConversation(conversation)).toBe(false);
    });

    it('should return true for conversation with forkSource', () => {
      const conversation = {
        providerState: {
          forkSource: {
            sessionId: 'source-session',
            resumeAt: 'msg-5',
          },
        },
      } as Conversation;
      expect(service.isPendingForkConversation(conversation)).toBe(true);
    });

    it('should return false for forkSource without sessionId', () => {
      const conversation = {
        providerState: {
          forkSource: {
            resumeAt: 'msg-5',
          },
        },
      } as Conversation;
      expect(service.isPendingForkConversation(conversation)).toBe(false);
    });
  });

  describe('buildForkProviderState', () => {
    it('should create fork provider state with forkSource', () => {
      const result = service.buildForkProviderState('source-session', 'msg-10');

      expect(result.sessionId).toMatch(/^upup-fork-\d+$/);
      expect(result.forkSource).toEqual({
        sessionId: 'source-session',
        resumeAt: 'msg-10',
      });
      expect(result.resumeAt).toBe('msg-10');
      expect(result.createdAt).toBeDefined();
    });

    it('should include timestamp in createdAt', () => {
      const before = new Date().toISOString();
      const result = service.buildForkProviderState('test', 'msg-1');
      const after = new Date().toISOString();

      expect(result.createdAt).toBeDefined();
      expect(result.createdAt! >= before).toBe(true);
      expect(result.createdAt! <= after).toBe(true);
    });
  });

  describe('deleteConversationSession', () => {
    it('should not throw when called', async () => {
      const conversation = { providerState: { sessionId: 'test' } } as Conversation;
      await expect(service.deleteConversationSession(conversation, '/tmp')).resolves.not.toThrow();
    });
  });

  describe('hydrateConversationHistory', () => {
    it('should not throw when called', async () => {
      const conversation = { providerState: { sessionId: 'test' } } as Conversation;
      await expect(service.hydrateConversationHistory(conversation, '/tmp')).resolves.not.toThrow();
    });
  });
});