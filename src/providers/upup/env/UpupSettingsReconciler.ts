import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getUpupProviderSettings, updateUpupProviderSettings } from '../settings';
import { upupChatUIConfig } from '../ui/UpupChatUIConfig';

/**
 * Environment variable keys that affect upup provider behavior.
 * When these change, existing sessions should be invalidated.
 */
const UPUP_ENV_HASH_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'OLLAMA_BASE_URL',
  'OPENROUTER_API_KEY',
];

/**
 * Compute a hash of relevant upup environment variables.
 */
function computeUpupEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return UPUP_ENV_HASH_KEYS
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const upupSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'upup');
    const currentHash = computeUpupEnvHash(envText);
    const savedHash = getUpupProviderSettings(settings).environmentHash;

    // No change detected
    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    // Environment changed - invalidate all upup conversations
    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      if (conv.providerId === 'upup') {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

    // Try to resolve appropriate model based on available API keys
    const envVars = parseEnvironmentVariables(envText);
    const upupSettings = getUpupProviderSettings(settings);

    // Auto-detect provider based on available API keys
    if (envVars.OPENAI_API_KEY && upupSettings.provider === 'openai') {
      // OpenAI is available and selected - good
    } else if (envVars.ANTHROPIC_API_KEY && upupSettings.provider === 'anthropic') {
      // Anthropic is available and selected - good
    } else if (envVars.GOOGLE_API_KEY && upupSettings.provider === 'google') {
      // Google is available and selected - good
    }
    // Add more provider detection as needed

    updateUpupProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model as string;
    if (!model) {
      return false;
    }

    const normalizedModel = upupChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },

  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    const envText = getRuntimeEnvironmentText(settings, 'upup');
    const currentHash = computeUpupEnvHash(envText);
    const savedHash = getUpupProviderSettings(settings).environmentHash;
    return currentHash !== savedHash;
  },
};