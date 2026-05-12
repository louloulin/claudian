import type { ProviderRegistration } from '../../core/providers/types';
import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
  InstructionRefineService,
  ProviderTaskResultInterpreter,
  RefineProgressCallback,
  TitleGenerationCallback,
  TitleGenerationService,
} from '../../core/providers/types';
import type { InstructionRefineResult } from '../../core/types';
import { UPUP_PROVIDER_CAPABILITIES } from './capabilities';
import { upupSettingsReconciler } from './env/UpupSettingsReconciler';
import { UpupConversationHistoryService } from './history/UpupConversationHistoryService';
import { UpupChatRuntime } from './runtime/UpupChatRuntime';
import { getUpupProviderSettings } from './settings';
import { upupChatUIConfig } from './ui/UpupChatUIConfig';

class StubTitleGenerationService implements TitleGenerationService {
  async generateTitle(
    _conversationId: string,
    _userMessage: string,
    _callback: TitleGenerationCallback,
  ): Promise<void> {}

  cancel(): void {}
}

class StubInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {}
  cancel(): void {}

  async refineInstruction(
    rawInstruction: string,
    _existingInstructions: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: true, refinedInstruction: rawInstruction };
  }

  async continueConversation(
    _message: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: false, error: 'Not implemented' };
  }
}

class StubInlineEditService implements InlineEditService {
  resetConversation(): void {}
  cancel(): void {}

  async editText(_request: InlineEditRequest): Promise<InlineEditResult> {
    return { success: false, error: 'Not implemented' };
  }

  async continueConversation(
    _message: string,
    _contextFiles?: string[],
  ): Promise<InlineEditResult> {
    return { success: false, error: 'Not implemented' };
  }
}

const stubTaskResultInterpreter: ProviderTaskResultInterpreter = {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  },
  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  },
  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  },
  resolveTerminalStatus(_toolUseResult: unknown, fallbackStatus: 'completed' | 'error'): 'completed' | 'error' {
    return fallbackStatus;
  },
  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  },
};

export const upupProviderRegistration: ProviderRegistration = {
  displayName: 'Upup',
  blankTabOrder: 25,
  isEnabled: (settings) => getUpupProviderSettings(settings).enabled,
  capabilities: UPUP_PROVIDER_CAPABILITIES,
  environmentKeyPatterns: [/^OPENAI_/i, /^ANTHROPIC_/i, /^UPUP_/i],
  chatUIConfig: upupChatUIConfig,
  settingsReconciler: upupSettingsReconciler,
  createRuntime: ({ plugin }) => new UpupChatRuntime(plugin),
  createTitleGenerationService: () => new StubTitleGenerationService(),
  createInstructionRefineService: () => new StubInstructionRefineService(),
  createInlineEditService: () => new StubInlineEditService(),
  historyService: new UpupConversationHistoryService(),
  taskResultInterpreter: stubTaskResultInterpreter,
};