import { getProviderConfig } from '../../../core/providers/providerConfig';
import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import type { UpupProviderSettings } from '../settings';
import { UPUP_DEFAULT_MODELS } from '../types/models';

const EFFORT_LEVELS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const UPUP_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

function buildModelOptions(settings: UpupProviderSettings | undefined): ProviderUIOption[] {
  const options: ProviderUIOption[] = [];
  const { enabledProviders } = settings ?? {};

  if (enabledProviders?.openai) {
    options.push(
      { group: 'OpenAI', label: 'GPT-4.1', value: 'gpt-4.1' },
      { group: 'OpenAI', label: 'GPT-4o', value: 'gpt-4o' },
      { group: 'OpenAI', label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    );
  }
  if (enabledProviders?.anthropic) {
    options.push(
      { group: 'Anthropic', label: 'Claude Sonnet 4.7', value: 'claude-sonnet-4-7' },
      { group: 'Anthropic', label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
      { group: 'Anthropic', label: 'Claude Haiku 4', value: 'claude-haiku-4-5' },
    );
  }
  if (enabledProviders?.google) {
    options.push(
      { group: 'Google', label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
      { group: 'Google', label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    );
  }
  if (enabledProviders?.xai) {
    options.push(
      { group: 'xAI', label: 'Grok 4', value: 'grok-4' },
      { group: 'xAI', label: 'Grok 4 Fast', value: 'grok-4-fast-reasoning' },
    );
  }
  if (enabledProviders?.deepseek) {
    options.push(
      { group: 'DeepSeek', label: 'DeepSeek V4', value: 'deepseek-v4' },
      { group: 'DeepSeek', label: 'DeepSeek Chat', value: 'deepseek-chat' },
    );
  }
  if (enabledProviders?.ollama) {
    options.push(
      { group: 'Ollama', label: 'Local Models', value: 'ollama/*' },
    );
  }
  if (enabledProviders?.openrouter) {
    options.push(
      { group: 'OpenRouter', label: 'OpenRouter Models', value: 'openrouter/*' },
    );
  }
  if (enabledProviders?.moonshot) {
    options.push(
      { group: 'Moonshot', label: 'Kimi K2.5', value: 'kimi-k2.5' },
    );
  }

  return options;
}

export const upupChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const upupSettings = getProviderConfig(settings, 'upup') as Partial<UpupProviderSettings> | undefined;
    return buildModelOptions(upupSettings as UpupProviderSettings | undefined);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    const options = this.getModelOptions(settings);
    if (options.some((o) => o.value === model)) return true;
    const lower = model.toLowerCase();
    return (
      lower.startsWith('gpt-') ||
      lower.startsWith('claude-') ||
      lower.startsWith('gemini-') ||
      lower.startsWith('grok-') ||
      lower.startsWith('deepseek-') ||
      lower.startsWith('kimi-') ||
      lower.startsWith('ollama/') ||
      lower.startsWith('openrouter/')
    );
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...EFFORT_LEVELS];
  },

  getDefaultReasoningValue(): string {
    return 'medium';
  },

  getContextWindowSize(): number {
    return 200_000;
  },

  isDefaultModel(model: string): boolean {
    return UPUP_DEFAULT_MODELS.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object') return;
    const s = settings as Record<string, unknown>;
    s['upupModel'] = model;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const options = this.getModelOptions(settings);
    if (options.some((o) => o.value === model)) return model;
    return 'gpt-4o';
  },

  getCustomModelIds(_envVars: Record<string, string>): Set<string> {
    return new Set();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return UPUP_PERMISSION_MODE_TOGGLE;
  },

  getProviderIcon() {
    return null;
  },
};