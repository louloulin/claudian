/**
 * UpupHistorySync - 历史同步
 *
 * 将对话历史同步到 upup 实现对话连续性
 */

import type ClaudianPlugin from '../../../main';
import type { SessionMessage } from '../runtime/UpupSessionManager';

// ============ Types ============

export interface HistorySyncConfig {
  maxHistoryMessages?: number;
  includeSystemPrompt?: boolean;
  systemPrompt?: string;
}

// ============ History Sync ============

export class UpupHistorySync {
  private config: HistorySyncConfig;

  constructor(
    private plugin: ClaudianPlugin,
    config?: HistorySyncConfig,
  ) {
    this.config = {
      maxHistoryMessages: config?.maxHistoryMessages ?? 50,
      includeSystemPrompt: config?.includeSystemPrompt ?? false,
      systemPrompt: config?.systemPrompt ?? this.getDefaultSystemPrompt(),
    };
  }

  /**
   * 获取系统提示
   */
  getSystemPrompt(): string {
    return this.config.systemPrompt ?? this.getDefaultSystemPrompt();
  }

  /**
   * 将历史消息编码为 upup 格式
   */
  encodeHistory(messages: SessionMessage[]): string[] {
    const result: string[] = [];

    // 添加系统提示（如果启用）
    if (this.config.includeSystemPrompt && this.config.systemPrompt) {
      result.push(`System: ${this.config.systemPrompt}`);
    }

    // 添加历史消息
    const limitedMessages = messages.slice(-this.config.maxHistoryMessages!);

    for (const msg of limitedMessages) {
      if (msg.role === 'system') {
        result.push(`System: ${msg.content}`);
      } else if (msg.role === 'user') {
        result.push(`User: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        result.push(`Assistant: ${msg.content}`);
      }
    }

    return result;
  }

  /**
   * 获取历史文本（用于传递给 upup）
   */
  getHistoryText(messages: SessionMessage[]): string {
    return this.encodeHistory(messages).join('\n');
  }

  /**
   * 获取历史作为消息数组（用于请求参数）
   */
  getHistoryAsMessages(messages: SessionMessage[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    // 添加系统消息（如果启用）
    if (this.config.includeSystemPrompt && this.config.systemPrompt) {
      result.push({ role: 'system', content: this.config.systemPrompt });
    }

    // 添加历史消息
    const limitedMessages = messages.slice(-this.config.maxHistoryMessages!);

    for (const msg of limitedMessages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  /**
   * 从 Claude Code 历史格式恢复
   */
  static fromClaudeHistory(claudeMessages: Array<{
    role: string;
    content: string;
    contentBlocks?: Array<{ type: string; content?: string }>;
  }>): SessionMessage[] {
    const result: SessionMessage[] = [];

    for (const msg of claudeMessages) {
      // 跳过系统注入消息
      if (msg.role === 'system' && msg.content.includes('[synthetic]')) {
        continue;
      }

      // 跳过 context_compacted 边界
      if (msg.contentBlocks?.some((b: { type: string }) => b.type === 'context_compacted')) {
        continue;
      }

      // 提取文本内容
      let textContent = msg.content;
      if (msg.contentBlocks) {
        const textBlocks = msg.contentBlocks
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { content?: string }) => b.content ?? '')
          .join('\n');
        if (textBlocks) {
          textContent = textBlocks;
        }
      }

      if (textContent) {
        result.push({
          id: `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: textContent,
          timestamp: new Date(),
        });
      }
    }

    return result;
  }

  /**
   * 获取默认系统提示
   */
  private getDefaultSystemPrompt(): string {
    return `You are interacting with an Obsidian vault. You can read and write files in the vault.
When reading files, use the file_read tool.
When writing files, use the file_write tool.
Be concise and helpful.`;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<HistorySyncConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): HistorySyncConfig {
    return { ...this.config };
  }
}

// ============ Factory ============

export function createHistorySync(
  plugin: ClaudianPlugin,
  config?: HistorySyncConfig,
): UpupHistorySync {
  return new UpupHistorySync(plugin, config);
}