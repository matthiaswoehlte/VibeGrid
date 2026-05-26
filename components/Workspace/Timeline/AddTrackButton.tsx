'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import type { TrackKind } from '@/lib/timeline/types';

/**
 * Plan 5.9a/5.9c/5.9d/8d — "+ Track hinzufügen" button with a dropdown picker.
 *
 * Picker exposes user-creatable track kinds: Image, Video, Audio, FX —
 * plus the two Plan-8d singleton kinds (Main Video, Sync Audio) when
 * the project doesn't already have them. Both auto-hide once present
 * since they're 1-per-project by design.
 */
const PICKER_OPTIONS: ReadonlyArray<{
  kind: TrackKind;
  label: string;
  group: 'media' | 'fx' | 'sceneflow';
}> = [
  { kind: 'image', label: 'Image', group: 'media' },
  { kind: 'video', label: 'Video', group: 'media' },
  { kind: 'audio', label: 'Audio', group: 'media' },
  { kind: 'main-video', label: 'Main Video', group: 'sceneflow' },
  { kind: 'sync-audio', label: 'Sync Audio', group: 'sceneflow' },
  { kind: 'fx', label: 'FX', group: 'fx' }
];

export function AddTrackButton() {
  const addTrack = useAppStore((s) => s.timelineActions.addTrack);
  const tracks = useAppStore((s) => s.timeline.tracks);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Plan 8d — singleton enforcement for main-video + sync-audio.
  const hasMainVideo = tracks.some((t) => t.kind === 'main-video');
  const hasSyncAudio = tracks.some((t) => t.kind === 'sync-audio');

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
    // Plan 5.9c — `addTrack` soft-rejects via toast for `'audio'`, so
    // we don't need a try/catch here anymore.
    addTrack(kind);
  };

  const mediaOptions = PICKER_OPTIONS.filter((o) => o.group === 'media');
  const sceneflowOptions = PICKER_OPTIONS.filter(
    (o) =>
      o.group === 'sceneflow' &&
      !(o.kind === 'main-video' && hasMainVideo) &&
      !(o.kind === 'sync-audio' && hasSyncAudio)
  );
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
        <div className="absolute left-0 top-full mt-1 min-w-[180px] bg-[var(--surface-2)] border border-[var(--border)] rounded shadow-lg z-30 py-1">
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
          {sceneflowOptions.length > 0 && (
            <>
              <div className="my-1 border-t border-[var(--border)]" />
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                SceneFlow
              </div>
              {sceneflowOptions.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  onClick={() => handlePick(o.kind)}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
                >
                  {o.label}
                </button>
              ))}
            </>
          )}
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
