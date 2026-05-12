import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';

export type UpupLLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'ollama'
  | 'openrouter'
  | 'moonshot';

export interface UpupProviderSettings {
  enabled: boolean;
  model: string;
  provider: UpupLLMProvider;
  enabledProviders: Record<UpupLLMProvider, boolean>;
  apiKeys: Partial<Record<UpupLLMProvider, string>>;
  apiBases: Partial<Record<UpupLLMProvider, string>>;
  environmentVariables: Record<string, string>;
  defaultAgentId: string;
  mcpServers: string[];
  cliPath: string;
  loadUserSettings: boolean;
  /** Hash of environment variables for change detection */
  environmentHash?: string;
}

export const DEFAULT_UPUP_PROVIDER_SETTINGS: UpupProviderSettings = {
  enabled: true,
  model: 'gpt-4o',
  provider: 'openai',
  enabledProviders: {
    openai: true,
    anthropic: true,
    google: false,
    xai: false,
    deepseek: false,
    ollama: false,
    openrouter: false,
    moonshot: false,
  },
  apiKeys: {},
  apiBases: {},
  environmentVariables: {},
  defaultAgentId: 'research-analyst',
  mcpServers: [],
  cliPath: 'bun',
  loadUserSettings: false,
};

export function getUpupProviderSettings(
  settings: Record<string, unknown>,
): UpupProviderSettings {
  const raw = getProviderConfig(settings, 'upup') as Partial<UpupProviderSettings> | undefined;
  return { ...DEFAULT_UPUP_PROVIDER_SETTINGS, ...raw };
}

export function updateUpupProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<UpupProviderSettings>,
): void {
  const current = getProviderConfig(settings, 'upup') as Partial<UpupProviderSettings> | undefined;
  setProviderConfig(settings, 'upup', { ...current, ...updates });
}
