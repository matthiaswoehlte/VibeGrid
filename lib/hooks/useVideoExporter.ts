'use client';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { createVideoExporter, type VideoExporter } from '@/lib/export/recorder';
import type { AudioEngine } from '@/lib/audio/engine';

export interface UseVideoExporterArgs {
  canvas: HTMLCanvasElement | null;
  audioEngine: AudioEngine | null;
}

export function useVideoExporter({ canvas, audioEngine }: UseVideoExporterArgs) {
  const setExportState = useAppStore((s) => s.setExportState);
  const exporterRef = useRef<VideoExporter | null>(null);
  const codecToastedRef = useRef(false);

  // Build the exporter when canvas + engine become available.
  // audioMediaRef is read fresh on each start() via getAudioMediaRef —
  // capturing it here would freeze at the hook's mount time (when the
  // user hasn't uploaded any audio yet), guaranteeing the first export
  // attempt fails with 'no-audio'.
  useEffect(() => {
    if (!canvas || !audioEngine) {
      exporterRef.current = null;
      return;
    }
    exporterRef.current = createVideoExporter({
      canvas,
      audioEngine,
      getTimeline: () => useAppStore.getState().timeline,
      getAudioMediaRef: () =>
        useAppStore.getState().media.mediaRefs.find((m) => m.kind === 'audio') ?? null,
      setExportState
    });
    return () => {
      exporterRef.current?.cancel();
      exporterRef.current = null;
    };
  }, [canvas, audioEngine, setExportState]);

  // Elapsed-seconds + progress tick (1 Hz) — only while recording.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const sub = useAppStore.subscribe((state, prev) => {
      const was = prev.ui.exportState.status;
      const is = state.ui.exportState.status;
      if (is === 'recording' && was !== 'recording') {
        intervalId = setInterval(() => {
          const s = useAppStore.getState().ui.exportState;
          const nextElapsed = s.elapsedSeconds + 1;
          setExportState({
            elapsedSeconds: nextElapsed,
            progress: s.totalSeconds > 0 ? nextElapsed / s.totalSeconds : 0
          });
        }, 1000);
      } else if (is !== 'recording' && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });
    return () => {
      sub();
      if (intervalId) clearInterval(intervalId);
    };
  }, [setExportState]);

  // Codec label toast (Spec §8.1.1 — show the user what they got).
  useEffect(() => {
    const sub = useAppStore.subscribe((state, prev) => {
      const label = state.ui.exportState.codecLabel;
      const prevLabel = prev.ui.exportState.codecLabel;
      if (label && label !== prevLabel && !codecToastedRef.current) {
        codecToastedRef.current = true;
        toast.info(`Export codec: ${label}`);
      }
      if (state.ui.exportState.status === 'idle') {
        codecToastedRef.current = false;
      }
    });
    return sub;
  }, []);

  // Tab-visibility persistent warning (Spec §8.1.5).
  useEffect(() => {
    let toastId: string | number | null = null;
    const onVis = () => {
      const status = useAppStore.getState().ui.exportState.status;
      if (status !== 'recording') return;
      if (document.hidden) {
        setExportState({ warning: 'tab-hidden' });
        toastId = toast.warning(
          'Tab im Hintergrund — Export-Qualität beeinträchtigt. Tab aktiv halten!',
          { duration: Infinity }
        );
      } else {
        if (toastId !== null) {
          toast.dismiss(toastId);
          toastId = null;
        }
        setExportState({ warning: undefined });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (toastId !== null) toast.dismiss(toastId);
    };
  }, [setExportState]);

  // FPS performance monitor — one-shot warning at < 24 fps avg (60-frame window).
  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();
    const window: number[] = [];
    let warned = false;
    const tick = () => {
      const status = useAppStore.getState().ui.exportState.status;
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      if (status === 'recording') {
        window.push(dt);
        if (window.length > 60) window.shift();
        const avgMs = window.reduce((a, b) => a + b, 0) / window.length;
        const fps = 1000 / avgMs;
        if (!warned && window.length >= 60 && fps < 24) {
          warned = true;
          setExportState({ warning: 'performance-degraded' });
          toast.warning('Performance dropped — export may have dropped frames');
        }
      } else {
        window.length = 0;
        warned = false;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [setExportState]);

  const api = useMemo(
    () => ({
      start: async () => {
        // Pre-start: rewind audio + playhead to beat 0 so the export always
        // captures the full song from the beginning.
        audioEngine?.pause();
        audioEngine?.seek(0);
        useAppStore.getState().timelineActions.setPlayhead(0);

        // Start the recorder FIRST so we capture frame 0. Then start audio
        // playback — the MediaRecorder is now live on both tracks.
        await exporterRef.current?.start();

        // Kick off audio playback. Without this, the audio stream is silent,
        // the audio element never reaches 'ended', and the safety interval
        // polls a currentTime that stays at 0 forever → recording runs
        // until the user hits Cancel.
        try {
          await audioEngine?.play();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[useVideoExporter] audio play() failed:', err);
          // Roll back the recorder so we don't have a silent recording.
          exporterRef.current?.cancel();
        }
      },
      cancel: () => exporterRef.current?.cancel()
    }),
    [audioEngine]
  );

  return api;
}
