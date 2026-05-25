'use client';
import { useEffect, useState } from 'react';

/**
 * Plan 8d — Confirm modal shown before the SceneFlow Transfer wipes
 * the current VibeGrid project state and rebuilds tracks from the
 * story scenes. The user has to actively tick "Verstanden" before
 * "Transferieren" enables — a deliberate friction step because the
 * action destroys whatever they had on the timeline.
 */
export interface TransferConfirmModalProps {
  open: boolean;
  /** Read off the live Zustand store at open time so the user sees
   *  exactly what will be discarded. */
  trackCount: number;
  clipCount: number;
  sceneCount: number;
  /** Optional song info — shows '+ syncAudio.bpm' when set. */
  syncAudio: { filename?: string; bpm: number } | null;
  snapMode: 'beat' | 'bar' | 'off';
  onConfirm(): void;
  onCancel(): void;
}

export function TransferConfirmModal({
  open,
  trackCount,
  clipCount,
  sceneCount,
  syncAudio,
  snapMode,
  onConfirm,
  onCancel
}: TransferConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset checkbox each time the modal re-opens. Closing without confirm
  // shouldn't leave a "ready" state if the user changes their mind later.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const snapLabel =
    snapMode === 'beat' ? 'Beat' : snapMode === 'bar' ? 'Takt (4 Beats)' : 'aus';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Transfer to Timeline bestätigen"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <h2 className="text-base font-bold">Achtung</h2>
        <div className="text-sm space-y-2">
          <p>
            Transfer to Timeline überschreibt die aktuelle VibeGrid-Timeline
            komplett:
          </p>
          <ul className="text-xs text-[var(--text-dim)] list-disc list-inside space-y-1">
            <li>
              {trackCount} Tracks und {clipCount} Clips werden gelöscht
            </li>
            <li>Main-Video + Sync-Audio werden neu erstellt</li>
            <li>FX, Automation, alle anderen Spuren weg</li>
          </ul>
          <p className="text-xs text-[var(--text-muted)]">
            Story enthält {sceneCount} fertige Szenen.
            {syncAudio && (
              <>
                {' '}
                Song:{' '}
                <span className="text-[var(--a3)]">
                  {syncAudio.filename ?? 'hochgeladen'}
                </span>{' '}
                (BPM {syncAudio.bpm}, Snap auf {snapLabel}).
              </>
            )}
            {!syncAudio && (
              <>
                {' '}
                Kein Sync-Audio — Clips landen sequenziell auf der Timeline (
                Snap auf {snapLabel}, Standard 120 BPM).
              </>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          Verstanden, weiter
        </label>
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
            disabled={!acknowledged}
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-[var(--a1)] text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Transferieren
          </button>
        </div>
      </div>
    </div>
  );
}
