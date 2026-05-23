'use client';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { createVideoExporter, type VideoExporter } from '@/lib/export/recorder';
import { isWebCodecsSupported } from '@/lib/export/webcodecs';
import { renderOffline } from '@/lib/export/offline-render';
import { makeFilename } from '@/lib/export/filename';
import { hasVisualClipAt } from '@/lib/timeline/selectors';
import { createVideoDecoderPool } from '@/lib/video/decoder-pool';
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
  videoEngine
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
                audioEnabled
              };
            })
            .filter((vc) => vc.url !== '');

          const fps = 30;
          const audioDurationSec = audioBuffer.duration;
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

          // Plan 5.10+ — build a VideoDecoderPool for the export and
          // pre-load every referenced video. Replaces the previous
          // HTMLVideoElement-seek-and-draw pipeline (which broke on
          // modern Chromium because the 1px DOM-attached <video>
          // wasn't painted by the compositor → drawImage read stale
          // frame 0 forever). The pool reads raw MP4 binary, demuxes
          // via mp4box.js, and feeds encoded chunks to a WebCodecs
          // VideoDecoder — no DOM, no compositor, deterministic.
          //
          // Falls back gracefully (decoderPool stays null) when
          // WebCodecs is unavailable; offline-render then renders
          // black for video clips. On the codec/MP4 fetch failure
          // path we toast and degrade: an export with frozen video
          // is still better than no export at all.
          const decoderPool = createVideoDecoderPool();
          const videoMediaIds = Array.from(
            new Set(
              timeline.clips
                .filter((c) => c.kind === 'video' && typeof c.mediaId === 'string')
                .map((c) => c.mediaId as string)
            )
          );
          if (decoderPool && videoMediaIds.length > 0) {
            const loadResults = await Promise.allSettled(
              videoMediaIds.map((id) => {
                const ref = mediaRefs.find((m) => m.id === id);
                if (!ref?.url) return Promise.reject(new Error(`no url for ${id}`));
                return decoderPool.load(id, ref.url);
              })
            );
            const failed = loadResults.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
              // eslint-disable-next-line no-console
              console.warn(
                '[useVideoExporter] decoder pre-load failed for some videos:',
                failed
              );
              toast.warning(
                `${failed.length} Video(s) konnten für den Export nicht decodiert werden — diese erscheinen schwarz.`
              );
            }
          }

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
                // Plan 5.10+ — DecoderPool replaces videoEngine for the
                // offline frame source. videoEngine is still passed for
                // backwards-compat (the seekAllTo path), but the renderer
                // will prefer getVideoFrame when available.
                videoEngine,
                getVideoElement: videoEngine
                  ? (mediaId: string) => videoEngine.getElement(mediaId)
                  : undefined,
                videoDecoderPool: decoderPool,
                flowMode: useAppStore.getState().ui.flowMode
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
            decoderPool?.destroy();
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
            // Belt-and-suspenders: decoderPool.destroy() in the success
            // path runs before this finally, but errors / aborts must
            // also release the decoded VideoFrames + decoder instances.
            // destroy() is idempotent.
            decoderPool?.destroy();
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
    [audioEngine, getImageBitmap, videoEngine, setExportState]
  );

  return api;
}
