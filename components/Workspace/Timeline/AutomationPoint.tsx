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

  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
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

  // Two circles in a group: an invisible r=12 hit area so the user doesn't
  // have to aim at a tiny dot, plus the visible r=6 dot. Default cursor
  // everywhere — no grab/grabbing cursor styling in the automation area.
  return (
    <g
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      role="button"
      aria-label={`Automation point ${pointIndex + 1}`}
    >
      <circle cx={cx} cy={cy} r={12} fill="rgba(0,0,0,0)" pointerEvents="all" />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="var(--a2)"
        stroke="var(--bg)"
        strokeWidth={1.5}
        pointerEvents="none"
      />
    </g>
  );
}
