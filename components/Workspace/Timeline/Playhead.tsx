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
        const engineState = engine?.getState();
        const t = engineState?.currentTime;
        const isPlaying = engineState?.status === 'playing';
        if (engine && Number.isFinite(t)) {
          beats = Math.max(0, ((t! - grid.offsetMs / 1000) * grid.bpm) / 60);
        } else {
          beats = useAppStore.getState().timeline.playhead.beats;
        }
        const playheadPx = TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom;
        if (beats > totalBeats) {
          el.style.display = 'none';
        } else {
          el.style.display = 'block';
          el.style.left = `${playheadPx}px`;
        }

        // Auto-scroll: while playing, keep the playhead inside the viewport.
        // Page-flip style — only re-center when the playhead is about to
        // leave (or already left) the visible area. Respects manual scrolls
        // until the next viewport-exit event.
        const scrollContainer = el.parentElement;
        if (isPlaying && scrollContainer) {
          const viewportWidth = scrollContainer.clientWidth;
          const scrollLeft = scrollContainer.scrollLeft;
          const playheadInView = playheadPx - scrollLeft;
          if (playheadInView > viewportWidth * 0.9 || playheadInView < TRACK_LABEL_WIDTH) {
            const next = Math.max(0, playheadPx - viewportWidth * 0.5);
            const max = scrollContainer.scrollWidth - viewportWidth;
            scrollContainer.scrollLeft = Math.min(next, Math.max(0, max));
          }
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
