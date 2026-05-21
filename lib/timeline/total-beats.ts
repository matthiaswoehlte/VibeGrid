import type { Clip } from './types';

const MIN_BEATS = 64;
/** Plan 5.9b — empty drop-area appended after the actual content. Lets
 *  the user place a new clip just past the current end without first
 *  having to manually resize the timeline. ~16 s at 120 BPM. */
const DROP_HEADROOM_BEATS = 32;

/**
 * Total length the timeline should render. Pure — takes the project's
 * actual content (clips + audio) and returns the larger of:
 *   - a minimum (64 beats so the UI is never empty),
 *   - the last clip's end beat,
 *   - the audio soundtrack's length in beats,
 * then ALWAYS adds a small drop-headroom so the right edge of every
 * lane has empty space the user can drop new clips into.
 *
 * Used by Ruler, Tracks and Playhead to size their scrollable content
 * width consistently. All three would otherwise drift apart.
 *
 * The "latest-ending element wins" promise: when a clip ends past the
 * audio, this returns clipEnd + headroom (extends right). When that
 * clip is removed, it falls back to the next-longest element +
 * headroom (shrinks left).
 */
export function computeTotalBeats(
  clips: Clip[],
  audioDurationSec: number | undefined,
  bpm: number
): number {
  const fromClips =
    clips.length > 0 ? Math.max(...clips.map((c) => c.startBeat + c.lengthBeats)) : 0;
  const fromAudio =
    audioDurationSec && bpm > 0 ? Math.ceil((audioDurationSec * bpm) / 60) : 0;
  return (
    Math.max(MIN_BEATS, Math.ceil(fromClips), fromAudio) + DROP_HEADROOM_BEATS
  );
}
