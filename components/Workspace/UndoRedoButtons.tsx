'use client';
import { useAppStore } from '@/lib/store';

/**
 * Plan 10 — Undo/Redo controls in the WorkspaceHeader.
 *
 * Disabled state derives directly from history.past / history.future
 * length. Tooltip surfaces the label + relative timestamp of the next
 * undo/redo target so the user knows what's about to revert.
 */
export function UndoRedoButtons() {
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const past = useAppStore((s) => s.history.past);
  const future = useAppStore((s) => s.history.future);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const undoLabel = canUndo ? past[past.length - 1].label : null;
  const redoLabel = canRedo ? future[0].label : null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
        className="px-2 py-1 rounded-md text-xs text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ↶
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
        className="px-2 py-1 rounded-md text-xs text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ↷
      </button>
    </div>
  );
}
