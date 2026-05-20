'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';
import { AutomationPoint as PointDot } from './AutomationPoint';
import { AutomationCurvePath } from './AutomationCurvePath';

const LANE_HEIGHT = 50;
const INTERPOLATION_MODES: Interpolation[] = ['linear', 'step', 'easeIn', 'easeOut'];

export function AutomationLane({
  clipId,
  pxPerBeat
}: {
  clipId: string;
  pxPerBeat: number;
}) {
  const expandedId = useAppStore((s) => s.ui.expandedAutomationClipId);
  const setExpanded = useAppStore((s) => s.setExpandedAutomationClipId);
  const clip = useAppStore((s) => s.timeline.clips.find((c) => c.id === clipId));
  const setParamInterpolation = useAppStore((s) => s.timelineActions.setParamInterpolation);
  const addParamPoint = useAppStore((s) => s.timelineActions.addParamPoint);

  if (!clip || expandedId !== clipId) return null;
  if (!clip.fxId) return null;
  const plugin = getPlugin(clip.fxId);
  if (!plugin) return null;

  const params = (clip.params ?? {}) as Record<string, unknown>;
  // Only slider params with active automation curves get a visual lane in v0.1.
  const automated = Object.entries(plugin.paramSchema).filter(([k, schema]) => {
    return schema.kind === 'slider' && isAutomationCurve(params[k]);
  });
  if (automated.length === 0) return null;

  const laneWidthPx = clip.lengthBeats * pxPerBeat;
  const offsetLeftPx = clip.startBeat * pxPerBeat;

  return (
    <div
      className="relative bg-[var(--surface-1)] border-y border-[var(--border)]"
      data-testid="automation-lane"
    >
      {automated.map(([key, schema]) => {
        if (schema.kind !== 'slider') return null;
        const curve = params[key] as AutomationCurve<number>;
        return (
          <div key={key} className="flex items-stretch" data-testid="automation-lane-row">
            <div className="shrink-0 w-[80px] sticky left-0 z-20 bg-[var(--surface-2)] border-r border-[var(--border)] px-2 py-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                {schema.label}
              </span>
              <div className="flex items-center gap-1">
                <select
                  aria-label={`Interpolation for ${schema.label}`}
                  className="text-[10px] bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
                  value={curve.interpolation}
                  onChange={(e) =>
                    setParamInterpolation(clipId, key, e.target.value as Interpolation)
                  }
                >
                  {INTERPOLATION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Close automation"
                  onClick={() => setExpanded(null)}
                  className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  ✕
                </button>
              </div>
            </div>
            <div
              className="relative"
              style={{ marginLeft: offsetLeftPx, width: laneWidthPx, height: LANE_HEIGHT }}
            >
              <svg
                width={laneWidthPx}
                height={LANE_HEIGHT}
                data-testid="automation-lane-surface"
                onPointerDown={(e) => {
                  // Skip when the click landed on a point handle — the dot
                  // stops propagation itself, but a missed click could still
                  // bubble up. Defensive guard.
                  if ((e.target as Element).tagName === 'circle') return;
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                  // jsdom returns a zero-sized rect for SVGs. Fall back to the
                  // raw event coords in that case so tests can exercise the path.
                  const localX = rect.width > 0 ? e.clientX - rect.left : e.clientX;
                  const localY = rect.height > 0 ? e.clientY - rect.top : e.clientY;
                  const beat = Math.max(
                    0,
                    Math.min(clip.lengthBeats, (localX / laneWidthPx) * clip.lengthBeats)
                  );
                  const range = schema.max - schema.min;
                  const norm = 1 - localY / LANE_HEIGHT;
                  const value = Math.max(
                    schema.min,
                    Math.min(schema.max, schema.min + norm * range)
                  );
                  addParamPoint(clipId, key, { beat, value });
                }}
              >
                <AutomationCurvePath
                  points={curve.points}
                  interpolation={curve.interpolation}
                  widthPx={laneWidthPx}
                  heightPx={LANE_HEIGHT}
                  valueMin={schema.min}
                  valueMax={schema.max}
                  lengthBeats={clip.lengthBeats}
                />
                {curve.points.map((pt, i) => (
                  <PointDot
                    key={i}
                    clipId={clipId}
                    paramKey={key}
                    pointIndex={i}
                    beat={pt.beat}
                    value={pt.value}
                    lengthBeats={clip.lengthBeats}
                    laneWidthPx={laneWidthPx}
                    laneHeightPx={LANE_HEIGHT}
                    valueMin={schema.min}
                    valueMax={schema.max}
                  />
                ))}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
