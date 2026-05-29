import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getR2Config } from '@/lib/storage/env';
import { putToR2, deleteFromR2 } from '@/lib/storage/r2-client';
import type { SoundManifest } from '@/lib/sounds/types';

export const runtime = 'nodejs';

/**
 * Plan 8.7b — admin delete with manifest-first ordering.
 *
 * Sequencing:
 *   1. Read current manifest.
 *   2. Locate the entry by id, build a "without-entry" manifest, write
 *      it back with `version + 1`.
 *   3. R2 DeleteObject on the MP3. If this fails we log a warning and
 *      still return 200 — an orphan MP3 in R2 is preferable to a
 *      "ghost" manifest entry that 404s for users.
 *   4. revalidatePath so the user BFF cache flushes.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 });
  }

  // === Step 1 — load manifest ===
  const { publicUrl } = getR2Config();
  const res = await fetch(`${publicUrl}/library/manifest.json`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'no manifest' }, { status: 404 });
  }
  const current = (await res.json()) as SoundManifest;

  let r2Key: string | null = null;
  const nextCategories = current.categories.map((c) => {
    const sounds = c.sounds.filter((s) => {
      if (s.id === id) {
        r2Key = `library/${s.url}`;
        return false;
      }
      return true;
    });
    return sounds.length === c.sounds.length ? c : { ...c, sounds };
  });

  if (!r2Key) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // === Step 2 — manifest-first: persist the WITHOUT-entry manifest ===
  const updated: SoundManifest = {
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    categories: nextCategories
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(updated));
  try {
    await putToR2('library/manifest.json', manifestBytes, 'application/json', {
      cacheControl: 'public, max-age=3600'
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'manifest write failed: ' + (e instanceof Error ? e.message : 'unknown')
      },
      { status: 502 }
    );
  }

  // === Step 3 — R2 DeleteObject (orphan-tolerant) ===
  try {
    await deleteFromR2(r2Key);
  } catch (e) {
    // Orphan MP3 — manifest already excludes the entry, so the user
    // never sees a 404. Log for later sweep.
    // eslint-disable-next-line no-console
    console.warn(
      `[admin/sounds] orphan MP3 left at ${r2Key}: ${e instanceof Error ? e.message : 'unknown'}`
    );
  }

  // === Step 4 — invalidate user BFF cache ===
  revalidatePath('/api/sounds/manifest');

  return NextResponse.json({ ok: true, version: updated.version });
}
