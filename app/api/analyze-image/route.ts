export const runtime = 'nodejs';

import { analyzeImageForFx } from '@/lib/ai/anthropic';
import { validateAgainstParamSchema } from '@/lib/ai/schema-validator';
import { getPlugin } from '@/lib/renderer/registry';
import { registerBuiltInPlugins } from '@/lib/fx';

interface ReqBody {
  imageUrl?: unknown;
  fxId?: unknown;
}

function bad(status: number, code: string, error: string): Response {
  return Response.json({ error, code }, { status });
}

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export async function POST(req: Request): Promise<Response> {
  registerBuiltInPlugins();

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return bad(400, 'INVALID_JSON', 'Body must be JSON');
  }
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const fxId = typeof body.fxId === 'string' ? body.fxId : '';
  if (!imageUrl || !fxId) {
    return bad(400, 'MISSING_FIELDS', 'imageUrl and fxId are required');
  }
  const plugin = getPlugin(fxId);
  if (!plugin) {
    return bad(404, 'UNKNOWN_FX', `Unknown fxId: ${fxId}`);
  }

  let imageBytes: Uint8Array;
  let imageMime: AllowedImageMime;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    // Strip MIME parameters (e.g. `image/webp; charset=binary`) — Anthropic
    // SDK only accepts the bare media_type.
    const rawMime = (imgRes.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIMES.has(rawMime)) {
      throw new Error(`unsupported image MIME for analyze: ${rawMime}`);
    }
    imageMime = rawMime as AllowedImageMime;
    imageBytes = new Uint8Array(await imgRes.arrayBuffer());
  } catch (err) {
    return bad(
      502,
      'IMAGE_FETCH_FAILED',
      err instanceof Error ? err.message : 'image fetch failed'
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = await analyzeImageForFx({
      imageBytes,
      imageMime,
      fxName: plugin.name,
      paramSchema: plugin.paramSchema
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.includes('Missing required env var')) {
      return bad(503, 'AI_NOT_CONFIGURED', msg);
    }
    return bad(502, 'AI_ERROR', msg);
  }

  const validated = validateAgainstParamSchema(raw, plugin.paramSchema);
  return Response.json({ fxId, params: validated }, { status: 200 });
}
