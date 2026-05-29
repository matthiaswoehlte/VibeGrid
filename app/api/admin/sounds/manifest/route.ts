import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getR2Config } from '@/lib/storage/env';
import { putToR2 } from '@/lib/storage/r2-client';
import type { SoundManifest } from '@/lib/sounds/types';

export const runtime = 'nodejs';

/**
 * Plan 8.7b — admin reads the RAW manifest (relative URLs, unrewritten)
 * so the UI can edit + re-PUT without round-tripping through the user
 * BFF's URL rewriter.
 *
 * Returns an empty skeleton when R2 has no manifest yet — that's the
 * normal first-time-empty case, not an error.
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const { publicUrl } = getR2Config();
  const res = await fetch(`${publicUrl}/library/manifest.json`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    return NextResponse.json({
      version: 0,
      updatedAt: new Date().toISOString(),
      categories: []
    } satisfies SoundManifest);
  }
  return NextResponse.json(await res.json());
}

/**
 * Plan 8.7b — overwrite the manifest. Used by:
 *   - inline category-label edits,
 *   - sound-entry edits (label / tags / license / bpm),
 *   - moving entries between categories.
 *
 * Auto-increments `version` so the client `loadSoundManifest` cache
 * invalidates. Triggers `revalidatePath` so the user BFF's Next.js
 * cache flushes too.
 */
export async function PUT(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  let body: SoundManifest;
  try {
    body = (await req.json()) as SoundManifest;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray(body.categories) ||
    typeof body.version !== 'number'
  ) {
    return NextResponse.json({ error: 'invalid manifest shape' }, { status: 400 });
  }

  const updated: SoundManifest = {
    ...body,
    version: body.version + 1,
    updatedAt: new Date().toISOString()
  };
  const bytes = new TextEncoder().encode(JSON.stringify(updated));
  await putToR2('library/manifest.json', bytes, 'application/json', {
    cacheControl: 'public, max-age=3600'
  });
  revalidatePath('/api/sounds/manifest');
  return NextResponse.json({ ok: true, version: updated.version });
}
