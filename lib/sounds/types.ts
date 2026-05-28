/**
 * Plan 8.7 — Sound Library Manifest Format.
 *
 * Versioned JSON document hosted at `${R2_PUBLIC_URL}/library/manifest.json`.
 * Client never reads R2 directly — `/api/sounds/manifest` (BFF) patches
 * relative `url` paths to absolute R2 URLs before returning to the client.
 *
 * Cache invalidation key: `manifest.version`. Bumped by the (future) admin
 * upload flow whenever a sound is added / removed / replaced.
 */

export interface SoundEntry {
  /** Stable id, used to deduplicate MediaRefs (`library-${id}`). */
  id: string;
  /** Human-readable label shown in the library + Inspector. */
  label: string;
  /**
   * R2-relative path inside `library/` as stored in the source manifest
   * (e.g. `'sfx/braams/braam-heavy-01.mp3'`). The BFF rewrites this to an
   * absolute URL before the client ever sees it, so client-side code can
   * treat `url` as a ready-to-fetch absolute string.
   */
  url: string;
  /** Source-file duration in seconds — used to derive `lengthBeats`. */
  duration: number;
  /** Optional source BPM (informational for later BPM-snap features). */
  bpm?: number;
  /** Free-text tags for client-side search ("dark", "cinematic", ...). */
  tags?: string[];
  /** Optional license string shown in the Inspector when present. */
  license?: string;
}

export interface SoundCategory {
  /** Stable id, 1:1 with R2-Verzeichnis (`'braams'`, `'whoosh'`, ...). */
  id: string;
  /** Display label ("Braams"). */
  label: string;
  /** Optional emoji shown in the accordion header. */
  icon?: string;
  sounds: SoundEntry[];
}

export interface SoundManifest {
  /** Cache-invalidation key — client compares against `localStorage` value. */
  version: number;
  /** ISO-8601 timestamp of the last admin-side regeneration. */
  updatedAt: string;
  categories: SoundCategory[];
}
