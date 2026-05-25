'use client';
import { useEffect } from 'react';

/**
 * Plan 8d — Confirm modal shown when the user drops a SECOND file on
 * the sync-audio track in VibeGrid. Replacing wipes the old song +
 * triggers BPM re-detection + main-video clip re-snap, all of which
 * can lose manual BPM tweaks. The modal makes that explicit.
 *
 * No checkbox — single confirm step is enough (less destructive than
 * the Transfer wipe, just per-track).
 */
export interface ConfirmReplaceAudioModalProps {
  open: boolean;
  /** Display name of the song that's about to be replaced. */
  currentFilename: string | null;
  /** Detected BPM of the current song, for the user to see what they
   *  lose. */
  currentBpm: number | null;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmReplaceAudioModal({
  open,
  currentFilename,
  currentBpm,
  onConfirm,
  onCancel
}: ConfirmReplaceAudioModalProps) {
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
      aria-label="Sync-Audio ersetzen"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <h2 className="text-base font-bold">Sync-Audio ersetzen</h2>
        <div className="text-sm space-y-2">
          <p>Auf der Sync-Audio-Spur liegt bereits ein Song:</p>
          <p className="text-xs text-[var(--a3)] font-mono truncate">
            {currentFilename ?? 'Unbenannt'}{' '}
            {currentBpm !== null && (
              <span className="text-[var(--text-muted)]">(BPM {currentBpm})</span>
            )}
          </p>
          <p className="text-xs text-[var(--text-dim)]">Beim Ersetzen:</p>
          <ul className="text-xs text-[var(--text-muted)] list-disc list-inside space-y-1">
            <li>Alter Song wird aus der Spur entfernt</li>
            <li>BPM-Re-Detect läuft (kann 2–5 s dauern)</li>
            <li>Main-Video-Clips werden auf neue BPM restrukturiert</li>
            <li>Manuelle BPM-Anpassungen gehen verloren</li>
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
            className="text-xs px-3 py-1.5 rounded bg-[var(--a1)] text-white"
          >
            Ersetzen
          </button>
        </div>
      </div>
    </div>
  );
}
