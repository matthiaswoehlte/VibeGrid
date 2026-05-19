import type { Clip, TimelineState } from './types';
import { hasOverlap } from './selectors';

export type OperationErrorCode =
  | 'OVERLAP'
  | 'CLIP_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'INVALID_LENGTH';

export class OperationError extends Error {
  readonly code: OperationErrorCode;

  constructor(code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'OperationError';
    this.code = code;
    Object.setPrototypeOf(this, OperationError.prototype);
  }
}

/**
 * Add a clip to the timeline.
 *
 * ID-generation convention: the CALLER provides `clip.id`. Operations stay
 * pure — they never call `crypto.randomUUID()` or any other non-deterministic
 * source. UI/store callers generate the ID before invoking. This keeps the
 * operation trivially testable with stable, hand-written IDs.
 *
 * @throws {OperationError} code=OVERLAP when the clip intersects an existing
 *   clip on the same track. Half-open interval semantics — see `hasOverlap`.
 */
export function addClip(state: TimelineState, clip: Clip): TimelineState {
  if (hasOverlap(state, clip.trackId, clip.startBeat, clip.lengthBeats)) {
    throw new OperationError(
      'OVERLAP',
      `Clip ${clip.id} overlaps existing clip on track ${clip.trackId}`
    );
  }
  return { ...state, clips: [...state.clips, clip] };
}

export function moveClip(
  state: TimelineState,
  clipId: string,
  newStartBeat: number
): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  }
  const clip = state.clips[idx];
  if (hasOverlap(state, clip.trackId, newStartBeat, clip.lengthBeats, clipId)) {
    throw new OperationError(
      'OVERLAP',
      `Moving clip ${clipId} to ${newStartBeat} would overlap an existing clip`
    );
  }
  const next = state.clips.slice();
  next[idx] = { ...clip, startBeat: newStartBeat };
  return { ...state, clips: next };
}

/**
 * Resize a clip by changing its `lengthBeats`.
 *
 * The overlap check is intentional and matches the addClip/moveClip invariant —
 * confirmed during Plan 1 review (consistency trumps strict spec literalism).
 *
 * @throws {OperationError} code=INVALID_LENGTH when newLengthBeats <= 0
 * @throws {OperationError} code=CLIP_NOT_FOUND when clipId is unknown
 * @throws {OperationError} code=OVERLAP when the new length would extend into
 *   an existing clip on the same track.
 */
export function resizeClip(
  state: TimelineState,
  clipId: string,
  newLengthBeats: number
): TimelineState {
  if (newLengthBeats <= 0) {
    throw new OperationError(
      'INVALID_LENGTH',
      `Clip length must be > 0 (got ${newLengthBeats})`
    );
  }
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) {
    throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  }
  const clip = state.clips[idx];
  if (hasOverlap(state, clip.trackId, clip.startBeat, newLengthBeats, clipId)) {
    throw new OperationError(
      'OVERLAP',
      `Resizing clip ${clipId} to ${newLengthBeats} beats would overlap an existing clip`
    );
  }
  const next = state.clips.slice();
  next[idx] = { ...clip, lengthBeats: newLengthBeats };
  return { ...state, clips: next };
}

export function removeClip(state: TimelineState, clipId: string): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  const next = state.clips.slice();
  next.splice(idx, 1);
  return { ...state, clips: next };
}

export function setClipParams(
  state: TimelineState,
  clipId: string,
  params: Record<string, unknown>
): TimelineState {
  const idx = state.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) throw new OperationError('CLIP_NOT_FOUND', `Clip ${clipId} not found`);
  const clip = state.clips[idx];
  const next = state.clips.slice();
  next[idx] = { ...clip, params: { ...clip.params, ...params } };
  return { ...state, clips: next };
}

export function setPlayhead(state: TimelineState, beats: number): TimelineState {
  const clamped = Math.max(0, beats);
  if (clamped === state.playhead.beats) return state;
  return { ...state, playhead: { ...state.playhead, beats: clamped } };
}

export function setMuted(state: TimelineState, trackId: string, muted: boolean): TimelineState {
  const idx = state.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) throw new OperationError('TRACK_NOT_FOUND', `Track ${trackId} not found`);
  if (state.tracks[idx].muted === muted) return state;
  const next = state.tracks.slice();
  next[idx] = { ...next[idx], muted };
  return { ...state, tracks: next };
}
