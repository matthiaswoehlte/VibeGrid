'use client';
import { useEffect, useRef, useState } from 'react';
import type { SoundEntry } from '@/lib/sounds/types';

function formatDurationSec(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`;
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const r = total % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
}

interface SoundLibraryItemProps {
  sound: SoundEntry;
  onAdd: (sound: SoundEntry) => void;
}

/**
 * Plan 8.7 — single sound entry inside the Sound Library accordion.
 *
 * - **Preview ▶/■**: plays the sound via a transient `<audio>` element
 *   (no Web Audio decode, no store mutation). Toggle replays. The
 *   element is paused + reset on unmount or category collapse.
 * - **Add [+]**: invokes `onAdd(sound)` — the parent handles
 *   `addMediaRef + addClip` on the nearest audio track.
 * - **Drag**: native HTML5 drag with `application/x-vibegrid-sound`
 *   carrying the sound id. `Tracks.tsx` resolves this back to the
 *   SoundEntry via the store's manifest and runs the same add path.
 */
export function SoundLibraryItem({ sound, onAdd }: SoundLibraryItemProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // Pause on unmount so a category collapse doesn't keep audio running.
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
    };
  }, []);

  function togglePreview() {
    let el = audioRef.current;
    if (!el) {
      el = new Audio(sound.url);
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.addEventListener('ended', () => setPlaying(false));
      el.addEventListener('error', () => setPlaying(false));
      audioRef.current = el;
    }
    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
      return;
    }
    el.currentTime = 0;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData('application/x-vibegrid-sound', sound.id);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <li
      draggable
      onDragStart={onDragStart}
      title={`${sound.label} — drag onto an Audio track`}
      className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--surface-2)] text-xs cursor-grab active:cursor-grabbing hover:bg-[var(--surface-3)]"
    >
      <span className="text-[var(--text-dim)]" aria-hidden>🔊</span>
      <span className="flex-1 truncate text-[var(--text)]" title={sound.label}>
        {sound.label}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
        {formatDurationSec(sound.duration)}
      </span>
      <button
        type="button"
        onClick={togglePreview}
        className="px-1.5 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)]"
        title={playing ? 'Stop preview' : 'Preview'}
      >
        {playing ? '■' : '▶'}
      </button>
      <button
        type="button"
        onClick={() => onAdd(sound)}
        className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text)] hover:bg-[var(--a1)]/30"
        title="Auf Audio-Track legen"
      >
        +
      </button>
    </li>
  );
}
