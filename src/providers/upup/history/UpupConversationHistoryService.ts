import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

export class UpupConversationHistoryService implements ProviderConversationHistoryService {
  async deleteConversationSession(_conversation: Conversation, _vaultPath: string | null): Promise<void> {}

  async hydrateConversationHistory(_conversation: Conversation, _vaultPath: string | null): Promise<void> {}

  resolveSessionIdForConversation(_conversation: Conversation | null): string | null {
    return _conversation?.providerState?.sessionId as string | null ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return { sessionId: `upup-${Date.now()}` };
  }
}