// Pure validation — intentionally NOT marked `server-only`. Imported by
// `lib/storage/auto-preset-adapter.ts` (client code) for defensive
// re-validation of any /api/analyze-image response. Living under `lib/ai/`
// because it's specific to the Auto-Preset feature; do not add `server-only`.
import type { ParamSchema, ParamType } from '@/lib/renderer/types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampSnap(v: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, v));
  if (step <= 0) return clamped;
  return Math.round((clamped - min) / step) * step + min;
}

function validateOne(raw: unknown, schema: ParamType & { label: string }): unknown {
  switch (schema.kind) {
    case 'slider': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return schema.default;
      return clampSnap(n, schema.min, schema.max, schema.step);
    }
    case 'color':
      return typeof raw === 'string' && HEX_RE.test(raw) ? raw : schema.default;
    case 'select':
      return typeof raw === 'string' && schema.options.some((o) => o.value === raw)
        ? raw
        : schema.default;
    case 'toggle':
      return Boolean(raw);
    default: {
      const _exhaustive: never = schema;
      void _exhaustive;
      return undefined;
    }
  }
}

export function validateAgainstParamSchema(
  raw: Record<string, unknown>,
  schema: ParamSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema)) {
    out[key] = validateOne(raw[key], sub);
  }
  return out;
}
