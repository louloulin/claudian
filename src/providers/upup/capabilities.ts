import type { ProviderCapabilities } from '../../core/providers/types';

export const UPUP_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'upup',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: true,
  supportsProviderCommands: true,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: true,
  supportsTurnSteer: false,
  reasoningControl: 'none',
});
