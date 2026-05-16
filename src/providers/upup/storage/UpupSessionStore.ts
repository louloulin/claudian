/**
 * UpupSessionStore - 会话存储
 *
 * 持久化会话消息到文件系统
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SessionInfo, SessionMessage } from '../runtime/UpupSessionManager';

// ============ Types ============

export interface SessionStore {
  save(session: SessionInfo, messages: SessionMessage[]): Promise<void>;
  load(sessionId: string): Promise<{ session: SessionInfo; messages: SessionMessage[] } | null>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
  exists(sessionId: string): Promise<boolean>;
}

// ============ JSON Session Store ============

/**
 * JSON Session Store
 *
 * 将会话存储为 JSON 文件
 * 结构: {basePath}/{sessionId}/session.json + messages.json
 */
export class JsonSessionStore implements SessionStore {
  constructor(private basePath: string) {}

  async save(session: SessionInfo, messages: SessionMessage[]): Promise<void> {
    const dir = this.getSessionDir(session.id);
    await fs.promises.mkdir(dir, { recursive: true });

    const sessionFile = path.join(dir, 'session.json');
    const messagesFile = path.join(dir, 'messages.json');

    const sessionData = {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
    };

    const messagesData = messages.map(m => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    }));

    await Promise.all([
      fs.promises.writeFile(sessionFile, JSON.stringify(sessionData, null, 2), 'utf-8'),
      fs.promises.writeFile(messagesFile, JSON.stringify(messagesData, null, 2), 'utf-8'),
    ]);

    console.log('[JsonSessionStore] Saved session:', session.id, 'messages:', messages.length);
  }

  async load(sessionId: string): Promise<{ session: SessionInfo; messages: SessionMessage[] } | null> {
    const sessionFile = path.join(this.getSessionDir(sessionId), 'session.json');
    const messagesFile = path.join(this.getSessionDir(sessionId), 'messages.json');

    if (!await this.exists(sessionId)) {
      return null;
    }

    try {
      const [sessionRaw, messagesRaw] = await Promise.all([
        fs.promises.readFile(sessionFile, 'utf-8'),
        fs.promises.readFile(messagesFile, 'utf-8'),
      ]);

      const sessionData = JSON.parse(sessionRaw);
      const messagesData = JSON.parse(messagesRaw);

      return {
        session: {
          ...sessionData,
          createdAt: new Date(sessionData.createdAt),
          lastActiveAt: new Date(sessionData.lastActiveAt),
        },
        messages: messagesData.map((m: SessionMessage & { timestamp: string }) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };
    } catch (err) {
      console.error('[JsonSessionStore] Failed to load session:', sessionId, err);
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      console.log('[JsonSessionStore] Deleted session:', sessionId);
    } catch (err) {
      console.error('[JsonSessionStore] Failed to delete session:', sessionId, err);
    }
  }

  async list(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    if (!await this.existsSync(this.basePath)) {
      return sessions;
    }

    try {
      const entries = await fs.promises.readdir(this.basePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionFile = path.join(this.basePath, entry.name, 'session.json');
          if (await this.existsSync(sessionFile)) {
            try {
              const raw = await fs.promises.readFile(sessionFile, 'utf-8');
              const data = JSON.parse(raw);
              sessions.push({
                ...data,
                createdAt: new Date(data.createdAt),
                lastActiveAt: new Date(data.lastActiveAt),
              });
            } catch {
              // Ignore invalid files
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return sessions.sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.existsSync(path.join(this.getSessionDir(sessionId), 'session.json'));
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.basePath, sessionId);
  }

  private existsSync(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// ============ File Session Store ============

/**
 * File Session Store
 *
 * 将会话存储为单个文件
 */
export class FileSessionStore implements SessionStore {
  constructor(private basePath: string) {}

  async save(session: SessionInfo, messages: SessionMessage[]): Promise<void> {
    await fs.promises.mkdir(this.basePath, { recursive: true });

    const file = path.join(this.basePath, `${session.id}.json`);

    const data = {
      session: {
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
      },
      messages: messages.map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
      })),
    };

    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[FileSessionStore] Saved session:', session.id);
  }

  async load(sessionId: string): Promise<{ session: SessionInfo; messages: SessionMessage[] } | null> {
    const file = path.join(this.basePath, `${sessionId}.json`);

    if (!await this.exists(sessionId)) {
      return null;
    }

    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      const data = JSON.parse(raw);

      return {
        session: {
          ...data.session,
          createdAt: new Date(data.session.createdAt),
          lastActiveAt: new Date(data.session.lastActiveAt),
        },
        messages: data.messages.map((m: SessionMessage & { timestamp: string }) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };
    } catch (err) {
      console.error('[FileSessionStore] Failed to load session:', sessionId, err);
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const file = path.join(this.basePath, `${sessionId}.json`);
    try {
      await fs.promises.unlink(file);
      console.log('[FileSessionStore] Deleted session:', sessionId);
    } catch {
      // Ignore errors
    }
  }

  async list(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    if (!await this.existsSync(this.basePath)) {
      return sessions;
    }

    try {
      const files = await fs.promises.readdir(this.basePath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const raw = await fs.promises.readFile(path.join(this.basePath, file), 'utf-8');
            const data = JSON.parse(raw);
            if (data.session) {
              sessions.push({
                ...data.session,
                createdAt: new Date(data.session.createdAt),
                lastActiveAt: new Date(data.session.lastActiveAt),
              });
            }
          } catch {
            // Ignore invalid files
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return sessions.sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.existsSync(path.join(this.basePath, `${sessionId}.json`));
  }

  private existsSync(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// ============ Factory ============

export function createSessionStore(
  type: 'json' | 'file' = 'json',
  basePath: string,
): SessionStore {
  switch (type) {
    case 'json':
      return new JsonSessionStore(basePath);
    case 'file':
      return new FileSessionStore(basePath);
    default:
      return new JsonSessionStore(basePath);
  }
}