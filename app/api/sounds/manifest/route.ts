import { NextResponse } from 'next/server';
import { getR2Config } from '@/lib/storage/env';
import type { SoundManifest } from '@/lib/sounds/types';

// Edge runtime can't import `lib/storage/env.ts` (server-only + Node-API).
export const runtime = 'nodejs';

/**
 * Plan 8.7 — BFF for the Sound Library manifest.
 *
 * `R2_PUBLIC_URL` lives in `lib/storage/env.ts` which is `'server-only'`
 * — we can't fetch the manifest directly from the client without leaking
 * the URL into the bundle. This route fetches the R2-hosted manifest on
 * the server, rewrites every `sound.url` from a R2-relative path
 * (`sfx/braams/heavy-01.mp3`) to an absolute URL the browser can fetch
 * directly, and returns the patched manifest.
 *
 * Server-side cache: 1 h via `next: { revalidate }`. The client cache
 * lives in `lib/sounds/manifest-loader.ts` (localStorage, keyed by
 * `manifest.version`).
 */
export async function GET(): Promise<Response> {
  let publicUrl: string;
  try {
    ({ publicUrl } = getR2Config());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'r2 config missing' },
      { status: 500 }
    );
  }

  const manifestUrl = `${publicUrl}/library/manifest.json`;
  let raw: Response;
  try {
    raw = await fetch(manifestUrl, { next: { revalidate: 3600 } });
  } catch (e) {
    return NextResponse.json(
      {
        error: `r2 fetch threw: ${e instanceof Error ? e.message : 'unknown'}`
      },
      { status: 502 }
    );
  }
  if (!raw.ok) {
    return NextResponse.json(
      { error: `manifest fetch failed: ${raw.status}` },
      { status: 502 }
    );
  }

  let manifest: SoundManifest;
  try {
    manifest = (await raw.json()) as SoundManifest;
  } catch (e) {
    return NextResponse.json(
      { error: `manifest parse failed: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 }
    );
  }

  // Patch relative `sound.url` paths into absolute R2 URLs.
  const base = `${publicUrl}/library/`;
  const patched: SoundManifest = {
    ...manifest,
    categories: manifest.categories.map((cat) => ({
      ...cat,
      sounds: cat.sounds.map((s) => ({ ...s, url: `${base}${s.url}` }))
    }))
  };

  return NextResponse.json(patched);
}
