import { findEffectiveAudioEndSec } from '@/lib/audio/trailing-silence';

/**
 * Plan 8d — probe the actual playable duration of a video or audio file
 * on R2 without downloading the full bytes. Uses preload="metadata" so
 * the browser fetches just the moov atom / file header. Typical metadata
 * fetch is ~50 ms over fast network, ~200 ms over mobile.
 *
 * Why this exists: SceneFlow stores a user-intent `scene.duration`
 * (e.g. "5 seconds" matching the Kling-model duration option), but the
 * actual rendered file can be shorter (lipsync cuts the neutral video
 * to audio length) or longer (Kling pads to its discrete duration).
 * Trusting `scene.duration` for clip layout means the timeline window
 * doesn't match the playable content — user sees a freeze on the last
 * frame OR the clip ends mid-scene.
 *
 * Returns null on any failure (CORS block, network error, codec
 * mismatch). Callers should fall back to a known-good default.
 *
 * SSR-safe: returns null when `document` is unavailable.
 */
/**
 * Plan 8d — fetch + decode an audio file and return its EFFECTIVE
 * duration with trailing silence trimmed. Heavier than `getMediaDuration`
 * (downloads + decodes the whole file) but the only way to detect the
 * MP3 zero-padding issue that adds 100+ s of silence to the file's
 * reported duration. Used by the Transfer flow for sync-audio so the
 * timeline clip-bar reflects the audible music end, not the file end.
 *
 * Returns null on any failure. SSR-safe.
 */
export async function getEffectiveAudioDuration(
  url: string
): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  if (typeof AudioContext === 'undefined') {
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    if (!w.webkitAudioContext) return null;
  }
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const Ctor =
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? AudioContext;
    const ctx = new Ctor();
    try {
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      const trim = findEffectiveAudioEndSec(
        audioBuffer.getChannelData(0),
        audioBuffer.sampleRate
      );
      return trim.effectiveDurationSec;
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

export async function getMediaDuration(
  url: string,
  kind: 'video' | 'audio',
  timeoutMs = 4000
): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  return new Promise<number | null>((resolve) => {
    const el = document.createElement(
      kind === 'video' ? 'video' : 'audio'
    ) as HTMLMediaElement;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      el.removeEventListener('loadedmetadata', onLoad);
      el.removeEventListener('error', onErr);
      // Free the element's bytes-buffer reservation.
      try {
        el.src = '';
        el.load();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    const onLoad = (): void => {
      const d = el.duration;
      // duration can be NaN (no metadata) or Infinity (live stream).
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    const onErr = (): void => finish(null);
    el.addEventListener('loadedmetadata', onLoad);
    el.addEventListener('error', onErr);
    el.preload = 'metadata';
    el.crossOrigin = 'anonymous';
    timer = setTimeout(() => finish(null), timeoutMs);
    el.src = url;
  });
}
