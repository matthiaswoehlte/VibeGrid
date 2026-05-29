import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getR2Config } from '@/lib/storage/env';
import { putToR2 } from '@/lib/storage/r2-client';
import type { SoundManifest, SoundEntry } from '@/lib/sounds/types';

export const runtime = 'nodejs';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const SUFFIX_LEN = 8;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    || 'sound';
}

/**
 * Plan 8.7b — atomic admin upload.
 *
 * Single endpoint that does both:
 *   1. PUT the MP3 to `library/sfx/<category>/<id>.mp3` in R2.
 *   2. Read the current manifest, merge the new entry, write back with
 *      `version + 1`.
 *
 * "Atomic" here means the two side-effects are sequenced inside one
 * request — the client sees a single 2xx / 4xx outcome. R2 is not
 * transactional; a manifest-write failure after a successful MP3 PUT
 * leaves an orphan MP3 (documented in KNOWN_LIMITATIONS).
 *
 * id = `<slug>-<8-char-uuid-suffix>` so two uploads with the same
 * label never collide on the R2 key.
 */
export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  const categoryRaw = form.get('category');
  const labelRaw = form.get('label');
  const tagsRaw = form.get('tags');
  const licenseRaw = form.get('license');
  const bpmRaw = form.get('bpm');
  const durationRaw = form.get('duration');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }
  // MIME-check on the SERVER (Defense in Depth — client validation can
  // be bypassed). file.type comes from the browser's content-type
  // detection on the source bytes.
  if (file.type !== 'audio/mpeg') {
    return NextResponse.json(
      { error: 'MP3 only (audio/mpeg required)' },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Max 10 MB' }, { status: 400 });
  }
  const category = typeof categoryRaw === 'string' ? categoryRaw.trim() : '';
  const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
  if (!category || !label) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }
  const duration = Number(durationRaw);
  if (!Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json({ error: 'invalid duration' }, { status: 400 });
  }
  let tags: string[] = [];
  if (typeof tagsRaw === 'string' && tagsRaw.length > 0) {
    try {
      const parsed = JSON.parse(tagsRaw) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      /* malformed tags → empty array, not an error */
    }
  }
  const license =
    typeof licenseRaw === 'string' && licenseRaw.trim().length > 0
      ? licenseRaw.trim()
      : undefined;
  const bpm =
    typeof bpmRaw === 'string' && bpmRaw.trim().length > 0
      ? Number(bpmRaw)
      : undefined;

  // === Step 1 — upload the MP3 ===
  const id = `${slugify(label)}-${crypto.randomUUID().slice(0, SUFFIX_LEN)}`;
  const r2Path = `sfx/${slugify(category)}/${id}.mp3`;
  const r2Key = `library/${r2Path}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await putToR2(r2Key, bytes, 'audio/mpeg', {
      cacheControl: 'public, max-age=31536000, immutable'
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'r2 upload failed: ' + (e instanceof Error ? e.message : 'unknown') },
      { status: 502 }
    );
  }

  // === Step 2 — read manifest, merge, write back ===
  const { publicUrl } = getR2Config();
  const manifestRes = await fetch(`${publicUrl}/library/manifest.json`, {
    cache: 'no-store'
  });
  const current: SoundManifest = manifestRes.ok
    ? ((await manifestRes.json()) as SoundManifest)
    : { version: 0, updatedAt: new Date().toISOString(), categories: [] };

  const entry: SoundEntry = {
    id,
    label,
    url: r2Path,
    duration,
    ...(bpm !== undefined && Number.isFinite(bpm) ? { bpm } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(license ? { license } : {})
  };

  const catId = slugify(category);
  const catIdx = current.categories.findIndex((c) => c.id === catId);
  const updatedCategories = current.categories.map((c) => ({ ...c, sounds: [...c.sounds] }));
  if (catIdx === -1) {
    updatedCategories.push({
      id: catId,
      label: category[0].toUpperCase() + category.slice(1),
      sounds: [entry]
    });
  } else {
    updatedCategories[catIdx].sounds.push(entry);
  }

  const updated: SoundManifest = {
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    categories: updatedCategories
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
          'manifest write failed: ' + (e instanceof Error ? e.message : 'unknown'),
        orphanKey: r2Key
      },
      { status: 502 }
    );
  }

  revalidatePath('/api/sounds/manifest');
  return NextResponse.json({ entry, version: updated.version });
}
