/**
 * UpupSessionManager.test.ts
 * 单元测试 for UpupSessionManager
 */

import { UpupSessionManager, SessionInfo, SessionMessage, createUpupSessionManager } from '../../../../../src/providers/upup/runtime/UpupSessionManager';

describe('UpupSessionManager', () => {
  describe('create', () => {
    it('should create a new session', () => {
      const manager = createUpupSessionManager('conv-123');
      const session = manager.getCurrentSession();

      expect(session).not.toBeNull();
      expect(session?.conversationId).toBe('conv-123');
      expect(session?.status).toBe('created');
      expect(session?.messageCount).toBe(0);
    });

    it('should generate unique session IDs', () => {
      const manager1 = createUpupSessionManager('conv-1');
      const manager2 = createUpupSessionManager('conv-2');

      expect(manager1.getSessionId()).not.toBe(manager2.getSessionId());
    });
  });

  describe('addUserMessage', () => {
    it('should add user message and increment count', () => {
      const manager = createUpupSessionManager('conv-123');
      const message = manager.addUserMessage('Hello, upup!');

      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, upup!');
      expect(manager.getMessageCount()).toBe(1);
      expect(manager.getCurrentSession()?.messageCount).toBe(1);
    });

    it('should add multiple messages', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('First message');
      manager.addAssistantMessage('First response');
      manager.addUserMessage('Second message');

      expect(manager.getMessageCount()).toBe(3);
    });
  });

  describe('addAssistantMessage', () => {
    it('should add assistant message', () => {
      const manager = createUpupSessionManager('conv-123');
      const message = manager.addAssistantMessage('I am upup!');

      expect(message.role).toBe('assistant');
      expect(message.content).toBe('I am upup!');
    });
  });

  describe('getMessages', () => {
    it('should return all messages', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('User message');
      manager.addAssistantMessage('Assistant message');

      const messages = manager.getMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should return a copy of messages array', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('Test');

      const messages1 = manager.getMessages();
      const messages2 = manager.getMessages();

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });
  });

  describe('getHistory', () => {
    it('should return history as role/content pairs', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('User message');
      manager.addAssistantMessage('Assistant message');

      const history = manager.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'User message' });
      expect(history[1]).toEqual({ role: 'assistant', content: 'Assistant message' });
    });
  });

  describe('getHistoryText', () => {
    it('should return formatted history text', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('Hello');
      manager.addAssistantMessage('Hi there!');

      const text = manager.getHistoryText();

      expect(text).toContain('User: Hello');
      expect(text).toContain('Assistant: Hi there!');
    });
  });

  describe('clearHistory', () => {
    it('should clear all messages', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('Test');
      manager.addAssistantMessage('Response');

      manager.clearHistory();

      expect(manager.getMessageCount()).toBe(0);
      expect(manager.getMessages()).toHaveLength(0);
      expect(manager.hasHistory()).toBe(false);
    });
  });

  describe('save', () => {
    it('should call onSave callback', async () => {
      let savedSession: SessionInfo | null = null;
      let savedMessages: SessionMessage[] | null = null;

      const onSave = async (session: SessionInfo, messages: SessionMessage[]) => {
        savedSession = session;
        savedMessages = messages;
      };

      const manager = new UpupSessionManager({ conversationId: 'conv-123' }, onSave);
      manager.create({ conversationId: 'conv-123' });
      manager.addUserMessage('Test message');

      await manager.save();

      expect((savedSession as SessionInfo | null)?.id).toBe(manager.getSessionId());
      expect(savedMessages).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('should load session and messages', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.addUserMessage('Original message');

      const session: SessionInfo = {
        id: 'new-session',
        conversationId: 'conv-456',
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        messageCount: 1,
      };

      const messages: SessionMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Loaded message',
          timestamp: new Date(),
        },
      ];

      manager.load(session, messages);

      expect(manager.getSessionId()).toBe('new-session');
      expect(manager.getMessageCount()).toBe(1);
      expect(manager.getMessages()[0].content).toBe('Loaded message');
    });
  });

  describe('status management', () => {
    it('should mark session as active', () => {
      const manager = createUpupSessionManager('conv-123');
      expect(manager.getStatus()).toBe('created');

      manager.markActive();
      expect(manager.getStatus()).toBe('active');
    });

    it('should pause session', () => {
      const manager = createUpupSessionManager('conv-123');
      manager.markActive();

      manager.pause();
      expect(manager.getStatus()).toBe('paused');
    });

    it('should complete session', () => {
      const manager = createUpupSessionManager('conv-123');

      manager.complete();
      expect(manager.getStatus()).toBe('completed');
    });
  });

  describe('token usage', () => {
    it('should update token usage', () => {
      const manager = createUpupSessionManager('conv-123');

      manager.updateTokenUsage({
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      const session = manager.getCurrentSession();
      expect(session?.tokenUsage?.totalTokens).toBe(300);
    });
  });

  describe('message limit', () => {
    it('should limit messages when maxMessages is set', () => {
      const manager = new UpupSessionManager(
        { conversationId: 'conv-123', maxMessages: 3 },
        undefined,
      );
      manager.create({ conversationId: 'conv-123' });

      // Add 5 messages
      for (let i = 1; i <= 5; i++) {
        manager.addUserMessage(`Message ${i}`);
      }

      expect(manager.getMessageCount()).toBe(3);
      // Should keep the last 3 messages
      expect(manager.getMessages()[0].content).toBe('Message 3');
      expect(manager.getMessages()[2].content).toBe('Message 5');
    });
  });
});