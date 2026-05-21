import { makeOfflineRenderer } from '@/lib/renderer/offline-tick';
import { pickVideoEncoderConfig, pickAudioEncoderConfig } from './webcodecs';
import { chunkAudioBuffer } from './audio-chunks';
import { createOfflineMuxer } from './muxer';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

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
  audioBuffer: AudioBuffer;
  getImageBitmap: (mediaId: string) => ImageBitmap | undefined;
  flowMode: boolean;
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
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const fps = options.fps ?? DEFAULTS.fps;
  const durationSec = deps.audioBuffer.duration;
  const totalFrames = Math.ceil(durationSec * fps);

  // 1. Pick codecs.
  const videoPick = await pickVideoEncoderConfig(width, height, fps);
  if (!videoPick) throw new Error('No supported video codec');
  const audioPick = await pickAudioEncoderConfig(
    deps.audioBuffer.sampleRate,
    deps.audioBuffer.numberOfChannels
  );
  if (!audioPick) throw new Error('No supported audio codec');

  // 2. Render target — fresh OffscreenCanvas at the export resolution.
  const canvas = new OffscreenCanvas(width, height);
  const offlineRenderer = makeOfflineRenderer({
    canvas,
    beatGrid: deps.beatGrid,
    timeline: deps.timeline,
    getImageBitmap: deps.getImageBitmap,
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
    sampleRate: deps.audioBuffer.sampleRate,
    channels: deps.audioBuffer.numberOfChannels
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
  audioEncoder.configure(audioPick.config);

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

  // 5. Frame loop.
  const startTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    throwIfAborted();
    throwIfVideo();
    const timeSec = frameIdx / fps;
    offlineRenderer.renderAt(timeSec);

    while (videoEncoder.encodeQueueSize > BACKPRESSURE_QUEUE_HIGH) {
      await new Promise<void>((r) => setTimeout(r, 0));
      throwIfAborted();
      throwIfVideo();
    }

    const videoFrame = new VideoFrameCtor(canvas, {
      timestamp: Math.round(timeSec * 1_000_000)
    });
    videoEncoder.encode(videoFrame, { keyFrame: frameIdx % fps === 0 });
    videoFrame.close();

    if (options.onProgress) {
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = now - startTime;
      const fractionDone = (frameIdx + 1) / totalFrames;
      const etaSeconds =
        fractionDone > 0
          ? Math.max(
              0,
              Math.round(((elapsedMs / fractionDone) * (1 - fractionDone)) / 1000)
            )
          : 0;
      options.onProgress({
        currentFrame: frameIdx + 1,
        totalFrames,
        etaSeconds
      });
    }
  }
  await videoEncoder.flush();
  throwIfVideo();

  // 6. Audio loop.
  for (const chunk of chunkAudioBuffer(deps.audioBuffer)) {
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
      sampleRate: deps.audioBuffer.sampleRate,
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
  const mime = videoPick.ext === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([bytes], { type: mime });
  return { blob, ext: videoPick.ext, codecLabel: videoPick.label };
}
