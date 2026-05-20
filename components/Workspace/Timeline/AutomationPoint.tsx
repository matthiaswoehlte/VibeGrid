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

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
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
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
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
