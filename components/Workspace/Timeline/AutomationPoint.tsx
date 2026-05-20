'use client';
import { useAppStore } from '@/lib/store';

export function AutomationPoint({
  clipId,
  paramKey,
  pointIndex,
  beat,
  value,
  lengthBeats,
  laneWidthPx,
  laneHeightPx,
  valueMin,
  valueMax
}: {
  clipId: string;
  paramKey: string;
  pointIndex: number;
  beat: number;
  value: number;
  lengthBeats: number;
  laneWidthPx: number;
  laneHeightPx: number;
  valueMin: number;
  valueMax: number;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const removeParamPoint = useAppStore((s) => s.timelineActions.removeParamPoint);
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);
  // Right-clicking the last point would leave an empty curve — resolveParam
  // throws in that case. Detect by reading the current point count from the
  // store and switching to convertParamToStatic when only one point remains.
  const totalPoints = useAppStore((s) => {
    const clip = s.timeline.clips.find((c) => c.id === clipId);
    const val = clip?.params?.[paramKey];
    if (val && typeof val === 'object' && 'points' in val) {
      return (val as { points: unknown[] }).points.length;
    }
    return 0;
  });

  const range = valueMax - valueMin || 1;
  const cx = (beat / lengthBeats) * laneWidthPx;
  const cy = laneHeightPx - ((value - valueMin) / range) * laneHeightPx;

  const onPointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    // stopPropagation keeps the lane's SVG-level pointerdown from also firing
    // (which would otherwise add a new point at the cursor). No preventDefault
    // here — calling it on a pointerdown can suppress subsequent pointer
    // events in some browsers, which is exactly what broke browser drag.
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    // setPointerCapture redirects all subsequent pointermove/pointerup events
    // for this gesture to the circle, regardless of where the cursor is. With
    // a 4px-radius dot, the cursor leaves the element almost immediately —
    // without capture, pointermove fires on whatever is under the cursor and
    // never reaches our listener. jsdom doesn't always implement capture, so
    // guard with try/catch to keep unit tests green.
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* jsdom may not implement setPointerCapture */
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startBeat = beat;
    const startValue = value;
    const pxPerBeat = laneWidthPx / lengthBeats;

    const move = (ev: PointerEvent) => {
      const dxBeats = (ev.clientX - startX) / pxPerBeat;
      const dyValue = -((ev.clientY - startY) / laneHeightPx) * range;
      const nextBeat = Math.max(0, Math.min(lengthBeats, startBeat + dxBeats));
      const nextValue = Math.max(valueMin, Math.min(valueMax, startValue + dyValue));
      updateParamPoint(clipId, paramKey, pointIndex, { beat: nextBeat, value: nextValue });
    };
    const up = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* may already be released */
      }
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      // Window fallback for the test harness (jsdom dispatches on window).
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    // jsdom-only fallback so existing tests dispatching on `window` keep working.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (totalPoints <= 1) convertToStatic(clipId, paramKey);
    else removeParamPoint(clipId, paramKey, pointIndex);
  };

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--a2)"
      stroke="var(--bg)"
      strokeWidth={1.5}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      role="button"
      aria-label={`Automation point ${pointIndex + 1}`}
      style={{ cursor: 'grab' }}
    />
  );
}
