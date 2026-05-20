import type { Clip } from './types';

const MIN_BEATS = 64;

/**
 * Total length the timeline should render. Pure — takes the project's
 * actual content (clips + audio) and returns the larger of:
 *   - a minimum (64 beats so the UI is never empty),
 *   - the last clip's end beat,
 *   - the audio soundtrack's length in beats.
 *
 * Used by Ruler, Tracks and Playhead to size their scrollable content
 * width consistently. All three would otherwise drift apart.
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
  return Math.max(MIN_BEATS, Math.ceil(fromClips), fromAudio);
}
