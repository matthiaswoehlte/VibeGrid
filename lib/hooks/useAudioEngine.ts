'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { createAudioEngine, type AudioEngine } from '@/lib/audio/engine';

export interface UseAudioEngine {
  engine: AudioEngine | null;
}

/**
 * Bridge between the AudioEngine and the Zustand store.
 *
 * - User edits BPM via `setBPM` → audio-slice writes `source: 'manual'` →
 *   subscriber sees `manual` source and pushes the value to `engine.setBPM`.
 * - Engine detection writes via `setDetectedGrid` → audio-slice writes
 *   `source: 'detected'` → subscriber sees `detected` source and SKIPS the
 *   engine push (would otherwise loop).
 *
 * The source field is already part of `BeatGrid` (Plan 2), so no new actions
 * or runtime patching are needed.
 */
export function useAudioEngine(): UseAudioEngine {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const lastSeenBpmRef = useRef<number | null>(null);

  useEffect(() => {
    const e = createAudioEngine();
    setEngine(e);
    lastSeenBpmRef.current = useAppStore.getState().audio.grid.bpm;
    return () => {
      e.destroy();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    const unsub = useAppStore.subscribe((state) => {
      const grid = state.audio.grid;
      if (grid.bpm === lastSeenBpmRef.current) return;
      lastSeenBpmRef.current = grid.bpm;
      // Source-guard: the BPM just changed because the ENGINE wrote it
      // (detected grid) — do not push back to the engine.
      if (grid.source === 'detected') return;
      engine.setBPM(grid.bpm);
    });
    return unsub;
  }, [engine]);

  // Auto-load the most recently added audio MediaRef into the engine.
  // v0.1 assumes a single soundtrack at a time — newest audio upload wins.
  useEffect(() => {
    if (!engine) return;
    // Prime once on mount from current state (handles rehydrated mediaRefs).
    const initial = useAppStore.getState().media.mediaRefs.filter((m) => m.kind === 'audio');
    const lastInitial = initial[initial.length - 1];
    if (lastInitial) {
      engine.load(lastInitial.url).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[useAudioEngine] initial audio load failed:', err);
      });
    }
    // Subscribe to future audio additions.
    const unsub = useAppStore.subscribe((state, prev) => {
      const added = state.media.mediaRefs.filter(
        (m) => m.kind === 'audio' && !prev.media.mediaRefs.find((p) => p.id === m.id)
      );
      const latest = added[added.length - 1];
      if (latest) {
        engine.load(latest.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[useAudioEngine] audio load failed:', err);
        });
      }
    });
    return unsub;
  }, [engine]);

  return { engine };
}
