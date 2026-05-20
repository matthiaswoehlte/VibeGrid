'use client';
import { useAppStore } from '@/lib/store';
import { snapBeat } from '@/lib/automation/snap';
import type { AutomationCurve } from '@/lib/automation/types';

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
  valueMax,
  onEdit
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
  /** Called on double-click — caller mounts the EditOverlay. */
  onEdit?: (info: { key: string; index: number }) => void;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const updateParamPoints = useAppStore((s) => s.timelineActions.updateParamPoints);
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

    // Active point's anchor comes from PROPS — keeps the OLD drag semantics
    // even if rapid sequential store updates briefly desync from the render.
    const activeStartBeat = beat;
    const activeStartValue = value;
    // Trailing-set snapshot comes from the STORE — we need all points to
    // compute follower deltas, and the snapshot is taken once at down-time
    // so subsequent re-sorts don't shuffle the trailing membership.
    const state = useAppStore.getState();
    const clip = state.timeline.clips.find((c) => c.id === clipId);
    const curve = clip?.params?.[paramKey] as AutomationCurve<number> | undefined;
    const originals = curve
      ? curve.points.map((p) => ({ beat: p.beat, value: p.value }))
      : [];
    const trailingIndices: number[] = [];
    for (let i = 0; i < originals.length; i++) {
      if (i === pointIndex) continue;
      if (originals[i].beat >= activeStartBeat) trailingIndices.push(i);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const pxPerBeat = laneWidthPx / lengthBeats;

    const move = (ev: PointerEvent) => {
      const dxBeatsRaw = (ev.clientX - startX) / pxPerBeat;
      const dyValueRaw = -((ev.clientY - startY) / laneHeightPx) * range;

      const lockX = ev.ctrlKey;
      const moveTrailing = ev.shiftKey;

      // Resolve the active point's next position (snapped on beat if enabled).
      const snap = useAppStore.getState().ui.automationSnap;
      const activeNextBeat = lockX
        ? activeStartBeat
        : snapBeat(
            Math.max(0, Math.min(lengthBeats, activeStartBeat + dxBeatsRaw)),
            snap
          );
      const activeNextValue = Math.max(
        valueMin,
        Math.min(valueMax, activeStartValue + dyValueRaw)
      );

      // Effective deltas applied to trailing points come from the active
      // point's actually-applied movement (post-snap, post-lock). Cohesive
      // group — if snap rounds the leader, followers round with it.
      const effDBeat = lockX ? 0 : activeNextBeat - activeStartBeat;
      const effDValue = activeNextValue - activeStartValue;

      if (!moveTrailing) {
        updateParamPoint(clipId, paramKey, pointIndex, {
          beat: activeNextBeat,
          value: activeNextValue
        });
        return;
      }

      const updates: Array<{ index: number; beat?: number; value?: number }> = [];
      updates.push({ index: pointIndex, beat: activeNextBeat, value: activeNextValue });
      for (const i of trailingIndices) {
        const ob = originals[i].beat;
        const ov = originals[i].value;
        const nextBeat = lockX ? ob : Math.max(0, Math.min(lengthBeats, ob + effDBeat));
        const nextValue = Math.max(valueMin, Math.min(valueMax, ov + effDValue));
        updates.push({ index: i, beat: nextBeat, value: nextValue });
      }
      updateParamPoints(clipId, paramKey, updates);
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

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.({ key: paramKey, index: pointIndex });
  };

  // Two circles in a group: an invisible r=12 hit area so the user doesn't
  // have to aim at a tiny dot, plus the visible r=6 dot. Default cursor
  // everywhere — no grab/grabbing cursor styling in the automation area.
  return (
    <g
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
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
