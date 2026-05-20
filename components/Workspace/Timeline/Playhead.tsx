'use client';
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import type { AudioEngine } from '@/lib/audio/engine';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

/**
 * Smooth 60fps playhead. The store-based path (useAudioEngine → onStateChange
 * → setPlayhead) only fires when audioEl.timeupdate fires (~4 Hz in most
 * browsers), so the visual position would step in ~250ms chunks. We bypass
 * React reconciliation here: rAF loop reads engine.currentTime each frame and
 * writes the left style imperatively. The store still gets the throttled
 * updates for non-visual consumers (Stop button, tests).
 */
export function Playhead({ engine }: { engine: AudioEngine | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const grid = useAppStore.getState().audio.grid;
        const zoom = useAppStore.getState().ui.zoom;
        // Prefer live engine.currentTime; fall back to the store's last-known
        // playhead (which is what Stop / programmatic seeks write into).
        let beats: number;
        const t = engine?.getState().currentTime;
        if (engine && Number.isFinite(t)) {
          beats = Math.max(0, ((t! - grid.offsetMs / 1000) * grid.bpm) / 60);
        } else {
          beats = useAppStore.getState().timeline.playhead.beats;
        }
        el.style.left = `${TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom}px`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  return (
    <div
      ref={ref}
      className="absolute top-0 bottom-0 w-px bg-[var(--a1)] pointer-events-none"
    />
  );
}
