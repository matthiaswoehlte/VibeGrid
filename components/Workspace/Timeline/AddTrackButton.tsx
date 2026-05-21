'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import type { TrackKind } from '@/lib/timeline/types';

/**
 * Plan 5.9a — "+ Track hinzufügen" button with a dropdown picker.
 * 'audio' is intentionally excluded — Multi-Audio is parked for v0.2
 * (the store action would throw if called with it).
 */
const PICKER_OPTIONS: ReadonlyArray<{
  kind: TrackKind;
  label: string;
  group: 'media' | 'fx';
}> = [
  { kind: 'image', label: 'Image', group: 'media' },
  { kind: 'video', label: 'Video', group: 'media' },
  { kind: 'contour', label: 'Contour', group: 'fx' },
  { kind: 'sweep', label: 'Sweep', group: 'fx' },
  { kind: 'pulse', label: 'Pulse', group: 'fx' },
  { kind: 'zoom-pulse', label: 'Zoom Pulse', group: 'fx' },
  { kind: 'particles', label: 'Particles', group: 'fx' },
  { kind: 'text', label: 'Text', group: 'fx' },
  { kind: 'dissolve', label: 'Dissolve', group: 'fx' },
  { kind: 'sunray', label: 'Sunray', group: 'fx' }
];

export function AddTrackButton() {
  const addTrack = useAppStore((s) => s.timelineActions.addTrack);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const handlePick = (kind: TrackKind) => {
    setOpen(false);
    try {
      addTrack(kind);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Track-Add fehlgeschlagen');
    }
  };

  const mediaOptions = PICKER_OPTIONS.filter((o) => o.group === 'media');
  const fxOptions = PICKER_OPTIONS.filter((o) => o.group === 'fx');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-7 px-3 rounded text-xs bg-[var(--surface-2)] text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors"
      >
        + Track hinzufügen
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1 min-w-[180px] bg-[var(--surface-2)] border border-[var(--border)] rounded shadow-lg z-30 py-1">
          <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            Media
          </div>
          {mediaOptions.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => handlePick(o.kind)}
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
            >
              {o.label}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--border)]" />
          <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            FX
          </div>
          {fxOptions.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => handlePick(o.kind)}
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
