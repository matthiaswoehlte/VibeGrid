'use client';
import { useAppStore } from '@/lib/store';
import { ParamControl } from '@/components/ui/ParamControl';
import { AutomateButton } from './AutomateButton';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { Clip } from '@/lib/timeline/types';

/**
 * Plan 5.9d — Volume slider for audio clips. Same Static-or-Auto
 * model as FX params: clip.params.volume can be a number (static)
 * or an AutomationCurve (per-beat ramp).
 *
 * Range: 0.0 .. 1.0, displayed as a 0–100 % slider. Default 1.0
 * when params.volume is absent.
 */
export function VolumeSection({ clip }: { clip: Clip }) {
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const raw = (clip.params as { volume?: unknown } | undefined)?.volume ?? 1.0;
  const automated = isAutomationCurve(raw);
  const displayValue = automated
    ? (raw.points[0]?.value as number) ?? 1.0
    : (raw as number);

  // Slider schema — matches the existing FX slider conventions so
  // AutomateButton + ParamControl wire identically.
  const schema = {
    kind: 'slider' as const,
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    label: 'Volume'
  };

  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--text-dim)] flex items-center">
          Volume
          <AutomateButton
            clipId={clip.id}
            paramKey="volume"
            paramLabel="Volume"
            value={raw}
          />
        </span>
        {automated && (
          <span className="text-[10px] uppercase text-[var(--a2)]">automated</span>
        )}
      </div>
      <ParamControl
        paramKey="volume"
        schema={schema}
        value={displayValue}
        onChange={(v) => setClipParam(clip.id, 'volume', v)}
      />
    </label>
  );
}
