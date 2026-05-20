'use client';
import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';
import type { AutomationSnap } from '@/lib/automation/snap';
import { AutomationPoint as PointDot } from './AutomationPoint';
import { AutomationCurvePath } from './AutomationCurvePath';
import { AutomationPointEditOverlay } from './AutomationPointEditOverlay';

const INTERPOLATION_MODES: Interpolation[] = ['linear', 'step', 'easeIn', 'easeOut'];

const SNAP_UNITS: AutomationSnap[] = ['off', '1', '1/2', '1/4', '1/8', '1/16'];
const SNAP_LABEL: Record<AutomationSnap, string> = {
  off: 'off',
  '1': '1/1',
  '1/2': '1/2',
  '1/4': '1/4',
  '1/8': '1/8',
  '1/16': '1/16'
};

const CURVE_HEIGHT = 180;

/**
 * Fully-interactive curve editor for ONE automated slider param. Mounted by
 * the AutomationEditorModal — never by the inline preview lane.
 *
 * Header: param label + snap picker (writes global ui.automationSnap) +
 * interpolation picker + remove-automation (⚡-off) button.
 * Body: large SVG with the curve path, draggable points, click-to-add.
 * Double-click on a point opens the numeric edit overlay.
 */
export function AutomationCurveEditor({
  clipId,
  paramKey,
  paramLabel,
  curve,
  lengthBeats,
  valueMin,
  valueMax
}: {
  clipId: string;
  paramKey: string;
  paramLabel: string;
  curve: AutomationCurve<number>;
  lengthBeats: number;
  valueMin: number;
  valueMax: number;
}) {
  const setParamInterpolation = useAppStore((s) => s.timelineActions.setParamInterpolation);
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);
  const addParamPoint = useAppStore((s) => s.timelineActions.addParamPoint);
  const automationSnap = useAppStore((s) => s.ui.automationSnap);
  const setAutomationSnap = useAppStore((s) => s.setAutomationSnap);

  const [editing, setEditing] = useState<{ key: string; index: number } | null>(null);
  // Width is the modal-body width — read at render via a CSS-fluid container,
  // but we still need a numeric `widthPx` for the math. Use a sensible large
  // default; the SVG `viewBox` keeps the layout responsive to actual width.
  const widthPx = 1000;
  const pxPerBeat = widthPx / lengthBeats;

  const onSurfacePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).tagName === 'circle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Convert client X/Y to the SVG's internal (viewBox) coordinate space.
    const scaleX = rect.width > 0 ? widthPx / rect.width : 1;
    const scaleY = rect.height > 0 ? CURVE_HEIGHT / rect.height : 1;
    const localX = (e.clientX - rect.left) * scaleX;
    const localY = (e.clientY - rect.top) * scaleY;
    const beat = Math.max(0, Math.min(lengthBeats, (localX / widthPx) * lengthBeats));
    const range = valueMax - valueMin;
    const norm = 1 - localY / CURVE_HEIGHT;
    const value = Math.max(valueMin, Math.min(valueMax, valueMin + norm * range));
    addParamPoint(clipId, paramKey, { beat, value });
  };

  return (
    <div className="border-b border-[var(--border)] py-2">
      <div className="flex items-center gap-2 mb-2 px-3">
        <div className="text-xs text-[var(--text)] font-medium uppercase tracking-wider flex-1">
          {paramLabel}
        </div>
        <label className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
          Snap
          <select
            aria-label={`Snap to grid for ${paramLabel}`}
            className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
            value={automationSnap}
            onChange={(e) => setAutomationSnap(e.target.value as AutomationSnap)}
          >
            {SNAP_UNITS.map((u) => (
              <option key={u} value={u}>
                {SNAP_LABEL[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
          Curve
          <select
            aria-label={`Interpolation for ${paramLabel}`}
            className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
            value={curve.interpolation}
            onChange={(e) =>
              setParamInterpolation(clipId, paramKey, e.target.value as Interpolation)
            }
          >
            {INTERPOLATION_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label={`Remove automation from ${paramLabel}`}
          onClick={() => convertToStatic(clipId, paramKey)}
          className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] px-1"
          title="Convert back to a static value (drops the curve)"
        >
          ⚡✕
        </button>
      </div>
      <div className="relative px-3">
        <svg
          viewBox={`0 0 ${widthPx} ${CURVE_HEIGHT}`}
          preserveAspectRatio="none"
          className="block w-full bg-[var(--surface-2)] rounded"
          style={{ height: CURVE_HEIGHT, touchAction: 'none' }}
          data-testid="curve-editor-surface"
          onPointerDown={onSurfacePointerDown}
        >
          <AutomationCurvePath
            points={curve.points}
            interpolation={curve.interpolation}
            widthPx={widthPx}
            heightPx={CURVE_HEIGHT}
            valueMin={valueMin}
            valueMax={valueMax}
            lengthBeats={lengthBeats}
          />
          {curve.points.map((pt, i) => (
            <PointDot
              key={i}
              clipId={clipId}
              paramKey={paramKey}
              pointIndex={i}
              beat={pt.beat}
              value={pt.value}
              lengthBeats={lengthBeats}
              laneWidthPx={widthPx}
              laneHeightPx={CURVE_HEIGHT}
              valueMin={valueMin}
              valueMax={valueMax}
              onEdit={setEditing}
              interactive
            />
          ))}
        </svg>
        {editing?.key === paramKey && (
          <AutomationPointEditOverlay
            clipId={clipId}
            paramKey={paramKey}
            pointIndex={editing.index}
            valueMin={valueMin}
            valueMax={valueMax}
            lengthBeats={lengthBeats}
            onClose={() => setEditing(null)}
          />
        )}
        {/* Beat-tick legend below the curve so the user can orient themselves */}
        <div className="flex justify-between text-[10px] text-[var(--text-dim)] mt-1 px-0">
          {Array.from({ length: Math.min(lengthBeats + 1, 9) }, (_, i) => {
            const beat =
              lengthBeats <= 8
                ? i
                : Math.round((i / 8) * lengthBeats);
            return (
              <span key={i}>
                {beat}
              </span>
            );
          })}
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-dim)] px-3 mt-1">
        Drag to move • Ctrl=value only • Shift=move trailing points • Double-click for numeric •
        Right-click to delete • Click empty area to add
      </div>
    </div>
  );
}

export { CURVE_HEIGHT };
