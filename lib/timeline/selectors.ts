import {
  SNAP_TO_BEATS,
  type Clip,
  type SnapMode,
  type TimelineState
} from './types';
import type { Track } from './types';
import { fxSortIndex, type TrackFxKind } from './plugin-mapping';

export function snapBeats(beats: number, mode: SnapMode): number {
  if (mode === 'off') return beats;
  const step = SNAP_TO_BEATS[mode];
  return Math.round(beats / step) * step;
}

/**
 * Plan 8d — top-pin the singleton SceneFlow tracks above everything else.
 *
 *  1. sync-audio (0 or 1)
 *  2. main-video (0 or 1)
 *  3. all other tracks in their existing array order
 *
 *  Used by Tracks.tsx to render the lane stack. Drag-to-reorder skips
 *  the top two (TrackHeader checks track.kind before enabling drag).
 */
export function sortedTracks(tracks: Track[]): Track[] {
  const sync = tracks.filter((t) => t.kind === 'sync-audio');
  const main = tracks.filter((t) => t.kind === 'main-video');
  const rest = tracks.filter(
    (t) => t.kind !== 'sync-audio' && t.kind !== 'main-video'
  );
  return [...sync, ...main, ...rest];
}

export function hasOverlap(
  state: TimelineState,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  excludeClipId?: string
): boolean {
  const end = startBeat + lengthBeats;
  for (const c of state.clips) {
    if (c.trackId !== trackId) continue;
    if (c.id === excludeClipId) continue;
    const cEnd = c.startBeat + c.lengthBeats;
    if (startBeat < cEnd && end > c.startBeat) return true;
  }
  return false;
}

export function activeClipsAt(state: TimelineState, beats: number): Clip[] {
  return state.clips.filter((c) => beats >= c.startBeat && beats < c.startBeat + c.lengthBeats);
}

export function activeImageClip(state: TimelineState, beats: number): Clip | null {
  // Returns the FIRST matching image clip in array order.
  // v0.1: only one image track is expected, so order is deterministic.
  // v0.2: if multiple image tracks are allowed, sort by track.order first.
  for (const c of state.clips) {
    if (c.kind !== 'image') continue;
    if (beats >= c.startBeat && beats < c.startBeat + c.lengthBeats) return c;
  }
  return null;
}

/** All image clips active at `beats` — used by the renderer to crossfade
 *  overlapping image clips. Insertion order preserved. */
export function activeImageClips(state: TimelineState, beats: number): Clip[] {
  const out: Clip[] = [];
  for (const c of state.clips) {
    if (c.kind !== 'image') continue;
    if (beats >= c.startBeat && beats < c.startBeat + c.lengthBeats) out.push(c);
  }
  return out;
}

/**
 * Plan 5.9b — Export-gate helper. The export pre-checks need to know
 * if there's ANY visual source (image OR video) at the given beat —
 * `activeImageClips` alone misses video clips and locks the Export
 * button when the user has only video at beat 0.
 */
export function hasVisualClipAt(state: TimelineState, beats: number): boolean {
  return state.clips.some(
    (c) =>
      (c.kind === 'image' || c.kind === 'video') &&
      beats >= c.startBeat &&
      beats < c.startBeat + c.lengthBeats
  );
}

export function activeFxClipsByKind(
  state: TimelineState,
  beats: number
): Record<TrackFxKind, Clip[]> {
  const result: Record<TrackFxKind, Clip[]> = {
    contour: [],
    sweep: [],
    pulse: [],
    particles: [],
    'zoom-pulse': [],
    text: [],
    dissolve: [],
    sunray: [],
    // Plan 8e — 9 new beat-sync FX kinds.
    'beat-flash': [],
    'rgb-split': [],
    'zoom-punch': [],
    'screen-shake': [],
    'vignette-breathe': [],
    'lens-flare-burst': [],
    'film-grain-burst': [],
    'glitch-slice': [],
    'letterbox-squeeze': [],
    // Plan 8f.1 — WebGL2 FX.
    'color-grade-shift': [],
    // Plan 8f.2 — second WebGL2 FX.
    'retro-vhs': [],
    // Plan 8f.3 — third WebGL2 FX.
    'edge-glow': []
  };
  for (const c of state.clips) {
    // Skip media-bearing clips — they're handled outside this selector.
    if (c.kind === 'image' || c.kind === 'audio' || c.kind === 'video') continue;
    // After Plan 5.9c, c.kind for FX clips is TrackFxKind; the early
    // returns above guarantee that path here.
    if (beats < c.startBeat || beats >= c.startBeat + c.lengthBeats) continue;
    result[c.kind as TrackFxKind].push(c);
  }
  return result;
}

/**
 * Plan 5.9a — pure selector for the active clip on a specific track at
 * a given beat. The render loop iterates `tracks[]` and asks this per
 * track instead of using the global by-kind selectors. With Multi-Track,
 * a single beat may have multiple active clips of the same kind across
 * different tracks; this keeps each track's active clip cleanly
 * isolated.
 *
 * Overlap rule (existing): only one clip can be active per track per
 * beat — `addClip` rejects overlaps via `lib/timeline/operations.ts`.
 * The first match wins defensively.
 */
/**
 * Plan 5.9c — gather every active FX clip across all FX tracks, in
 * render order. The renderer's outer iteration used to walk
 * RENDER_ORDER × tracks (one active clip per track per kind); after
 * FX-track consolidation a single fx track can carry multiple clip
 * kinds, so we flatten and sort by `clip.kind` via
 * `RENDER_ORDER_TRACK_KIND` (via fxSortIndex).
 *
 * Returns `{ clip; track }` so the renderer's inner-loop body can
 * access track-level state (e.g. `track.muted` is already filtered
 * here but kept on the returned record for future per-track work).
 */
export function getActiveFxClips(
  tracks: Track[],
  clips: Clip[],
  beat: number
): Array<{ clip: Clip; track: Track }> {
  const out: Array<{ clip: Clip; track: Track }> = [];
  for (const track of tracks) {
    if (track.kind !== 'fx' || track.muted) continue;
    for (const c of clips) {
      if (c.trackId !== track.id) continue;
      if (beat < c.startBeat) continue;
      if (beat >= c.startBeat + c.lengthBeats) continue;
      out.push({ clip: c, track });
    }
  }
  // Sort by clip.kind via the canonical render order. Stable-sort:
  // within a kind, original-insertion order is preserved (matches
  // the iteration order above, which is track-then-clip-array).
  out.sort((a, b) => fxSortIndex(String(a.clip.kind)) - fxSortIndex(String(b.clip.kind)));
  return out;
}

export function activeClipOnTrack(
  trackId: string,
  clips: Clip[],
  beat: number
): Clip | undefined {
  return clips.find(
    (c) =>
      c.trackId === trackId &&
      beat >= c.startBeat &&
      beat < c.startBeat + c.lengthBeats
  );
}

export function totalBeats(state: TimelineState): number {
  let max = 0;
  for (const c of state.clips) {
    const end = c.startBeat + c.lengthBeats;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Format beats as a timecode string.
 *
 * Format rules (v0.1):
 * - Under 1 hour: `m:ss` — minutes are NOT zero-padded. e.g. `0:30`, `4:00`, `12:05`.
 * - 1 hour or more: `h:mm:ss` — minutes ARE zero-padded inside the hours form. e.g. `1:01:00`.
 * - Seconds are always zero-padded to 2 digits.
 * - Negative beats clamp to `0:00`.
 *
 * Fractional seconds are truncated (Math.floor), matching the Ruler's per-beat resolution
 * for v0.1. If sub-second precision is needed later, switch to `m:ss.cc`.
 */
export function beatsToTimecode(beats: number, bpm: number): string {
  const safe = Math.max(0, beats);
  const totalSeconds = Math.floor((safe * 60) / bpm);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours === 0) return `${minutes}:${ss}`;
  const mm = minutes.toString().padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}
