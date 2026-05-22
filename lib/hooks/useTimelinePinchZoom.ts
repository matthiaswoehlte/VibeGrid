'use client';
import { usePinch } from '@use-gesture/react';
import { useAppStore } from '@/lib/store';
import type { RefObject } from 'react';

/** Match the Toolbar's Zoom slider bounds (Slider min/max in Toolbar.tsx). */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;

/**
 * Plan 5.10 — two-finger pinch on the Timeline scroll area adjusts
 * `timeline.zoom`. Delegates the gnarly two-pointer tracking +
 * gesture-vs-scroll conflict resolution to `@use-gesture/react`
 * (Anm 8 Fix — rolling our own is ~80 lines and known-fiddly on
 * Safari).
 *
 * Scope behavior:
 *  - Target ref is the Timeline scroll container element.
 *  - `scaleBounds` clamps zoom to the same [0.5, 3] range the Toolbar
 *    Zoom slider uses, so pinch and slider stay consistent.
 *  - `preventDefault: true` blocks Safari's native page-pinch from
 *    competing with our handler.
 *
 * Out of scope for v0.1:
 *  - Pinch-center pivot (`scrollLeft` re-anchoring so the pixel under
 *    the user's fingers stays under their fingers). Documented in
 *    KNOWN_LIMITATIONS — current behavior anchors zoom to the left
 *    edge of the visible area.
 *  - Decoupling pinch from the dnd-kit TouchSensor's drag activation
 *    (two-finger touch shouldn't start a clip drag — current dnd-kit
 *    TouchSensor only activates on single-finger hold-and-move, so
 *    this conflict is theoretical at present).
 */
export function useTimelinePinchZoom(
  targetRef: RefObject<HTMLElement>
): void {
  const setZoom = useAppStore((s) => s.setZoom);
  const currentZoom = useAppStore((s) => s.ui.zoom);
  usePinch(
    ({ offset: [scale] }) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
      // Skip no-op writes — store subscriptions would re-run for nothing.
      if (next !== currentZoom) setZoom(next);
    },
    {
      target: targetRef,
      scaleBounds: { min: ZOOM_MIN, max: ZOOM_MAX },
      // Treat initial offset as the current zoom so a pinch from
      // here is a relative adjustment, not a snap to scale=1.
      from: () => [currentZoom, 0],
      preventDefault: true,
      eventOptions: { passive: false }
    }
  );
}
