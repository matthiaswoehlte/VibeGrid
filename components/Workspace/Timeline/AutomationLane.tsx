'use client';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { isReservedParamKey } from '@/lib/timeline/overlap';
import { getClipParamSchema } from '@/lib/timeline/clip-schema';
import type { AutomationCurve } from '@/lib/automation/types';
import { AutomationPoint as PointDot } from './AutomationPoint';
import { AutomationCurvePath } from './AutomationCurvePath';

const LANE_HEIGHT = 40;

/**
 * Read-only preview lane shown under the matching track row when the clip
 * has any automated slider params. Shows the curve + points but does NOT
 * accept interaction — editing happens in the AutomationEditorModal, which
 * the user opens via the "Open editor" button in the Inspector.
 */
export function AutomationLane({
  clipId,
  pxPerBeat
}: {
  clipId: string;
  pxPerBeat: number;
}) {
  const clip = useAppStore((s) => s.timeline.clips.find((c) => c.id === clipId));

  if (!clip) return null;
  // Plan 8d — resolve schema via the shared helper so audio clips
  // (which have a built-in synthetic Volume slider schema) also get
  // a preview lane when their volume param is automated. The old
  // `if (!clip.fxId) return null` gate hid the lane for any non-FX
  // clip.
  const schema = getClipParamSchema(clip);
  if (!schema) return null;

  const params = (clip.params ?? {}) as Record<string, unknown>;
  // Only slider params with active automation curves are visualised. Reserved
  // keys (__blend etc.) are filtered out — they're internal.
  const automated = Object.entries(schema).filter(([k, s]) => {
    if (isReservedParamKey(k)) return false;
    return s.kind === 'slider' && isAutomationCurve(params[k]);
  });
  if (automated.length === 0) return null;

  const laneWidthPx = clip.lengthBeats * pxPerBeat;
  const offsetLeftPx = clip.startBeat * pxPerBeat;

  return (
    <div
      // Plan 5.10: Mobile hides the inline preview entirely — the lane is
      // too narrow for finger interaction at the 56px Mobile track row.
      // MobileAutomationButton takes its place, opening the full-screen
      // AutomationEditorModal for actual editing.
      className="hidden md:block relative bg-[var(--surface-1)] border-y border-[var(--border)]"
      data-testid="automation-lane"
      title="Open the Inspector → Open editor to edit these curves"
    >
      {automated.map(([key, schema]) => {
        if (schema.kind !== 'slider') return null;
        const curve = params[key] as AutomationCurve<number>;
        return (
          <div key={key} className="flex items-stretch" data-testid="automation-lane-row">
            <div className="shrink-0 w-[80px] sticky left-0 z-20 bg-[var(--surface-2)] border-r border-[var(--border)] px-2 py-1 flex items-center">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] truncate">
                {schema.label}
              </span>
            </div>
            <div
              className="relative"
              style={{ marginLeft: offsetLeftPx, width: laneWidthPx, height: LANE_HEIGHT }}
            >
              <svg width={laneWidthPx} height={LANE_HEIGHT} data-testid="automation-lane-surface">
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
                    interactive={false}
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
