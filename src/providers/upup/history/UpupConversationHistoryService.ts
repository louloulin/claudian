/**
 * UpupConversationHistoryService - upup 历史服务
 *
 * 管理 upup provider 的对话历史和会话状态
 */

import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

export class UpupConversationHistoryService implements ProviderConversationHistoryService {
  async deleteConversationSession(_conversation: Conversation, _vaultPath: string | null): Promise<void> {
    // TODO: 实现会话删除
  }

  async hydrateConversationHistory(_conversation: Conversation, _vaultPath: string | null): Promise<void> {
    // TODO: 实现历史填充
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;

    const providerState = conversation?.providerState;
    if (!providerState || typeof providerState !== 'object') return null;

    // Check for fork source in provider state
    const forkSource = (providerState as { forkSource?: unknown }).forkSource;
    if (
      forkSource &&
      typeof forkSource === 'object' &&
      'sessionId' in forkSource &&
      typeof (forkSource as { sessionId: string }).sessionId === 'string'
    ) {
      return (forkSource as { sessionId: string }).sessionId;
    }

    // Fall back to sessionId
    return (providerState as { sessionId?: string })?.sessionId ?? null;
  }

  isPendingForkConversation(conversation: Conversation): boolean {
    const providerState = conversation?.providerState;
    if (!providerState || typeof providerState !== 'object') return false;

    const forkSource = (providerState as { forkSource?: unknown }).forkSource;
    return !!(
      forkSource &&
      typeof forkSource === 'object' &&
      'sessionId' in forkSource &&
      typeof (forkSource as { sessionId: string }).sessionId === 'string'
    );
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    // 返回 fork source 状态，用于后续会话解析
    return {
      sessionId: `upup-fork-${Date.now()}`,
      forkSource: {
        sessionId: sourceSessionId,
        resumeAt,
      },
      resumeAt,
      createdAt: new Date().toISOString(),
    };
  }
}