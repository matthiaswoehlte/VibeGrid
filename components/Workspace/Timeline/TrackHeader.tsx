'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';
import type { Track } from '@/lib/timeline/types';

/**
 * Plan 5.9a — sticky left-column header for a single timeline track:
 * - Label (double-click to edit inline)
 * - Mute toggle
 * - Delete button (disabled when the track still has clips)
 */
export function TrackHeader({ track, width }: { track: Track; width: number }) {
  const setMuted = useAppStore((s) => s.timelineActions.setMuted);
  const setTrackLabel = useAppStore((s) => s.timelineActions.setTrackLabel);
  const removeTrack = useAppStore((s) => s.timelineActions.removeTrack);
  const clipCount = useAppStore(
    (s) => s.timeline.clips.filter((c) => c.trackId === track.id).length
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitEdit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== track.name) {
      setTrackLabel(track.id, draft.trim());
    } else {
      setDraft(track.name);
    }
  };

  const onDelete = () => {
    try {
      removeTrack(track.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Track-Delete fehlgeschlagen');
    }
  };

  return (
    <div
      data-track-label
      className="shrink-0 sticky left-0 z-20 bg-[var(--surface-1)] border-r border-[var(--border)] px-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] select-none"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => setMuted(track.id, !track.muted)}
        title={track.muted ? 'Unmute' : 'Mute'}
        className={`shrink-0 h-4 w-4 rounded text-[9px] ${
          track.muted
            ? 'bg-[var(--surface-3)] text-[var(--text-muted)]'
            : 'text-[var(--a2)]'
        }`}
      >
        {track.muted ? 'M' : '•'}
      </button>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') {
              setDraft(track.name);
              setEditing(false);
            }
          }}
          className="flex-1 min-w-0 bg-[var(--surface-2)] text-[var(--text)] text-[10px] uppercase tracking-wider rounded px-1 py-0.5 outline-none border border-[var(--a1)]"
        />
      ) : (
        <span
          onDoubleClick={() => {
            setDraft(track.name);
            setEditing(true);
          }}
          title="Doppelklick zum Umbenennen"
          className="flex-1 min-w-0 truncate cursor-text"
        >
          {track.name}
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={clipCount > 0}
        title={
          clipCount > 0
            ? `Track enthält ${clipCount} Clip${clipCount === 1 ? '' : 's'} — erst leeren`
            : 'Track löschen'
        }
        className={`shrink-0 h-4 w-4 rounded text-[10px] ${
          clipCount > 0
            ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]'
        }`}
      >
        ×
      </button>
    </div>
  );
}
