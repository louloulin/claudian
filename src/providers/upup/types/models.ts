export const UPUP_PROVIDER_PREFIXES: [string, string][] = [
  ['openai', 'gpt-'],
  ['anthropic', 'claude-'],
  ['google', 'gemini-'],
  ['xai', 'grok-'],
  ['deepseek', 'deepseek-'],
  ['ollama', 'ollama/'],
  ['openrouter', 'openrouter/'],
  ['moonshot', 'kimi-'],
];

export const UPUP_DEFAULT_MODELS: Set<string> = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'claude-sonnet-4-7',
  'claude-haiku-4-5',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'grok-4',
  'grok-4-fast-reasoning',
  'deepseek-v4',
  'kimi-k2.5',
]);

export const UPUP_PRIMARY_MODEL = 'gpt-4o';
export const UPUP_CONTEXT_WINDOW = 200_000;
