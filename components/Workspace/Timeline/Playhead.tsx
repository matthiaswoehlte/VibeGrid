'use client';
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

/**
 * Smooth 60fps playhead inside the shared horizontal-scroll container.
 * Reads engine.currentTime each rAF tick and writes el.style.left
 * imperatively to bypass React reconciliation.
 *
 * Bounded: hidden when beats > totalBeats so the line never escapes the
 * Gantt area (visible escapes used to overlap the right edge of the
 * timeline panel).
 */
export function Playhead({
  engine,
  totalBeats
}: {
  engine: AudioEngine | null;
  totalBeats: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const grid = useAppStore.getState().audio.grid;
        const zoom = useAppStore.getState().ui.zoom;
        let beats: number;
        const t = engine?.getState().currentTime;
        if (engine && Number.isFinite(t)) {
          beats = Math.max(0, ((t! - grid.offsetMs / 1000) * grid.bpm) / 60);
        } else {
          beats = useAppStore.getState().timeline.playhead.beats;
        }
        if (beats > totalBeats) {
          el.style.display = 'none';
        } else {
          el.style.display = 'block';
          el.style.left = `${TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom}px`;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine, totalBeats]);

  return (
    <div
      ref={ref}
      className="absolute top-0 bottom-0 w-px bg-[var(--a1)] pointer-events-none z-40"
    />
  );
}
