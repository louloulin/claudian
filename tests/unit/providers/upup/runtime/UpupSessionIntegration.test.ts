/**
 * UpupSessionIntegration.test.ts
 * 集成测试 for Session 管理 - 验证 Transport 复用和 Session 持久化
 *
 * TDD: 测试 Session 管理的关键行为
 */

import type { SessionInfo, SessionMessage } from '../../../../../src/providers/upup/runtime/UpupSessionManager';
import { createUpupSessionManager,UpupSessionManager } from '../../../../../src/providers/upup/runtime/UpupSessionManager';

describe('UpupSessionManager Integration', () => {
  describe('Session 创建和 ID 管理', () => {
    it('should create session with unique ID', () => {
      const manager = createUpupSessionManager('conv-1');
      const session = manager.getCurrentSession();

      expect(session).not.toBeNull();
      expect(session?.id).toBeDefined();
      expect(session?.conversationId).toBe('conv-1');
    });

    it('should track message count', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Hello');
      manager.addAssistantMessage('Hi there!');

      expect(manager.getMessageCount()).toBe(2);
      expect(manager.getCurrentSession()?.messageCount).toBe(2);
    });

    it('should generate different IDs for different sessions', () => {
      const manager1 = createUpupSessionManager('conv-1');
      const manager2 = createUpupSessionManager('conv-2');

      expect(manager1.getSessionId()).not.toBe(manager2.getSessionId());
    });
  });

  describe('消息历史', () => {
    it('should return messages in order', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('First message');
      manager.addAssistantMessage('First response');
      manager.addUserMessage('Second message');

      const messages = manager.getMessages();

      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');
    });

    it('should provide history for API calls', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('What is the weather?');
      manager.addAssistantMessage('The weather is sunny.');

      const history = manager.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'What is the weather?' });
      expect(history[1]).toEqual({ role: 'assistant', content: 'The weather is sunny.' });
    });

    it('should provide formatted text history', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Hello');
      manager.addAssistantMessage('Hi!');

      const text = manager.getHistoryText();

      expect(text).toContain('User: Hello');
      expect(text).toContain('Assistant: Hi!');
    });
  });

  describe('Session 状态', () => {
    it('should have created status initially', () => {
      const manager = createUpupSessionManager('conv-1');

      expect(manager.getStatus()).toBe('created');
    });

    it('should mark session as active', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.markActive();

      expect(manager.getStatus()).toBe('active');
    });

    it('should pause session', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.pause();

      expect(manager.getStatus()).toBe('paused');
    });

    it('should complete session', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.complete();

      expect(manager.getStatus()).toBe('completed');
    });
  });

  describe('Token 使用追踪', () => {
    it('should update token usage', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.updateTokenUsage({
        inputTokens: 150,
        outputTokens: 250,
        totalTokens: 400,
      });

      const session = manager.getCurrentSession();

      expect(session?.tokenUsage).toBeDefined();
      expect(session?.tokenUsage?.totalTokens).toBe(400);
    });
  });

  describe('Session 持久化', () => {
    it('should call onSave callback when saving', async () => {
      let savedSession: SessionInfo | null = null;
      let savedMessages: SessionMessage[] | null = null;

      const onSave = async (session: SessionInfo, messages: SessionMessage[]) => {
        savedSession = session;
        savedMessages = messages;
      };

      const manager = new UpupSessionManager({ conversationId: 'conv-1' }, onSave);
      manager.create({ conversationId: 'conv-1' });
      manager.addUserMessage('Test message');

      await manager.save();

      expect(savedSession).not.toBeNull();
      expect(savedMessages).not.toBeNull();
      expect(savedMessages!.length).toBe(1);
      expect(savedMessages![0].content).toBe('Test message');
    });

    it('should load session and messages', () => {
      const manager = createUpupSessionManager('conv-1');

      const session: SessionInfo = {
        id: 'loaded-session-123',
        conversationId: 'conv-loaded',
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        messageCount: 1,
      };

      const messages: SessionMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Loaded message content',
          timestamp: new Date(),
        },
      ];

      manager.load(session, messages);

      expect(manager.getSessionId()).toBe('loaded-session-123');
      expect(manager.getMessages()).toHaveLength(1);
      expect(manager.getMessages()[0].content).toBe('Loaded message content');
    });
  });

  describe('历史清除', () => {
    it('should clear all messages', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Message 1');
      manager.addUserMessage('Message 2');
      manager.addUserMessage('Message 3');

      expect(manager.getMessageCount()).toBe(3);

      manager.clearHistory();

      expect(manager.getMessageCount()).toBe(0);
      expect(manager.hasHistory()).toBe(false);
    });

    it('should reset message count after clearing', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Message 1');
      manager.clearHistory();

      expect(manager.getCurrentSession()?.messageCount).toBe(0);
    });
  });

  describe('消息限制', () => {
    it('should respect maxMessages limit', () => {
      const manager = new UpupSessionManager(
        { conversationId: 'conv-1', maxMessages: 3 },
        undefined,
      );
      manager.create({ conversationId: 'conv-1' });

      // Add 5 messages
      for (let i = 1; i <= 5; i++) {
        manager.addUserMessage(`Message ${i}`);
      }

      // Should only keep last 3
      expect(manager.getMessageCount()).toBe(3);
      expect(manager.getMessages()[0].content).toBe('Message 3');
      expect(manager.getMessages()[2].content).toBe('Message 5');
    });
  });

  describe('重置', () => {
    it('should reset session completely', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Some message');
      manager.markActive();

      manager.reset();

      expect(manager.getCurrentSession()).toBeNull();
      expect(manager.getMessages()).toHaveLength(0);
      expect(manager.hasHistory()).toBe(false);
    });
  });

  describe('hasHistory', () => {
    it('should return false for empty session', () => {
      const manager = createUpupSessionManager('conv-1');

      expect(manager.hasHistory()).toBe(false);
    });

    it('should return true when messages exist', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Hello');

      expect(manager.hasHistory()).toBe(true);
    });

    it('should return false after clearHistory', () => {
      const manager = createUpupSessionManager('conv-1');

      manager.addUserMessage('Hello');
      manager.clearHistory();

      expect(manager.hasHistory()).toBe(false);
    });
  });
});