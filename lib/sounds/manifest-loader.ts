import { isClient } from '@/lib/utils/is-client';
import type { SoundManifest } from './types';

const CACHE_KEY = 'vg-sound-manifest-v1';

interface CachedShape {
  version: number;
  data: SoundManifest;
}

/**
 * Plan 8.7 — load the Sound Library manifest with localStorage cache.
 *
 * Flow:
 *   1. Read the existing `localStorage` cache (if any) — best-effort,
 *      corrupted JSON is treated as a miss.
 *   2. Fetch `/api/sounds/manifest` (the BFF).
 *   3. If the BFF fails (network error, non-OK status), fall back to
 *      the cached value when present, else return `null`. The UI
 *      shows "Sound Library nicht verfügbar" on `null`.
 *   4. Compare `version`. If unchanged, the round-trip was just a
 *      heartbeat — we still use the fresh response (it may contain
 *      rotated R2 URLs) but skip re-writing localStorage.
 *   5. On version bump (or cache-miss), persist the fresh manifest.
 *
 * SSR / Capacitor: `isClient()` guard at the top returns `null` for
 * non-client environments so the caller (a `'use client'` bootstrap
 * component) can call this unconditionally.
 */
export async function loadSoundManifest(): Promise<SoundManifest | null> {
  if (!isClient()) return null;

  let cached: CachedShape | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw) as CachedShape;
  } catch {
    // Corrupted entry — fall through, treat as cache-miss.
  }

  let fresh: SoundManifest;
  try {
    const res = await fetch('/api/sounds/manifest');
    if (!res.ok) {
      return cached?.data ?? null;
    }
    fresh = (await res.json()) as SoundManifest;
  } catch {
    return cached?.data ?? null;
  }

  if (!cached || cached.version !== fresh.version) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ version: fresh.version, data: fresh } satisfies CachedShape)
      );
    } catch {
      // QuotaExceededError — still serve the fresh manifest, just
      // skip caching this round.
    }
  }

  return fresh;
}

/** Test-only — wipes the localStorage entry between cases. */
export function _resetSoundManifestCacheForTests(): void {
  if (isClient()) {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* noop */
    }
  }
}

/** Test-only — exposes the cache key so tests can seed/read directly. */
export const _SOUND_MANIFEST_CACHE_KEY = CACHE_KEY;
