'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

export function AutomationPointEditOverlay({
  clipId,
  paramKey,
  pointIndex,
  valueMin,
  valueMax,
  lengthBeats,
  onClose
}: {
  clipId: string;
  paramKey: string;
  pointIndex: number;
  valueMin: number;
  valueMax: number;
  lengthBeats: number;
  onClose: () => void;
}) {
  const updateParamPoint = useAppStore((s) => s.timelineActions.updateParamPoint);
  const beat = useAppStore((s) => {
    const c = s.timeline.clips.find((cc) => cc.id === clipId);
    const v = c?.params?.[paramKey];
    return isAutomationCurve(v)
      ? ((v as AutomationCurve<number>).points[pointIndex]?.beat ?? 0)
      : 0;
  });
  const value = useAppStore((s) => {
    const c = s.timeline.clips.find((cc) => cc.id === clipId);
    const v = c?.params?.[paramKey];
    return isAutomationCurve(v)
      ? ((v as AutomationCurve<number>).points[pointIndex]?.value ?? 0)
      : 0;
  });

  const [beatDraft, setBeatDraft] = useState(String(beat));
  const [valueDraft, setValueDraft] = useState(String(value));
  // Escape sets a "cancel" guard so the subsequent blur doesn't re-commit
  // the drafts the user just abandoned.
  const cancelledRef = useRef(false);
  const beatRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    beatRef.current?.focus();
    beatRef.current?.select();
  }, []);

  const commit = () => {
    if (cancelledRef.current) return;
    const nb = Number(beatDraft);
    const nv = Number(valueDraft);
    const patch: { beat?: number; value?: number } = {};
    if (Number.isFinite(nb)) patch.beat = Math.max(0, Math.min(lengthBeats, nb));
    if (Number.isFinite(nv)) patch.value = Math.max(valueMin, Math.min(valueMax, nv));
    if (patch.beat !== undefined || patch.value !== undefined) {
      updateParamPoint(clipId, paramKey, pointIndex, patch);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      onClose();
    } else if (e.key === 'Escape') {
      cancelledRef.current = true;
      onClose();
    }
  };

  return (
    <div
      className="absolute z-50 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-lg"
      role="dialog"
      aria-label="Edit automation point"
      style={{ top: 4, left: 88 }}
    >
      <label className="text-[10px] text-[var(--text-dim)]">
        Beat
        <input
          ref={beatRef}
          aria-label="Beat"
          type="number"
          step="0.0625"
          className="ml-1 w-16 bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5 text-xs"
          value={beatDraft}
          onChange={(e) => setBeatDraft(e.target.value)}
          onBlur={() => {
            commit();
            onClose();
          }}
          onKeyDown={onKey}
        />
      </label>
      <label className="text-[10px] text-[var(--text-dim)]">
        Value
        <input
          aria-label="Value"
          type="number"
          step="0.01"
          className="ml-1 w-16 bg-[var(--surface-3)] text-[var(--text)] rounded px-1 py-0.5 text-xs"
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          onBlur={() => {
            commit();
            onClose();
          }}
          onKeyDown={onKey}
        />
      </label>
    </div>
  );
}
