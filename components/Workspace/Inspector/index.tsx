'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { ParamControl } from '@/components/ui/ParamControl';
import { PreloadIndicator } from './PreloadIndicator';
import { isAutomationCurve } from '@/lib/automation/resolve';

export function Inspector() {
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const clip = useAppStore((s) =>
    selectedClipId ? s.timeline.clips.find((c) => c.id === selectedClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);

  if (!clip || !clip.fxId) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
  }
  const plugin = getPlugin(clip.fxId);
  if (!plugin) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">FX {clip.fxId} not registered.</div>;
  }

  const params = clip.params ?? plugin.getDefaultParams();

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between px-3 py-2 bg-[var(--surface-2)] border-b-2 border-[var(--a1)]">
        <div>
          <div className="text-base font-bold text-[var(--text)]">{plugin.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            {plugin.kind} clip
          </div>
        </div>
        <PreloadIndicator state={plugin.preloadState} />
      </header>
      <div className="px-3 space-y-2">
        {Object.entries(plugin.paramSchema).map(([key, schema]) => {
          const raw = (params as Record<string, unknown>)[key];
          // Inspector edits static values only — show the curve's first point if automated.
          const display = isAutomationCurve(raw) ? raw.points[0]?.value : raw;
          return (
            <label key={key} className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-dim)]">{schema.label}</span>
                {isAutomationCurve(raw) && (
                  <span className="text-[10px] uppercase text-[var(--a2)]">automated</span>
                )}
              </div>
              <ParamControl
                paramKey={key}
                schema={schema}
                value={display}
                onChange={(v) => setClipParam(clip.id, key, v)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
