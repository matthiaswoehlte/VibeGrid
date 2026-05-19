import type { ParamSchema } from '@/lib/renderer/types';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';

export interface FetchAutoPresetArgs {
  imageUrl: string;
  fxId: string;
  paramSchema: ParamSchema;
  endpoint?: string;
}

export async function fetchAutoPreset(args: FetchAutoPresetArgs): Promise<Record<string, unknown>> {
  const endpoint = args.endpoint ?? '/api/analyze-image';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageUrl: args.imageUrl, fxId: args.fxId })
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { code?: string; error?: string };
      detail = b.code || b.error || detail;
    } catch {
      // keep status
    }
    throw new Error(`Auto-preset failed: ${detail}`);
  }
  const body = (await res.json()) as { params: Record<string, unknown> };
  // Defensive client-side re-validation so a buggy server can't poison the store.
  return validateAgainstParamSchema(body.params, args.paramSchema);
}
