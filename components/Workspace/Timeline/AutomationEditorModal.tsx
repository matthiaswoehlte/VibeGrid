'use client';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { isReservedParamKey } from '@/lib/timeline/overlap';
import type { AutomationCurve } from '@/lib/automation/types';
import { ParamControl } from '@/components/ui/ParamControl';
import { AutomateButton } from '../Inspector/AutomateButton';
import { AutomationCurveEditor } from './AutomationCurveEditor';

/**
 * Full-screen automation editor. Opens when `ui.expandedAutomationClipId`
 * matches a clip id. The user reaches it via the Inspector's "Open editor"
 * button. Inside the modal:
 *
 *  - Every automated slider param gets a large AutomationCurveEditor (curve
 *    canvas, snap picker, interpolation picker, ⚡-off button).
 *  - Every non-automated param shows its normal Inspector control plus the
 *    ⚡ toggle for sliders, so the user can flip params into automation mode
 *    without leaving the modal.
 *  - Scrollable when the FX has many params.
 *  - Closes on backdrop click, Escape, or the × button.
 */
export function AutomationEditorModal() {
  const editorClipId = useAppStore((s) => s.ui.expandedAutomationClipId);
  const setExpanded = useAppStore((s) => s.setExpandedAutomationClipId);
  const clip = useAppStore((s) =>
    editorClipId ? s.timeline.clips.find((c) => c.id === editorClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);

  // Escape closes — registered globally so the listener works even when the
  // focus is in an input inside the modal.
  useEffect(() => {
    if (!editorClipId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorClipId, setExpanded]);

  if (!editorClipId || !clip || !clip.fxId) return null;
  const plugin = getPlugin(clip.fxId);
  if (!plugin) return null;

  const params = {
    ...(plugin.getDefaultParams() as Record<string, unknown>),
    ...(clip.params ?? {})
  };

  // Split the schema into automated-sliders (big curve editor) and
  // everything-else (compact Inspector-style controls). Reserved __ params
  // never appear in either list.
  const schemaEntries = Object.entries(plugin.paramSchema).filter(
    ([k]) => !isReservedParamKey(k)
  );
  const automated = schemaEntries.filter(
    ([k, schema]) => schema.kind === 'slider' && isAutomationCurve(params[k])
  );
  const others = schemaEntries.filter(([k, schema]) => {
    if (schema.kind !== 'slider') return true;
    return !isAutomationCurve(params[k]);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={`Automation editor for ${clip.label}`}
      onPointerDown={(e) => {
        // Backdrop click: only close when the click was on the backdrop
        // itself, not on the modal card.
        if (e.target === e.currentTarget) setExpanded(null);
      }}
    >
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl w-[90vw] h-[85vh] max-w-[1400px] flex flex-col">
        <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">{plugin.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
              Automation editor — {clip.label}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close automation editor"
            onClick={() => setExpanded(null)}
            className="h-7 w-7 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {automated.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--text-dim)]">
              No automated params yet. Toggle ⚡ on any slider below to start.
            </div>
          ) : (
            automated.map(([key, schema]) => {
              if (schema.kind !== 'slider') return null;
              const curve = params[key] as AutomationCurve<number>;
              return (
                <AutomationCurveEditor
                  key={key}
                  clipId={clip.id}
                  paramKey={key}
                  paramLabel={schema.label}
                  curve={curve}
                  lengthBeats={clip.lengthBeats}
                  valueMin={schema.min}
                  valueMax={schema.max}
                />
              );
            })
          )}

          {others.length > 0 && (
            <div className="border-t-2 border-[var(--border)] p-3 bg-[var(--surface-2)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-2">
                Other parameters
              </div>
              <div className="grid grid-cols-2 gap-3">
                {others.map(([key, schema]) => {
                  const raw = (params as Record<string, unknown>)[key];
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
                      </div>
                      <ParamControl
                        paramKey={key}
                        schema={schema}
                        value={raw}
                        onChange={(v) => setClipParam(clip.id, key, v)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
