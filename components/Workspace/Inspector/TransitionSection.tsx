'use client';
import { useAppStore } from '@/lib/store';
import { findIncomingOverlap } from '@/lib/timeline/overlap';
import { BLEND_KEY } from '@/lib/timeline/blend';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve, Interpolation } from '@/lib/automation/types';

const MODES: Interpolation[] = ['linear', 'easeIn', 'easeOut'];

export function TransitionSection({ clipId }: { clipId: string }) {
  const timeline = useAppStore((s) => s.timeline);
  const setBlendInterpolation = useAppStore((s) => s.timelineActions.setBlendInterpolation);

  const incoming = findIncomingOverlap(timeline, clipId);
  if (!incoming) return null;

  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const blend = clip.params?.[BLEND_KEY];
  if (!isAutomationCurve(blend)) return null;

  const curve = blend as AutomationCurve<number>;

  return (
    <div className="border-t border-[var(--border)] mt-3 pt-2 px-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
        Transition
      </div>
      <label className="block text-xs text-[var(--text-dim)]">
        Curve
        <select
          aria-label="Transition curve"
          className="ml-2 text-xs bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5"
          value={curve.interpolation}
          onChange={(e) => setBlendInterpolation(clipId, e.target.value as Interpolation)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
