import { makeOfflineRenderer } from '@/lib/renderer/offline-tick';
import { pickCodecPair } from './webcodecs';
import { chunkAudioBuffer } from './audio-chunks';
import { createOfflineMuxer } from './muxer';
import { mixAudioOffline, type VideoAudioClip } from './mix-audio-offline';
import type { Clip, TimelineState } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { ExportRange } from '@/lib/store/types';
import { qualityManager } from '@/lib/renderer/webgl/quality';

// WebCodecs types (VideoEncoder, AudioEncoder, VideoFrame, AudioData)
// ship in lib.dom on recent TypeScript versions but we cast loosely here
// to stay compatible with older toolchains. Tests stub the globals.
// eslint rule for no-explicit-any isn't configured in this project's
// next/core-web-vitals preset, so we use unknown-casts where possible.

export interface OfflineRenderProgress {
  currentFrame: number;
  totalFrames: number;
  /** Rolling estimate of seconds remaining based on average frame time
   *  so far. Fluctuates in the first second of rendering. */
  etaSeconds: number;
}

export interface OfflineRenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (p: OfflineRenderProgress) => void;
  signal?: AbortSignal;
}

export interface OfflineRenderDeps {
  timeline: TimelineState;
  beatGrid: BeatGrid;
  /** Plan 5.9d — replaced the single `audioBuffer` field. The
   *  orchestrator now mixes all audio clips (and audio-enabled video
   *  clips) via `mixAudioOffline` into a single AudioBuffer before
   *  the audio loop. */
  audioClips: Clip[];
  videoAudioClips: VideoAudioClip[];
  mediaRefs: MediaRef[];
  bpm: number;
  /** Audio duration in seconds — used to size the OfflineAudioContext
   *  mix-bus and to compute totalFrames for the video loop. The
   *  caller derives this from the longest audio source (typically
   *  the global soundtrack via `audioEngine.getDecodedBuffer()`) or
   *  from the last audio-clip's end. */
  audioDurationSec: number;
  /** Audio sample rate + channel count for codec selection. Matches
   *  what `mixAudioOffline` produces (48 kHz / 2 ch). */
  sampleRate: number;
  numberOfChannels: number;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  flowMode: boolean;
  /**
   * Plan 9d Task 3 — export range override. When set, only the time window
   * [start, end] (seconds, absolute) is rendered. Frames are sampled at their
   * ABSOLUTE timeline time so beat phase, automation, and FX are identical to
   * a full-project export at that moment. Output VideoFrame timestamps are
   * range-relative (first frame → 0). `null` = full timeline (no-op baseline).
   */
  exportRange?: ExportRange | null;
  /** Plan-5.9b legacy: HTMLVideoElement-based seek pipeline. Kept for
   *  back-compat / fallback when WebCodecs VideoDecoder is unavailable
   *  (older browsers, jsdom tests). When `videoDecoderPool` is also
   *  provided, the renderer prefers the pool's deterministic frame
   *  output and skips the HTMLVideoElement seek per frame. */
  videoEngine?: import('@/lib/video/engine').VideoEngine | null;
  /** Plan-5.9b legacy: HTMLVideoElement accessor for the renderer's
   *  draw step. Ignored when `videoDecoderPool` is set. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
  /** Plan-5.10+ replacement for the HTMLVideoElement pipeline. When
   *  set: per frame the orchestrator calls `getFrameAt(mediaId,
   *  timeSec)` on the pool and the renderer draws the returned
   *  VideoFrame directly. mp4box + WebCodecs VideoDecoder — no DOM,
   *  no compositor, deterministic. Eliminates the "video frozen on
   *  first frame in MP4" smoke bug that the HTMLVideoElement path
   *  exhibited on modern Chromium. */
  videoDecoderPool?: import('@/lib/video/decoder-pool').VideoDecoderPool | null;
}

export interface OfflineRenderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  codecLabel: string;
}

const DEFAULTS = { width: 1920, height: 1080, fps: 30 } as const;

/** Pause length when the encoder is more than QUEUE_HIGH chunks behind. */
const BACKPRESSURE_QUEUE_HIGH = 4;

/**
 * Plan-6-R Task 8: orchestrate one offline render.
 *
 * Sets up an OffscreenCanvas, picks codecs, builds the muxer +
 * VideoEncoder + AudioEncoder, runs the frame loop (one synchronous
 * render per output frame → one VideoFrame → encoder.encode()), then
 * walks the audio buffer chunk-by-chunk into the AudioEncoder.
 * Finalises the muxer and returns a Blob.
 *
 * Encoder errors are captured into a shared flag (Bug-1 fix per
 * architect feedback — `throw` inside the encoder's error callback
 * lands in a microtask and becomes an unhandled rejection that the
 * orchestrator never sees). The flag is checked synchronously at every
 * backpressure checkpoint so the surrounding promise rejects cleanly.
 *
 * Cancel: caller passes `options.signal`. The frame loop checks
 * `aborted` between every frame; backpressure loops also exit early.
 * On abort we don't bother finalising the muxer — the caller drops
 * the partial output.
 */
export async function renderOffline(
  deps: OfflineRenderDeps,
  options: OfflineRenderOptions = {}
): Promise<OfflineRenderResult> {
  // Plan 8f.1 — Freeze the WebGL quality manager at scale=1.0 for the
  // duration of the export. Without this, the per-frame export tick rate
  // (decoupled from the 60fps display) would be interpreted as an FPS
  // signal and trigger spurious scale-downs mid-export. try/finally
  // guarantees the manager unfreezes even if encoding throws.
  qualityManager.setOffline(true);
  try {
    return await renderOfflineInternal(deps, options);
  } finally {
    qualityManager.setOffline(false);
  }
}

async function renderOfflineInternal(
  deps: OfflineRenderDeps,
  options: OfflineRenderOptions
): Promise<OfflineRenderResult> {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const fps = options.fps ?? DEFAULTS.fps;
  const durationSec = deps.audioDurationSec;
  const totalFrames = Math.ceil(durationSec * fps);

  // Plan 5.9d — mix all audio sources (audio clips + audio-enabled
  // video clips) into one AudioBuffer. The OfflineAudioContext bus
  // bakes per-clip volume automation as `setValueAtTime` events on a
  // 0.1-beat raster; peak-normalises to 0.95 if the sum exceeded 1.0.
  // Result feeds the existing `chunkAudioBuffer` → AudioEncoder
  // pipeline unchanged.
  const mixedBuffer = await mixAudioOffline(
    deps.audioClips,
    deps.mediaRefs,
    deps.bpm,
    durationSec,
    deps.videoAudioClips
  );

  // 1. Pick a codec PAIR (video + audio + container) — never independent.
  //    Independent picks would let us mux Opus into an MP4 container or
  //    AAC into a WebM container; both libraries reject the mismatch and
  //    we'd get a corrupted file. `pickCodecPair` walks preference order
  //    MP4 (Baseline → Main → High) → WebM and only returns a pair when
  //    both video and audio are accepted together.
  const pair = await pickCodecPair(
    width,
    height,
    fps,
    deps.sampleRate,
    deps.numberOfChannels
  );
  if (!pair) throw new Error('No supported codec pair');
  const videoPick = pair.video;
  const audioPick = pair.audio;

  // 2. Render target — fresh OffscreenCanvas at the export resolution.
  const canvas = new OffscreenCanvas(width, height);
  const offlineRenderer = makeOfflineRenderer({
    canvas,
    beatGrid: deps.beatGrid,
    timeline: deps.timeline,
    getImageBitmap: deps.getImageBitmap,
    getVideoElement: deps.getVideoElement,
    flowMode: deps.flowMode
  });

  // 3. Muxer — picks mp4-muxer or webm-muxer based on the chosen ext.
  const muxer = createOfflineMuxer({
    ext: videoPick.ext,
    videoCodec: videoPick.config.codec,
    audioCodec: audioPick.codec,
    width,
    height,
    fps,
    sampleRate: deps.sampleRate,
    channels: deps.numberOfChannels
  });

  // 4. Encoders — architect-flagged Bug 1: never `throw` inside the
  //    error callback (lands in a stray microtask); capture into a
  //    flag and re-throw at the next loop checkpoint.
  let videoError: Error | null = null;
  let audioError: Error | null = null;

  const VideoEncoderCtor = (globalThis as any).VideoEncoder;
  const AudioEncoderCtor = (globalThis as any).AudioEncoder;
  const VideoFrameCtor = (globalThis as any).VideoFrame;
  const AudioDataCtor = (globalThis as any).AudioData;

  const videoEncoder = new VideoEncoderCtor({
    output: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata) =>
      muxer.addVideoChunk(chunk, meta),
    error: (e: Error) => {
      videoError = e;
    }
  });
  videoEncoder.configure(videoPick.config);

  const audioEncoder = new AudioEncoderCtor({
    output: (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) =>
      muxer.addAudioChunk(chunk, meta),
    error: (e: Error) => {
      audioError = e;
    }
  });
  // NOTE: audioEncoder.configure() is deferred until just before the
  // audio loop. Chrome's WebCodecs implementation reclaims an
  // unused-but-configured encoder after ~10s of inactivity with
  // `QuotaExceededError: Codec reclaimed due to inactivity`. With
  // video clips the frame loop spends 5-15× realtime on seeks (see
  // KNOWN_LIMITATIONS), which easily exceeds that window. Holding off
  // on configure keeps the audio encoder dormant during the video
  // loop and avoids the reclaim.

  function throwIfVideo(): void {
    if (videoError) throw videoError;
  }
  function throwIfAudio(): void {
    if (audioError) throw audioError;
  }
  function throwIfAborted(): void {
    if (options.signal?.aborted) {
      throw new DOMException('Offline render aborted', 'AbortError');
    }
  }

  // 4b. DOM-attach the video elements for the duration of the render.
  //
  // `VideoEngine` creates `<video>` with `document.createElement` and
  // never appends them. For LIVE preview this is fine — `play()` keeps
  // the decoder pipeline pumping new frames into the element's frame
  // buffer regardless of attachment, and `drawImage` reads from that
  // buffer.
  //
  // For OFFLINE export we don't play, we SEEK once per output frame and
  // then `drawImage`. On a detached element, Chrome's compositor never
  // schedules a paint, so:
  //   - `requestVideoFrameCallback` never fires (it's gated on paint).
  //   - The decoder is throttled / lazy — the new frame at `currentTime`
  //     may not be in the drawable buffer when `drawImage` runs, even
  //     after `seeked` fires + a one-rAF defer.
  // Net symptom: the encoded MP4 freezes on frame 0 of every video clip
  // while FX overlays animate normally.
  //
  // Fix: park the elements in a 1px, low-opacity container inside
  // document.body for the lifetime of the render. The compositor now
  // treats them as visible (not display:none / not visibility:hidden),
  // rVFC fires per seek, and the decoder pipeline stays hot. Removed
  // again in `finally` so the live preview returns to its original
  // detached state.
  // Plan 5.10+ — DOM-attach of HTMLVideoElement pool is only needed
  // for the legacy `videoEngine` seek-and-draw path. When a
  // VideoDecoderPool is provided, the pool reads MP4 binary + decodes
  // via WebCodecs without any DOM involvement, so we skip the DOM
  // attach entirely. Live preview's video pool is unaffected.
  let videoDomContainer: HTMLDivElement | null = null;
  if (
    deps.videoEngine &&
    !deps.videoDecoderPool &&
    typeof document !== 'undefined'
  ) {
    const ids = deps.videoEngine.loadedIds();
    if (ids.length > 0) {
      videoDomContainer = document.createElement('div');
      videoDomContainer.setAttribute('data-vibegrid-export-video-pool', '');
      // Visible to compositor (1px in corner, default opacity), not the
      // opacity:0.001 hack that modern Chromium optimised away.
      videoDomContainer.style.cssText =
        'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
      for (const id of ids) {
        const el = deps.videoEngine.getElement(id);
        if (!el) continue;
        el.style.width = '1px';
        el.style.height = '1px';
        videoDomContainer.appendChild(el);
      }
      document.body.appendChild(videoDomContainer);
    }
  }

  try {
  // 5. Frame loop.
  // Plan 9d Task 3 — export range bounds. When exportRange is active, only
  // frames in [startFrame, endFrame) are emitted. Sampling time stays ABSOLUTE
  // so beat phase, automation, and FX are identical to a full-project export.
  // Output VideoFrame timestamps are range-relative (first frame → 0 µs).
  // No range (null / undefined) → full-project baseline, true no-op.
  const rangeStartFrame = deps.exportRange
    ? Math.round(deps.exportRange.start * fps)
    : 0;
  const rangeEndFrame = deps.exportRange
    ? Math.round(deps.exportRange.end * fps)
    : totalFrames;

  const startTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loopTotalFrames = rangeEndFrame - rangeStartFrame;

  for (let f = rangeStartFrame; f < rangeEndFrame; f++) {
    const frameIdx = f; // absolute frame index (for stall-stage diagnostics + keyframe logic)
    const outputFrameIdx = f - rangeStartFrame; // range-relative output index (0-based)
    throwIfAborted();
    throwIfVideo();
    const timeSec = f / fps; // ABSOLUTE time — never range-relative

    // Plan 5.10+ — video frame sourcing.
    //
    // PREFERRED path: VideoDecoderPool (mp4box + WebCodecs). Fetch the
    // decoded VideoFrame for each active video clip's mediaId at this
    // timestamp. Frames are pool-owned (sliding cache); we pass them
    // to renderAt which draws them synchronously, then loops to the
    // next frame.
    //
    // FALLBACK path: videoEngine.seekAllTo (HTMLVideoElement seek-and-
    // draw). Kept for browsers without WebCodecs; fragile but
    // functional when working.
    //
    // Projects without video skip both paths.
    // Per-frame hard timeout. The error message names the EXACT stage
    // we got stuck in so we can diagnose without per-frame logging.
    // Stages: 'fetch-video' (pool.getFrameAt or seekAllTo) /
    // 'render' (sync canvas draw) / 'backpressure' (encoder queue) /
    // 'encode' (new VideoFrame + encoder.encode). Each is updated
    // synchronously before its await.
    const FRAME_HARD_TIMEOUT_MS = 10_000;
    let stallStage = 'init';
    let frameTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const frameTimeout = new Promise<never>((_, reject) => {
      frameTimeoutId = setTimeout(() => {
        // Snapshot diagnostic state at the moment of timeout.
        const encoderState = videoEncoder.state;
        const encoderQueueLen = videoEncoder.encodeQueueSize;
        const poolReport = deps.videoDecoderPool
          ? deps.videoDecoderPool
              .loadedIds()
              .map((id) => `${id.slice(0, 8)}=loaded`)
              .join(',')
          : 'no-pool';
        reject(
          new Error(
            `Frame ${frameIdx} stalled at stage="${stallStage}" for >${FRAME_HARD_TIMEOUT_MS}ms ` +
              `(encoder.state=${encoderState} encoder.queueSize=${encoderQueueLen} pool=[${poolReport}])`
          )
        );
      }, FRAME_HARD_TIMEOUT_MS);
    });

    const renderOneFrame = async (): Promise<void> => {
      let videoFrames: Map<string, VideoFrame> | undefined;
      if (deps.videoDecoderPool) {
        const beats =
          ((timeSec - deps.beatGrid.offsetMs / 1000) * deps.beatGrid.bpm) / 60;
        // SOURCE-RELATIVE time per clip — NOT the global timeSec.
        // sourceTime = (globalTime - clipStartTime) + clipSourceInPoint
        //
        // - clipStartTime accounts for clips that don't start at beat 0
        //   (otherwise the decoder would seek to frame `globalTime` in
        //   the source, which is wrong for any clip with startBeat > 0).
        // - sourceInPoint (optional, default 0) supports the future
          //   trim feature: clip plays from offset N seconds within the
        //   source. Stored on clip.params.sourceInPointSec. No UI yet,
        //   but the pipeline reads it so the trim feature can ship by
        //   just wiring up an Inspector slider.
        //
        // Map keyed by mediaId — multiple clips of the same media at
        // overlapping times would collide (only one wins). v0.1
        // limitation: dropping the same video onto two tracks at the
        // same time isn't a real workflow yet.
        const requests: Array<{ mediaId: string; sourceTime: number }> = [];
        for (const clip of deps.timeline.clips) {
          if (clip.kind !== 'video' || typeof clip.mediaId !== 'string') continue;
          if (clip.startBeat <= beats && beats < clip.startBeat + clip.lengthBeats) {
            const clipStartSec =
              (clip.startBeat * 60) / deps.beatGrid.bpm +
              deps.beatGrid.offsetMs / 1000;
            const sourceInPointSec =
              (clip.params as { sourceInPointSec?: number } | undefined)
                ?.sourceInPointSec ?? 0;
            const sourceTime = timeSec - clipStartSec + sourceInPointSec;
            requests.push({ mediaId: clip.mediaId, sourceTime });
          }
        }
        if (requests.length > 0) {
          videoFrames = new Map();
          stallStage = `fetch-video pool [${requests.map((r) => r.mediaId.slice(0, 8)).join(',')}]`;
          const frames = await Promise.all(
            requests.map((r) =>
              deps.videoDecoderPool!.getFrameAt(r.mediaId, r.sourceTime)
            )
          );
          for (let i = 0; i < requests.length; i++) {
            const f = frames[i];
            if (f) videoFrames.set(requests[i].mediaId, f);
          }
        }
        throwIfAborted();
        throwIfVideo();
      } else if (deps.videoEngine) {
        stallStage = 'fetch-video engine.seekAllTo';
        await deps.videoEngine.seekAllTo(timeSec);
        throwIfAborted();
        throwIfVideo();
      }

      stallStage = 'render';
      offlineRenderer.renderAt(timeSec, videoFrames);

      stallStage = 'backpressure';
      let backpressureWaits = 0;
      while (videoEncoder.encodeQueueSize > BACKPRESSURE_QUEUE_HIGH) {
        await new Promise<void>((r) => setTimeout(r, 0));
        throwIfAborted();
        throwIfVideo();
        backpressureWaits++;
      }
      if (backpressureWaits > 1000 && frameIdx % 100 === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[offline-render] frame ${frameIdx}: encoder backpressure ${backpressureWaits} wait cycles (encodeQueueSize=${videoEncoder.encodeQueueSize})`
        );
      }
      stallStage = 'done';
    };

    try {
      await Promise.race([renderOneFrame(), frameTimeout]);
    } finally {
      if (frameTimeoutId !== undefined) clearTimeout(frameTimeoutId);
    }

    // Plan 9d Task 3: timestamp is range-relative (output starts at t=0).
    // outputFrameIdx=0 → timestamp 0; outputFrameIdx=N → N * (1_000_000/fps) µs.
    const videoFrame = new VideoFrameCtor(canvas, {
      timestamp: Math.round(outputFrameIdx * (1_000_000 / fps))
    });
    // Keyframe cadence is relative to the output stream (not absolute timeline).
    videoEncoder.encode(videoFrame, { keyFrame: outputFrameIdx % fps === 0 });
    videoFrame.close();

    if (options.onProgress) {
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = now - startTime;
      const fractionDone = (outputFrameIdx + 1) / loopTotalFrames;
      const etaSeconds =
        fractionDone > 0
          ? Math.max(
              0,
              Math.round(((elapsedMs / fractionDone) * (1 - fractionDone)) / 1000)
            )
          : 0;
      options.onProgress({
        currentFrame: outputFrameIdx + 1,
        totalFrames: loopTotalFrames,
        etaSeconds
      });
    }
  }
  await videoEncoder.flush();
  throwIfVideo();

  // 6. Audio loop. Configure the encoder NOW — see the note at its
  //    construction for why this isn't done upfront.
  audioEncoder.configure(audioPick.config);
  for (const chunk of chunkAudioBuffer(mixedBuffer)) {
    throwIfAborted();
    throwIfAudio();

    while (audioEncoder.encodeQueueSize > BACKPRESSURE_QUEUE_HIGH) {
      await new Promise<void>((r) => setTimeout(r, 0));
      throwIfAborted();
      throwIfAudio();
    }

    // Build an AudioData. WebCodecs accepts interleaved f32 — convert
    // from the per-channel planar Float32Arrays the chunker yields.
    const interleaved = new Float32Array(chunk.frameCount * chunk.channels.length);
    for (let f = 0; f < chunk.frameCount; f++) {
      for (let c = 0; c < chunk.channels.length; c++) {
        interleaved[f * chunk.channels.length + c] = chunk.channels[c][f];
      }
    }
    const audioData = new AudioDataCtor({
      format: 'f32',
      sampleRate: deps.sampleRate,
      numberOfFrames: chunk.frameCount,
      numberOfChannels: chunk.channels.length,
      timestamp: chunk.timestampUs,
      data: interleaved
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }
  await audioEncoder.flush();
  throwIfAudio();

  // 7. Finalise.
  const bytes = muxer.finalize();
  const mime = pair.ext === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([bytes], { type: mime });
  return { blob, ext: pair.ext, codecLabel: pair.label };
  } finally {
    // Return video elements to their original detached state so the
    // live preview path keeps owning them as before. Removing the
    // container detaches every child element in one DOM mutation.
    if (videoDomContainer && videoDomContainer.parentNode) {
      videoDomContainer.parentNode.removeChild(videoDomContainer);
    }
  }
}
