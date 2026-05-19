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
