'use client';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { createVideoExporter, type VideoExporter } from '@/lib/export/recorder';
import { isWebCodecsSupported } from '@/lib/export/webcodecs';
import { renderOffline } from '@/lib/export/offline-render';
import { makeFilename } from '@/lib/export/filename';
import { hasVisualClipAt } from '@/lib/timeline/selectors';
import type { VideoDecoderPool } from '@/lib/video/decoder-pool';
import type { AudioEngine } from '@/lib/audio/engine';
import type { VideoEngine } from '@/lib/video/engine';

export interface UseVideoExporterArgs {
  canvas: HTMLCanvasElement | null;
  audioEngine: AudioEngine | null;
  /** Plan-6-R: offline pipeline borrows the live ImageBitmap cache so it
   *  doesn't re-fetch + re-decode every image. The page component owns the
   *  ref and writes into it from useRenderer's return. May read `null` if
   *  the renderer hasn't mounted yet — the offline path treats that as
   *  "no bitmaps available" and falls back to the background-only render. */
  getImageBitmap?: (mediaId: string) => ImageBitmap | undefined;
  /** Plan-5.9b: offline pipeline awaits `seekAllTo` per frame so the
   *  encoded MP4 is frame-accurate against the source videos. Projects
   *  with no video clips: this is a fast no-op. */
  videoEngine?: VideoEngine | null;
  /** Plan 5.10+ long-lived pool — owned by useVideoDecoderPool in
   *  page.tsx. Pre-loaded with every timeline-referenced video MP4
   *  in the background. Export consumes it directly; never creates
   *  a fresh pool (would re-fetch all videos) and never destroys it
   *  (lifetime matches the studio page). */
  videoDecoderPool?: VideoDecoderPool | null;
}

const REVOKE_DELAY_MS = 10_000;
const DONE_RESET_MS = 2_000;

function triggerDownload(blob: Blob, ext: 'mp4' | 'webm'): void {
  const url = URL.createObjectURL(blob);
  const filename = makeFilename(new Date(), ext);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function useVideoExporter({
  canvas,
  audioEngine,
  getImageBitmap,
  videoEngine,
  videoDecoderPool
}: UseVideoExporterArgs) {
  const setExportState = useAppStore((s) => s.setExportState);
  const exporterRef = useRef<VideoExporter | null>(null);
  const codecToastedRef = useRef(false);
  const offlineAbortRef = useRef<AbortController | null>(null);
  const offlineModeNoticedRef = useRef(false);

  // Build the realtime exporter when canvas + engine become available.
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

  // Elapsed-seconds tick (realtime only — offline drives progress through onProgress).
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const sub = useAppStore.subscribe((state, prev) => {
      const was = prev.ui.exportState.status;
      const is = state.ui.exportState.status;
      const mode = state.ui.exportState.mode;
      if (is === 'recording' && was !== 'recording' && mode === 'realtime') {
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

  // Codec label toast (works for both paths).
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

  // Tab-visibility warning — only matters in realtime mode. Offline rendering
  // still throttles RAF when backgrounded, but the encoder owns its own
  // pacing, so the warning isn't useful (the render simply takes longer).
  useEffect(() => {
    let toastId: string | number | null = null;
    const onVis = () => {
      const state = useAppStore.getState().ui.exportState;
      if (state.status !== 'recording' || state.mode !== 'realtime') return;
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

  // FPS monitor — realtime only (offline is FPS-decoupled by construction).
  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();
    const fpsWindow: number[] = [];
    let warned = false;
    const tick = () => {
      const state = useAppStore.getState().ui.exportState;
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      if (state.status === 'recording' && state.mode === 'realtime') {
        fpsWindow.push(dt);
        if (fpsWindow.length > 60) fpsWindow.shift();
        const avgMs = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length;
        const fps = 1000 / avgMs;
        if (!warned && fpsWindow.length >= 60 && fps < 24) {
          warned = true;
          setExportState({ warning: 'performance-degraded' });
          toast.warning('Performance dropped — export may have dropped frames');
        }
      } else {
        fpsWindow.length = 0;
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
        // Common pre-roll for both paths: rewind so the export captures from beat 0.
        audioEngine?.pause();
        audioEngine?.seek(0);
        useAppStore.getState().timelineActions.setPlayhead(0);

        if (isWebCodecsSupported() && audioEngine) {
          // OFFLINE PATH — Plan 6-R.
          if (!offlineModeNoticedRef.current) {
            offlineModeNoticedRef.current = true;
            toast.info('Offline render via WebCodecs (1080p / 30 fps)');
          }

          const audioBuffer = audioEngine.getDecodedBuffer();
          if (!audioBuffer) {
            setExportState({
              status: 'error',
              mode: 'offline',
              errorCode: 'no-audio'
            });
            return;
          }
          const timeline = useAppStore.getState().timeline;
          if (!hasVisualClipAt(timeline, 0)) {
            setExportState({
              status: 'error',
              mode: 'offline',
              errorCode: 'no-image'
            });
            return;
          }

          // Plan 8d — reset every loaded decoder source so each export
          // starts deterministic. Without this, the pool carries state
          // from previous exports in the same page session: each
          // export-start triggers a backward-seek + flush recovery on
          // every source, and after enough cumulative runs (observed:
          // ~5 exports, especially when per-frame time grew due to
          // additional FX clips) one source ends up stuck delivering
          // the same frame for the rest of the export. Reset is
          // ~50-200 ms per source; cheap vs re-downloading.
          if (videoDecoderPool) {
            try {
              await videoDecoderPool.resetAllSources();
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                '[useVideoExporter] decoder-pool reset failed (proceeding):',
                err
              );
            }
          }

          // Plan 5.9d — derive the offline-render deps from the live
          // timeline. mixAudioOffline consumes the audio clips + the
          // audio-enabled video clips and emits one mixed buffer.
          const mediaRefs = useAppStore.getState().media.mediaRefs;
          const bpm = useAppStore.getState().audio.grid.bpm;
          const audioClips = timeline.clips.filter((c) => c.kind === 'audio');
          const videoAudioClips = timeline.clips
            .filter((c) => c.kind === 'video')
            .map((c) => {
              const ref = mediaRefs.find((m) => m.id === c.mediaId);
              const audioEnabled =
                (c.params as { audioEnabled?: unknown } | undefined)?.audioEnabled === true;
              return {
                url: ref?.url ?? '',
                startBeat: c.startBeat,
                lengthBeats: c.lengthBeats,
                audioEnabled
              };
            })
            .filter((vc) => vc.url !== '');

          const fps = 30;
          // Plan 8d — export length comes from the TIMELINE content end,
          // NOT the audio buffer's full duration. MP3s routinely have
          // 100+ s of trailing silence padded after the music (we
          // already trim that from the on-timeline clip via
          // `findEffectiveAudioEndSec`). If we kept using
          // `audioBuffer.duration` the exporter would still render the
          // silent tail — exported file 2-4× the actual content length.
          // The audio mixer (mixAudioOffline) outputs silence past the
          // clip's lengthBeats, so we're safe to set the export
          // duration to the last clip's end across ALL tracks (audio +
          // video + FX). Min 1 s as a floor so a 0-clip timeline still
          // produces a valid (if uninteresting) file.
          const lastClipEndBeats = timeline.clips.length > 0
            ? Math.max(
                ...timeline.clips.map((c) => c.startBeat + c.lengthBeats)
              )
            : 0;
          const lastClipEndSec = (lastClipEndBeats * 60) / bpm;
          const audioDurationSec = Math.max(lastClipEndSec, 1);
          const totalFrames = Math.ceil(audioDurationSec * fps);
          offlineAbortRef.current = new AbortController();
          setExportState({
            status: 'preparing',
            mode: 'offline',
            totalSeconds: audioDurationSec,
            totalFrames,
            currentFrame: 0,
            progress: 0,
            elapsedSeconds: 0
          });

          // Plan 5.10+ — long-lived VideoDecoderPool from
          // useVideoDecoderPool has been pre-loading videos in the
          // background since the user dropped them on the timeline.
          // At export time we just ensure every needed video is loaded
          // (pool.load is idempotent — if a background load is still
          // in flight, we await the same promise; if it's already
          // done, instant return). User typically sees no pre-load
          // wait; only fast-clicks after drop incur a brief wait for
          // the in-progress load.
          const videoMediaIds = Array.from(
            new Set(
              timeline.clips
                .filter((c) => c.kind === 'video' && typeof c.mediaId === 'string')
                .map((c) => c.mediaId as string)
            )
          );
          const PRELOAD_TIMEOUT_MS = 60_000;
          let failedCount = 0;
          if (videoDecoderPool && videoMediaIds.length > 0) {
            const loadedSet = new Set(videoDecoderPool.loadedIds());
            for (let i = 0; i < videoMediaIds.length; i++) {
              const id = videoMediaIds[i];
              if (loadedSet.has(id)) continue;
              const ref = mediaRefs.find((m) => m.id === id);
              const label = ref?.filename ?? id.slice(0, 8);
              setExportState({
                status: 'preparing',
                mode: 'offline',
                preparingPhase: `Lade Video ${i + 1}/${videoMediaIds.length}: ${label}`
              });
              if (!ref?.url) {
                failedCount++;
                continue;
              }
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), PRELOAD_TIMEOUT_MS);
              try {
                await videoDecoderPool.load(id, ref.url, ctrl.signal);
              } catch (err) {
                failedCount++;
                // eslint-disable-next-line no-console
                console.warn(
                  `[useVideoExporter] decoder load failed for ${label}:`,
                  err
                );
              } finally {
                clearTimeout(timer);
              }
            }
            if (failedCount > 0) {
              toast.warning(
                `${failedCount} Video(s) konnten für den Export nicht decodiert werden — diese erscheinen schwarz.`
              );
            }
          }
          setExportState({
            status: 'preparing',
            mode: 'offline',
            preparingPhase: undefined
          });

          try {
            const result = await renderOffline(
              {
                timeline,
                beatGrid: useAppStore.getState().audio.grid,
                audioClips,
                videoAudioClips,
                mediaRefs,
                bpm,
                audioDurationSec,
                sampleRate: audioBuffer.sampleRate,
                numberOfChannels: audioBuffer.numberOfChannels,
                getImageBitmap: getImageBitmap ?? (() => undefined),
                // Plan 5.10+ — long-lived DecoderPool from page.tsx
                // (useVideoDecoderPool) supersedes videoEngine for the
                // offline frame source. videoEngine still passed for
                // backwards-compat fallback when WebCodecs isn't
                // available. Pool is NOT destroyed here — owned by the
                // hook for the page's lifetime.
                videoEngine,
                getVideoElement: videoEngine
                  ? (mediaId: string) => videoEngine.getElement(mediaId)
                  : undefined,
                videoDecoderPool,
                flowMode: useAppStore.getState().ui.flowMode,
                // Plan 9d Task 3 — thread export range from store.
                // Read at export-start (not captured in closure) so a
                // late range-clear doesn't shorten an in-flight render.
                exportRange: useAppStore.getState().ui.exportRange
              },
              {
                fps,
                onProgress: (p) =>
                  setExportState({
                    status: 'recording',
                    mode: 'offline',
                    currentFrame: p.currentFrame,
                    totalFrames: p.totalFrames,
                    etaSeconds: p.etaSeconds,
                    progress: p.currentFrame / p.totalFrames
                  }),
                signal: offlineAbortRef.current.signal
              }
            );
            // Pool stays alive — useVideoDecoderPool owns it.
            setExportState({
              status: 'finalizing',
              mode: 'offline',
              codecLabel: result.codecLabel
            });
            if (result.ext === 'webm') {
              // Browser couldn't do any of the MP4 H.264 profiles via
              // WebCodecs — warn the user before the download arrives so
              // they don't open it in Windows Media Player and wonder why.
              toast.warning(
                'MP4 (H.264) wird nicht unterstützt — exportiert als WebM. ' +
                  'In VLC / Chrome / Firefox abspielbar; Windows Media Player nicht.',
                { duration: 8000 }
              );
            }
            triggerDownload(result.blob, result.ext);
            setExportState({ status: 'done', mode: 'offline' });
            setTimeout(
              () => setExportState({ status: 'idle', mode: 'offline' }),
              DONE_RESET_MS
            );
          } catch (e) {
            const err = e as Error & { name?: string };
            if (err?.name === 'AbortError') {
              setExportState({ status: 'idle', mode: 'offline' });
            } else {
              // eslint-disable-next-line no-console
              console.warn('[useVideoExporter] offline render failed:', err);
              setExportState({
                status: 'error',
                mode: 'offline',
                errorCode: 'render-failed'
              });
            }
          } finally {
            offlineAbortRef.current = null;
            // videoDecoderPool is owned by useVideoDecoderPool — NEVER
            // destroy here, the page-level hook handles its lifetime.
          }
        } else {
          // REALTIME PATH — Plan 6.
          setExportState({ mode: 'realtime' });
          await exporterRef.current?.start();
          try {
            await audioEngine?.play();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[useVideoExporter] audio play() failed:', err);
            exporterRef.current?.cancel();
          }
        }
      },
      cancel: () => {
        const state = useAppStore.getState().ui.exportState;
        if (state.mode === 'offline') {
          offlineAbortRef.current?.abort();
          // The renderOffline promise rejects with AbortError and the
          // try/catch above flips status back to idle.
        } else {
          exporterRef.current?.cancel();
        }
      }
    }),
    [audioEngine, getImageBitmap, videoEngine, videoDecoderPool, setExportState]
  );

  return api;
}
