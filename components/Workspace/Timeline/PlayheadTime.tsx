'use client';
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Plan 9b follow-up — wall-clock time display for the current playhead
 * position. Format `HH:MM:SS`. Mounted in the Timeline-Toolbar above
 * the Gantt area.
 *
 * Update strategy mirrors `Playhead.tsx`: own RAF loop with imperative
 * DOM write (`el.textContent`), never re-renders through React. This
 * keeps the display in lock-step with the playhead bar even when the
 * main thread is under FX-render pressure — both run on the same RAF
 * cadence, both write directly to DOM, no reconciliation cost.
 *
 * Update gating: text is only written when the formatted string
 * differs from the last value, so the typical 60 RAF ticks/second
 * collapse to 1 DOM-write/second.
 */

function formatHMS(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function PlayheadTime() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId: number;
    let lastText = '';
    const tick = (): void => {
      const el = ref.current;
      if (el) {
        const state = useAppStore.getState();
        const beats = state.timeline.playhead.beats;
        const bpm = state.audio.grid.bpm || 120;
        // playhead.beats is synced from engine.currentTime via
        // useAudioEngine.onStateChange. During playback the audio
        // thread drives the update; when paused, it's the user-set
        // position. Conversion to seconds is plain beats × 60 / bpm
        // (offsetMs not added — the display is the user-relevant
        // time-into-content, not the audio-context wall clock).
        const sec = Math.max(0, (beats * 60) / bpm);
        const text = formatHMS(sec);
        if (text !== lastText) {
          el.textContent = text;
          lastText = text;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <span
      ref={ref}
      className="font-mono text-sm text-[var(--text)] tabular-nums select-none px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]"
      aria-label="Playhead time"
    >
      00:00:00
    </span>
  );
}
