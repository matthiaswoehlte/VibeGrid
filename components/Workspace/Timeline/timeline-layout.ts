/** Shared timeline layout constants. Single source of truth for the
 *  beat→pixel mapping used by Ruler, Playhead, Tracks, Clip, RangeOverlay. */

/** Pixels per beat at zoom = 1. */
export const BEAT_PX_BASE = 40;

/** Left gutter width (px) — the sticky column reserved for track-name labels.
 *  All horizontal positioning of clips/ticks happens to the RIGHT of this column. */
export const TRACK_LABEL_WIDTH = 80;
