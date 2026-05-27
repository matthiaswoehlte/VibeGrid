/**
 * Plan 9b — Group-Drag event bus.
 *
 * `Clip.tsx` detects "PointerDown on a selected clip while ≥2 clips are
 * selected" and dispatches via this bus to `Tracks.tsx`, which owns the
 * group-drag lifecycle (ghost overlay, window pointer listeners, snap-
 * commit on PointerUp).
 *
 * Why a module-level callback and not a CustomEvent: window events
 * would fire on the whole document tree and require defensive cleanup.
 * A single listener slot is symmetric to how Clip↔Tracks need to
 * communicate (1:1) and keeps the React-renderer free of side-effect
 * subscriptions for what is fundamentally a UI-coordination concern.
 *
 * Group-Move and Group-Copy share the bus — `mode` distinguishes.
 */
export type GroupDragMode = 'move' | 'copy';

export interface GroupDragStart {
  clipId: string;
  mode: GroupDragMode;
  pointerEvent: React.PointerEvent;
}

type Listener = (start: GroupDragStart) => void;
let listener: Listener | null = null;

export function setGroupDragListener(l: Listener | null): void {
  listener = l;
}

/** Returns true if a listener was registered and consumed the event. */
export function dispatchGroupDragStart(start: GroupDragStart): boolean {
  if (listener) {
    listener(start);
    return true;
  }
  return false;
}
