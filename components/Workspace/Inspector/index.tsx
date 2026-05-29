'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { ParamControl } from '@/components/ui/ParamControl';
import { PreloadIndicator } from './PreloadIndicator';
import { AutomateButton } from './AutomateButton';
import { TransitionSection } from './TransitionSection';
import { MediaClipInspector } from './MediaClipInspector';
import { SubdivisionPicker } from './SubdivisionPicker';
import { ToggleParam } from './ToggleParam';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { isReservedParamKey } from '@/lib/timeline/overlap';
import { formatParamValue } from '@/lib/fx/format-param-value';
import type { ParamType } from '@/lib/renderer/types';

export function Inspector() {
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const clip = useAppStore((s) =>
    selectedClipId ? s.timeline.clips.find((c) => c.id === selectedClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const setClipTriggerSubdivision = useAppStore(
    (s) => s.timelineActions.setClipTriggerSubdivision
  );

  if (!clip) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
  }
  // Plan 5.9d — audio + video clips have their own inspector view
  // (volume slider / audio toggle). FX clips fall through to the
  // plugin-driven view below.
  if (clip.kind === 'audio' || clip.kind === 'video') {
    return <MediaClipInspector clip={clip} />;
  }
  if (!clip.fxId) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
  }
  const plugin = getPlugin(clip.fxId);
  if (!plugin) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">FX {clip.fxId} not registered.</div>;
  }

  // Merge defaults with overrides — a clip carrying only `{__blend: ...}`
  // (added by the overlap lifecycle) must still expose every plugin default.
  const params = {
    ...(plugin.getDefaultParams() as Record<string, unknown>),
    ...(clip.params ?? {})
  };

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
      {/* Plan 8f.1 — WebGL2-Plugins (ColorGradeShift et al.) set
          preloadState='error' when the browser lacks WebGL2. Surface a
          dedicated banner so users understand why the controls below
          don't appear to affect the render. */}
      {plugin.preloadState === 'error' && (
        <div className="mx-3 p-2 rounded border border-red-500/40 bg-red-500/10 text-[11px] text-red-300">
          <strong className="block mb-0.5">WebGL2 not available</strong>
          This effect requires WebGL2. Update to Safari 17+, Chrome 69+,
          or Firefox 105+. The effect is skipped silently in the render.
        </div>
      )}
      <div className="px-3 space-y-2">
        {/* Plan 9c — Trigger-Subdivision picker. Plugin-opt-in via
            `supportsSubdivision`; otherwise the row is omitted entirely. */}
        {plugin.supportsSubdivision && (
          <SubdivisionPicker
            value={clip.triggerSubdivision ?? '1×'}
            onChange={(s) => setClipTriggerSubdivision(clip.id, s)}
          />
        )}
        {Object.entries(plugin.paramSchema).map(([key, schema]) => {
          // Plan 5.8b — visibleWhen filter. Returning null drops the
          // whole <label> block, which means the param input AND its
          // AutomateButton (rendered inside the label) both disappear
          // in one pass. Store values + AutomationCurves stay intact —
          // a later toggle that flips visibleWhen back to true brings
          // the row back with all prior state.
          if (schema.visibleWhen && !schema.visibleWhen(params)) return null;
          const raw = (params as Record<string, unknown>)[key];

          // Plan 9c — generic `kind: 'toggle'` dispatch. No automation,
          // no value-display row — just the Off/On group inline.
          // `beatSync` carries user-facing labels that match the actual
          // behaviour: value=false → constant env=1.0 ("Always On"),
          // value=true → decay envelope per beat ("Beat Pulse").
          if (schema.kind === 'toggle') {
            const isBeatSync = key === 'beatSync';
            return (
              <ToggleParam
                key={key}
                label={schema.label}
                value={Boolean(raw)}
                onChange={(v) => setClipParam(clip.id, key, v)}
                offLabel={isBeatSync ? 'Always On' : undefined}
                onLabel={isBeatSync ? 'Beat Pulse' : undefined}
              />
            );
          }

          const automated = isAutomationCurve(raw);
          const display = automated ? raw.points[0]?.value : raw;
          const showAutomate = schema.kind === 'slider';
          return (
            <label key={key} className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-dim)] flex items-center">
                  {schema.label}
                  {showAutomate && (
                    <AutomateButton
                      clipId={clip.id}
                      paramKey={key}
                      paramLabel={schema.label}
                      value={raw}
                    />
                  )}
                </span>
                {/* Plan 9c — slider value or "auto" indicator. Right-
                    aligned w-10 tabular-nums so the column doesn't
                    jitter mid-drag. */}
                {schema.kind === 'slider' && (
                  <ValueDisplay raw={raw} schema={schema} />
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
        {Object.entries(params as Record<string, unknown>)
          .filter(([k]) => !isReservedParamKey(k))
          .some(([, v]) => isAutomationCurve(v)) && (
          <div className="pt-1">
            <EditOnTimelineLink clipId={clip.id} />
          </div>
        )}
      </div>
      <TransitionSection clipId={clip.id} />
    </div>
  );
}

type SliderSchema = Extract<ParamType, { kind: 'slider' }> & { label: string };

function ValueDisplay({
  raw,
  schema
}: {
  raw: unknown;
  schema: SliderSchema;
}) {
  if (isAutomationCurve(raw)) {
    return (
      <span className="text-[10px] uppercase w-10 text-right text-[var(--text-muted)] tabular-nums">
        auto
      </span>
    );
  }
  if (typeof raw !== 'number') return null;
  return (
    <span className="text-xs w-10 text-right text-[var(--text-dim)] tabular-nums">
      {formatParamValue(raw, schema)}
    </span>
  );
}

function EditOnTimelineLink({ clipId }: { clipId: string }) {
  // Renamed conceptually to "Open editor" — the action now opens the
  // full-screen AutomationEditorModal instead of toggling the inline lane.
  // The inline lane in Tracks is always shown for the selected clip when
  // it has any automation curves (read-only preview).
  const openEditor = useAppStore((s) => s.setAutomationEditorClipId);
  return (
    <button
      type="button"
      onClick={() => openEditor(clipId)}
      className="text-xs text-[var(--a2)] underline hover:text-[var(--a1)]"
    >
      Open editor
    </button>
  );
}
