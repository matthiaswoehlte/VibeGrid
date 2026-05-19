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

  return { engine };
}
