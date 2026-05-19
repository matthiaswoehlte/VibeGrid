import 'server-only';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

let cached: AnthropicConfig | null = null;

export function getAnthropicConfig(): AnthropicConfig {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error('Missing required env var: ANTHROPIC_API_KEY');
  }
  cached = { apiKey, model: 'claude-sonnet-4-6' };
  return cached;
}

export function _resetAnthropicConfigForTests(): void {
  cached = null;
}
