'use client';
import { useEffect } from 'react';

export interface ConfirmDeleteModalProps {
  open: boolean;
  soundLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Plan 8.7b — confirm dialog before a Sound Library delete. Pattern
 * adapted from ConfirmReplaceAudioModal (Plan 8d). Delete is unreversible
 * (no undo for R2 mutations) so a single confirm step replaces the
 * undo safety net.
 */
export function ConfirmDeleteModal({
  open,
  soundLabel,
  onConfirm,
  onCancel
}: ConfirmDeleteModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sound löschen"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <h2 className="text-base font-bold">Sound löschen?</h2>
        <div className="text-sm space-y-2">
          <p className="text-[var(--text-dim)]">Diese Aktion entfernt:</p>
          <p className="text-xs text-[var(--a3)] font-mono truncate">
            {soundLabel}
          </p>
          <ul className="text-xs text-[var(--text-muted)] list-disc list-inside space-y-1">
            <li>Der Eintrag wird sofort aus dem Manifest entfernt</li>
            <li>Die MP3 wird aus R2 gelöscht</li>
            <li>User-Caches invalidieren beim nächsten Reload</li>
            <li>Nicht rückgängig zu machen</li>
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
          >
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}
