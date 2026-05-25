/**
 * Plan 8d — clip layout algorithm.
 *
 * Pure function — no DOM, no store, no DB. Takes the scene clips +
 * BPM + snap mode and returns startBeat/lengthBeats per clip plus a
 * warnings list for the UI. Used by:
 *   - Transfer flow (initial placement)
 *   - Sync-audio drop handler (re-snap on new BPM)
 *
 * The algorithm:
 *   1. Convert each clip's durationSec to raw beats at the current BPM
 *   2. Snap to mode: 'off' (no trim), 'beat' (floor), 'bar' (floor / 4 * 4)
 *   3. Guard `lengthBeats >= 1` (mindestens 1 Beat damit Clip sichtbar bleibt)
 *   4. For crossfade-transition: overlap with previous by min(crossfadeBeats,
 *      lengthBeats / 2) — verhindert negativen Start-Offset bei sehr kurzen
 *      Clips
 *   5. For cut/last-frame: sequential placement (no overlap)
 *
 * Endcards have no real video — they're treated as static image clips
 * with `ENDCARD_DEFAULT_DURATION_SEC` length.
 */

/** Endcard scenes have no video duration — they're a static image with
 *  a CTA. 5 s is a sane default for a closing card. */
export const ENDCARD_DEFAULT_DURATION_SEC = 5;

/** Default crossfade overlap when no per-story override is set.
 *  2 beats = half a 4/4 bar — visible but not dominating. */
export const CROSSFADE_BEATS_DEFAULT = 2;

export type SnapMode = 'beat' | 'bar' | 'off';

export interface LayoutInputClip {
  mediaId: string;
  /** Real video/audio duration in seconds. For endcards this is the
   *  user-set scene duration (or 0/undefined → falls back to
   *  ENDCARD_DEFAULT_DURATION_SEC inside layoutClips). */
  durationSec: number;
  transition: 'last-frame' | 'crossfade' | 'cut';
  sceneOrder: number;
  sceneType: 'action' | 'dialog' | 'endcard';
}

export interface LayoutInput {
  clips: LayoutInputClip[];
  bpm: number;
  snapMode: SnapMode;
  crossfadeBeats?: number;
  beatsPerBar?: number;
}

export interface LayoutClipResult {
  mediaId: string;
  startBeat: number;
  lengthBeats: number;
  /** True wenn das Original (rawLengthBeats) länger war als die finale
   *  lengthBeats — UI kann das als "X.Y s weggeschnitten" anzeigen. */
  trimmed: boolean;
  /** Wie viele Sekunden weggeschnitten wurden (0 bei snap='off' oder
   *  exakter Treffer). */
  trimmedSec: number;
}

export interface LayoutWarning {
  sceneOrder: number;
  message: string;
}

export interface LayoutResult {
  clips: LayoutClipResult[];
  warnings: LayoutWarning[];
}

/**
 * Snap raw beats according to mode. Returns at least 1 (caller should
 * also push a warning if rawLengthBeats was tiny — layoutClips does this).
 */
function snapLength(
  rawLengthBeats: number,
  mode: SnapMode,
  beatsPerBar: number
): { lengthBeats: number; trimmed: boolean } {
  if (mode === 'off') {
    return { lengthBeats: rawLengthBeats, trimmed: false };
  }
  if (mode === 'beat') {
    const snapped = Math.floor(rawLengthBeats);
    return {
      lengthBeats: Math.max(1, snapped),
      trimmed: rawLengthBeats > snapped
    };
  }
  // 'bar'
  const snapped = Math.floor(rawLengthBeats / beatsPerBar) * beatsPerBar;
  return {
    lengthBeats: Math.max(1, snapped),
    trimmed: rawLengthBeats > snapped
  };
}

export function layoutClips(input: LayoutInput): LayoutResult {
  const {
    clips,
    bpm,
    snapMode,
    crossfadeBeats: crossfadeOverride,
    beatsPerBar: barOverride
  } = input;

  if (bpm <= 0) {
    throw new Error(`layoutClips: bpm must be > 0, got ${bpm}`);
  }

  const crossfadeBeats = crossfadeOverride ?? CROSSFADE_BEATS_DEFAULT;
  const beatsPerBar = barOverride ?? 4;
  const warnings: LayoutWarning[] = [];
  const out: LayoutClipResult[] = [];

  let cursor = 0;

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const previous = out[out.length - 1];

    // Endcards have no real video duration — use the constant default
    // when their durationSec is 0/undefined. Non-endcard scenes use
    // their actual duration as-is.
    const effectiveDurationSec =
      c.sceneType === 'endcard' && (!c.durationSec || c.durationSec <= 0)
        ? ENDCARD_DEFAULT_DURATION_SEC
        : c.durationSec;

    const rawLengthBeats = (effectiveDurationSec * bpm) / 60;
    const { lengthBeats, trimmed } = snapLength(
      rawLengthBeats,
      snapMode,
      beatsPerBar
    );

    // Sub-1-beat warning (only when snap clipped lengthBeats down to 1
    // from a much smaller raw value).
    if (snapMode !== 'off' && rawLengthBeats < 1) {
      warnings.push({
        sceneOrder: c.sceneOrder,
        message: `Szene ${c.sceneOrder} ist nach Snap sehr kurz (${rawLengthBeats.toFixed(2)} Beats roh → 1 Beat minimum)`
      });
    }

    // Crossfade guard: max half of the clip's length, so a very short
    // clip with crossfade-transition doesn't start BEFORE its predecessor.
    const effectiveCrossfade = previous
      ? Math.min(crossfadeBeats, Math.floor(lengthBeats / 2))
      : 0;

    let startBeat: number;
    if (c.transition === 'crossfade' && previous) {
      startBeat = previous.startBeat + previous.lengthBeats - effectiveCrossfade;
    } else {
      startBeat = cursor;
    }
    // Numerical safety: never let two consecutive clips be reordered.
    if (previous && startBeat < previous.startBeat) {
      startBeat = previous.startBeat;
    }

    const trimmedSec = trimmed
      ? Math.max(0, effectiveDurationSec - (lengthBeats * 60) / bpm)
      : 0;

    out.push({
      mediaId: c.mediaId,
      startBeat,
      lengthBeats,
      trimmed,
      trimmedSec
    });

    cursor = startBeat + lengthBeats;
  }

  return { clips: out, warnings };
}
