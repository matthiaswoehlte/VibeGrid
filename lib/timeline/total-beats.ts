import type { Clip } from './types';

const MIN_BEATS = 64;
/** Plan 5.9b — empty drop-area appended after the actual content. Lets
 *  the user place a new clip just past the current end without first
 *  having to manually resize the timeline. ~16 s at 120 BPM. */
const DROP_HEADROOM_BEATS = 32;

/**
 * Total length the timeline should render. Pure — takes the project's
 * actual content (clips on the timeline) and returns the larger of:
 *   - a minimum (64 beats so the UI is never empty),
 *   - the last clip's end beat,
 * then ALWAYS adds a small drop-headroom so the right edge of every
 * lane has empty space the user can drop new clips into.
 *
 * Used by Ruler, Tracks and Playhead to size their scrollable content
 * width consistently. All three would otherwise drift apart.
 *
 * Plan 5.9d (Multi-Audio): audio clips are regular timeline clips with
 * `kind: 'audio'` — their `lengthBeats` (after any user resize) is
 * authoritative for the audio's footprint on the timeline. We no
 * longer consult `mediaRef.duration` (the underlying audio FILE
 * length): a user who uploaded a 4-min track but trimmed the on-
 * timeline clip to 30 s expects the scrollable width to follow the
 * clip, not the source file. Before 5.9d the global "active
 * soundtrack" model meant the timeline was the file's length even
 * with no audio clip placed yet — that contract no longer holds.
 *
 * The "latest-ending element wins" promise: returns `lastClipEnd +
 * headroom`. Remove the latest clip and the timeline shrinks to the
 * next-longest + headroom.
 */
export function computeTotalBeats(clips: Clip[]): number {
  const fromClips =
    clips.length > 0
      ? Math.max(...clips.map((c) => c.startBeat + c.lengthBeats))
      : 0;
  return Math.max(MIN_BEATS, Math.ceil(fromClips)) + DROP_HEADROOM_BEATS;
}
