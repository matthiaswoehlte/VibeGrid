import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicConfig } from './env';
import type { ParamSchema } from '@/lib/renderer/types';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const cfg = getAnthropicConfig();
  client = new Anthropic({ apiKey: cfg.apiKey });
  return client;
}

// Internal alias kept so analyzeImageForFx code below stays untouched.
function getClient(): Anthropic {
  return getAnthropicClient();
}

export function _resetAnthropicClientForTests(): void {
  client = null;
}

type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Asks Claude to suggest FX parameters for the given image.
 * Returns the raw object (server route validates against the schema after).
 */
export async function analyzeImageForFx(args: {
  imageBytes: Uint8Array;
  imageMime: AllowedImageMime;
  fxName: string;
  paramSchema: ParamSchema;
}): Promise<Record<string, unknown>> {
  const cfg = getAnthropicConfig();
  const cli = getClient();

  const base64 = Buffer.from(args.imageBytes).toString('base64');
  const schemaSummary = Object.entries(args.paramSchema)
    .map(([k, s]) => {
      switch (s.kind) {
        case 'slider':
          return `- ${k}: number in [${s.min}, ${s.max}], step ${s.step}`;
        case 'color':
          return `- ${k}: hex color (#rrggbb)`;
        case 'select':
          return `- ${k}: one of ${s.options.map((o) => `"${o.value}"`).join(', ')}`;
        case 'toggle':
          return `- ${k}: boolean`;
      }
    })
    .join('\n');

  const sys = `You suggest visual-effect parameter values that match the mood and content of an image. Return ONLY a JSON object — no prose, no markdown fences.`;
  const userText = `Effect: "${args.fxName}". Choose values for each parameter:\n${schemaSummary}\n\nReturn a JSON object whose keys exactly match the parameter names above.`;

  const res = await cli.messages.create({
    model: cfg.model,
    max_tokens: 512,
    system: sys,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: args.imageMime, data: base64 }
          },
          { type: 'text', text: userText }
        ]
      }
    ]
  });

  const textBlock = res.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('analyzeImageForFx: no text content in Claude response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text.trim());
  } catch {
    throw new Error('analyzeImageForFx: response is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('analyzeImageForFx: response is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
