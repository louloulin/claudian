/**
 * UpupSessionStore.test.ts
 * 单元测试 for UpupSessionStore
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonSessionStore, FileSessionStore, createSessionStore } from '../../../../../src/providers/upup/storage/UpupSessionStore';
import type { SessionInfo, SessionMessage } from '../../../../../src/providers/upup/runtime/UpupSessionManager';

describe('JsonSessionStore', () => {
  let tmpDir: string;
  let store: JsonSessionStore;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `upup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    store = new JsonSessionStore(tmpDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('save and load', () => {
    it('should save and load a session', async () => {
      const session: SessionInfo = {
        id: 'test-session-1',
        conversationId: 'conv-1',
        status: 'active',
        createdAt: new Date('2026-01-01'),
        lastActiveAt: new Date('2026-01-02'),
        messageCount: 2,
      };

      const messages: SessionMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date('2026-01-01T10:00:00'),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
          timestamp: new Date('2026-01-01T10:00:01'),
        },
      ];

      await store.save(session, messages);

      const loaded = await store.load('test-session-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.session.id).toBe('test-session-1');
      expect(loaded!.session.conversationId).toBe('conv-1');
      expect(loaded!.session.status).toBe('active');
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].content).toBe('Hello');
      expect(loaded!.messages[1].content).toBe('Hi there!');
    });

    it('should preserve date objects', async () => {
      const session: SessionInfo = {
        id: 'test-session-2',
        conversationId: 'conv-2',
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        messageCount: 0,
      };

      await store.save(session, []);

      const loaded = await store.load('test-session-2');
      expect(loaded!.session.createdAt).toBeInstanceOf(Date);
      expect(loaded!.session.lastActiveAt).toBeInstanceOf(Date);
    });
  });

  describe('exists', () => {
    it('should return true for existing session', async () => {
      const session: SessionInfo = createTestSession('exists-test');
      await store.save(session, []);

      const exists = await store.exists('exists-test');
      expect(exists).toBe(true);
    });

    it('should return false for non-existing session', async () => {
      const exists = await store.exists('non-existing');
      expect(exists).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a session', async () => {
      const session: SessionInfo = createTestSession('delete-test');
      await store.save(session, []);

      expect(await store.exists('delete-test')).toBe(true);

      await store.delete('delete-test');

      expect(await store.exists('delete-test')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all sessions', async () => {
      for (let i = 1; i <= 3; i++) {
        const session = createTestSession(`list-test-${i}`);
        await store.save(session, []);
      }

      const sessions = await store.list();

      expect(sessions).toHaveLength(3);
      expect(sessions.map((s: SessionInfo) => s.id).sort()).toEqual([
        'list-test-1',
        'list-test-2',
        'list-test-3',
      ]);
    });

    it('should return empty array for empty directory', async () => {
      const sessions = await store.list();
      expect(sessions).toHaveLength(0);
    });

    it('should sort by lastActiveAt descending', async () => {
      const session1 = createTestSession('sort-1', new Date('2026-01-01'));
      const session2 = createTestSession('sort-2', new Date('2026-01-03'));
      const session3 = createTestSession('sort-3', new Date('2026-01-02'));

      await store.save(session1, []);
      await store.save(session2, []);
      await store.save(session3, []);

      const sessions = await store.list();

      expect(sessions[0].id).toBe('sort-2');
      expect(sessions[1].id).toBe('sort-3');
      expect(sessions[2].id).toBe('sort-1');
    });
  });

  describe('load non-existing', () => {
    it('should return null for non-existing session', async () => {
      const loaded = await store.load('non-existing');
      expect(loaded).toBeNull();
    });
  });
});

describe('FileSessionStore', () => {
  let tmpDir: string;
  let store: FileSessionStore;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `upup-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    store = new FileSessionStore(tmpDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('save and load', () => {
    it('should save and load a session', async () => {
      const session: SessionInfo = createTestSession('file-test-1');
      const messages: SessionMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Test message',
          timestamp: new Date(),
        },
      ];

      await store.save(session, messages);

      const loaded = await store.load('file-test-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.session.id).toBe('file-test-1');
      expect(loaded!.messages).toHaveLength(1);
    });
  });

  describe('exists', () => {
    it('should return true for existing session', async () => {
      const session: SessionInfo = createTestSession('file-exists-test');
      await store.save(session, []);

      expect(await store.exists('file-exists-test')).toBe(true);
    });
  });

  describe('list', () => {
    it('should list all sessions', async () => {
      for (let i = 1; i <= 2; i++) {
        const session = createTestSession(`file-list-${i}`);
        await store.save(session, []);
      }

      const sessions = await store.list();
      expect(sessions).toHaveLength(2);
    });
  });
});

describe('createSessionStore', () => {
  it('should create JsonSessionStore', () => {
    const store = createSessionStore('json', '/tmp/sessions');
    expect(store).toBeInstanceOf(JsonSessionStore);
  });

  it('should create FileSessionStore', () => {
    const store = createSessionStore('file', '/tmp/sessions');
    expect(store).toBeInstanceOf(FileSessionStore);
  });

  it('should default to JsonSessionStore', () => {
    const store = createSessionStore('unknown' as 'json', '/tmp/sessions');
    expect(store).toBeInstanceOf(JsonSessionStore);
  });
});

// ============ Helper ============

function createTestSession(
  id: string,
  lastActiveAt: Date = new Date(),
): SessionInfo {
  return {
    id,
    conversationId: `conv-${id}`,
    status: 'active',
    createdAt: new Date(),
    lastActiveAt,
    messageCount: 0,
  };
}