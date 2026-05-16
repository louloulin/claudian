/**
 * UpupSessionManager - 会话管理
 *
 * 管理 upup 对话的会话状态和消息历史
 */

import { randomUUID } from 'crypto';

// ============ Types ============

export interface SessionInfo {
  id: string;
  conversationId: string;
  status: 'active' | 'paused' | 'completed' | 'created';
  createdAt: Date;
  lastActiveAt: Date;
  messageCount: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tokens?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    result: unknown;
  }>;
}

export interface SessionConfig {
  id?: string;
  conversationId: string;
  maxMessages?: number;
  metadata?: Record<string, unknown>;
}

// ============ SessionManager ============

export class UpupSessionManager {
  private currentSession: SessionInfo | null = null;
  private messages: SessionMessage[] = [];
  private maxMessages: number;
  private onSave?: (session: SessionInfo, messages: SessionMessage[]) => Promise<void>;

  constructor(config: SessionConfig, onSave?: (session: SessionInfo, messages: SessionMessage[]) => Promise<void>) {
    this.maxMessages = config.maxMessages ?? 1000;
    this.onSave = onSave;
  }

  /**
   * 创建新会话
   */
  create(config?: Partial<SessionConfig>): SessionInfo {
    const conversationId = config?.conversationId ?? this.currentSession?.conversationId ?? randomUUID();

    this.currentSession = {
      id: config?.id ?? randomUUID(),
      conversationId,
      status: 'created',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      messageCount: 0,
      metadata: config?.metadata,
    };

    this.messages = [];

    return this.currentSession;
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): SessionInfo | null {
    return this.currentSession;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  /**
   * 获取会话状态
   */
  getStatus(): SessionInfo['status'] | null {
    return this.currentSession?.status ?? null;
  }

  /**
   * 添加用户消息
   */
  addUserMessage(content: string, metadata?: Partial<SessionMessage>): SessionMessage {
    return this.addMessage({
      id: randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
      ...metadata,
    });
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(content: string, metadata?: Partial<SessionMessage>): SessionMessage {
    return this.addMessage({
      id: randomUUID(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      ...metadata,
    });
  }

  /**
   * 添加消息
   */
  private addMessage(message: SessionMessage): SessionMessage {
    if (!this.currentSession) {
      this.create({ conversationId: randomUUID() });
    }

    this.messages.push(message);
    this.currentSession!.messageCount++;
    this.currentSession!.lastActiveAt = new Date();

    // 限制消息数量
    if (this.messages.length > this.maxMessages) {
      const removed = this.messages.shift();
      console.log('[UpupSessionManager] Message limit reached, removing oldest:', removed?.id);
    }

    return message;
  }

  /**
   * 获取所有消息
   */
  getMessages(): SessionMessage[] {
    return [...this.messages];
  }

  /**
   * 获取消息历史（用于传递给 upup）
   */
  getHistory(): Array<{ role: string; content: string }> {
    return this.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  /**
   * 获取历史文本（对话格式）
   */
  getHistoryText(): string {
    return this.messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * 更新 Token 使用量
   */
  updateTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): void {
    if (this.currentSession) {
      this.currentSession.tokenUsage = usage;
    }
  }

  /**
   * 标记会话为活动中
   */
  markActive(): void {
    if (this.currentSession) {
      this.currentSession.status = 'active';
      this.currentSession.lastActiveAt = new Date();
    }
  }

  /**
   * 暂停会话
   */
  pause(): void {
    if (this.currentSession) {
      this.currentSession.status = 'paused';
      this.currentSession.lastActiveAt = new Date();
    }
  }

  /**
   * 完成会话
   */
  complete(): void {
    if (this.currentSession) {
      this.currentSession.status = 'completed';
      this.currentSession.lastActiveAt = new Date();
    }
  }

  /**
   * 保存会话（调用回调）
   */
  async save(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.lastActiveAt = new Date();

    if (this.onSave) {
      await this.onSave(this.currentSession, this.messages);
    }
  }

  /**
   * 加载会话
   */
  load(session: SessionInfo, messages: SessionMessage[]): void {
    this.currentSession = session;
    this.messages = messages;
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.messages = [];
    if (this.currentSession) {
      this.currentSession.messageCount = 0;
    }
  }

  /**
   * 重置会话
   */
  reset(): void {
    this.currentSession = null;
    this.messages = [];
  }

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * 检查是否有历史
   */
  hasHistory(): boolean {
    return this.messages.length > 0;
  }
}

// ============ Factory ============

export function createUpupSessionManager(
  conversationId: string,
  onSave?: (session: SessionInfo, messages: SessionMessage[]) => Promise<void>,
): UpupSessionManager {
  const manager = new UpupSessionManager({ conversationId }, onSave);
  manager.create({ conversationId });
  return manager;
}