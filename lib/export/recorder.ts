import { isClient } from '@/lib/utils/is-client';
import { activeImageClips } from '@/lib/timeline/selectors';
import { pickCodec } from './codec';
import { makeFilename } from './filename';
import type { ExportState } from './types';
import type { AudioEngine } from '@/lib/audio/engine';
import type { TimelineState } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

const VIDEO_BITRATE = 6_000_000;
const AUDIO_BITRATE = 128_000;
const FRAME_RATE = 30;
const CHUNK_MS = 500;
const REVOKE_DELAY_MS = 10_000;
/** Reset to idle after the download is triggered. Lets the user see the
 *  "done" toast briefly without manually clearing state. */
const DONE_RESET_MS = 2_000;
/** Safety net poll interval — kicks in when the audio 'ended' event fails
 *  to fire (rare, but observed when the last 0.1 s of the clip is silent). */
const SAFETY_INTERVAL_MS = 200;

export interface VideoExporterDeps {
  canvas: HTMLCanvasElement;
  audioEngine: AudioEngine;
  /** Fresh-read getter — captured `timeline` would go stale between hook
   *  mount and export start. Same pattern as the renderer's getTimelineState. */
  getTimeline(): TimelineState;
  /** Fresh-read getter — captured `audioMediaRef` at hook mount time would
   *  always be null because the hook initialises BEFORE the user uploads
   *  any audio. Reading via the getter at start() picks up the latest. */
  getAudioMediaRef(): MediaRef | null;
  setExportState(patch: Partial<ExportState>): void;
}

export interface VideoExporter {
  start(): Promise<void>;
  cancel(): void;
}

export function createVideoExporter(deps: VideoExporterDeps): VideoExporter | null {
  if (!isClient()) return null;

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let safetyInterval: ReturnType<typeof setInterval> | null = null;
  let onEndedListener: (() => void) | null = null;
  let chosenMimeType = '';

  async function start(): Promise<void> {
    if (recorder) return; // already running

    // Pre-checks (Spec §8.1.1). Read via getters — never cache.
    const audioMediaRef = deps.getAudioMediaRef();
    if (!audioMediaRef) {
      deps.setExportState({ status: 'error', errorCode: 'no-audio' });
      return;
    }
    const imageClips = activeImageClips(deps.getTimeline(), 0);
    if (imageClips.length === 0) {
      deps.setExportState({ status: 'error', errorCode: 'no-image' });
      return;
    }
    const audioStream = deps.audioEngine.getAudioStream();
    if (!audioStream) {
      deps.setExportState({ status: 'error', errorCode: 'no-audio' });
      return;
    }

    deps.setExportState({ status: 'preparing' });

    const codec = pickCodec();
    chosenMimeType = codec.mimeType;
    if (!MediaRecorder.isTypeSupported(codec.mimeType)) {
      deps.setExportState({ status: 'error', errorCode: 'codec-unsupported' });
      return;
    }

    const videoStream = (deps.canvas as HTMLCanvasElement & {
      captureStream: (fps: number) => MediaStream;
    }).captureStream(FRAME_RATE);
    const videoTrack = videoStream.getVideoTracks()[0];
    const audioTrack = audioStream.getAudioTracks?.()[0];
    const combined = new MediaStream(
      [videoTrack, audioTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    );

    try {
      recorder = new MediaRecorder(combined, {
        mimeType: codec.mimeType,
        videoBitsPerSecond: VIDEO_BITRATE,
        audioBitsPerSecond: AUDIO_BITRATE
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[VideoExporter] MediaRecorder construction failed:', err);
      deps.setExportState({ status: 'error', errorCode: 'recorder-failed' });
      return;
    }

    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      // Tear down both stop triggers — whichever didn't fire yet would
      // otherwise try to call stop() on an already-stopped recorder.
      if (safetyInterval) {
        clearInterval(safetyInterval);
        safetyInterval = null;
      }
      const audioElForCleanup = deps.audioEngine.getAudioElement();
      if (audioElForCleanup && onEndedListener) {
        audioElForCleanup.removeEventListener('ended', onEndedListener);
        onEndedListener = null;
      }

      deps.setExportState({ status: 'finalizing' });

      const blob = new Blob(chunks, { type: chosenMimeType });
      chunks = [];
      const url = URL.createObjectURL(blob);
      const filename = makeFilename();
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // 10 s delay — Spec §8.1.7 — give the browser time to start the
      // download. Some Chromium versions abort the download if the URL
      // is revoked before the save-dialog opens.
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);

      deps.setExportState({ status: 'done' });
      // Auto-reset to idle so the next export can start cleanly.
      setTimeout(() => deps.setExportState({ status: 'idle' }), DONE_RESET_MS);
      recorder = null;
    };

    // Primary stop trigger: audio element 'ended' event.
    const audioEl = deps.audioEngine.getAudioElement();
    if (audioEl) {
      onEndedListener = () => {
        if (recorder && recorder.state === 'recording') recorder.stop();
      };
      audioEl.addEventListener('ended', onEndedListener, { once: true });
    }

    // Safety net: poll currentTime in case 'ended' fails to fire (e.g. last
    // 0.1 s of the clip is digital silence so the decoder reports ended early).
    safetyInterval = setInterval(() => {
      const el = deps.audioEngine.getAudioElement();
      if (!el) return;
      if (el.currentTime >= (el.duration ?? Infinity) - 0.1) {
        if (recorder && recorder.state === 'recording') recorder.stop();
      }
    }, SAFETY_INTERVAL_MS);

    deps.setExportState({
      status: 'recording',
      totalSeconds: audioMediaRef.duration ?? 0,
      elapsedSeconds: 0,
      codecLabel: codec.label
    });

    recorder.start(CHUNK_MS);
  }

  function cancel(): void {
    // Full cancel wiring lands in Task 7. Stub here so the API is complete.
    if (safetyInterval) {
      clearInterval(safetyInterval);
      safetyInterval = null;
    }
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch {
        /* ignore — already stopped */
      }
    }
    recorder = null;
    chunks = [];
    onEndedListener = null;
    deps.setExportState({ status: 'idle' });
  }

  // Internal constants — exposed only for future stop/cancel tasks that
  // need them. (Marked as non-public via the leading underscore in the
  // re-export below.)
  return { start, cancel };
}

// Re-export the constants so Task 6 / Task 7 can reference them without
// duplicating the values. Kept package-internal — not exported from
// `lib/export/index.ts`.
export const _EXPORT_CONSTANTS = {
  VIDEO_BITRATE,
  AUDIO_BITRATE,
  FRAME_RATE,
  CHUNK_MS,
  REVOKE_DELAY_MS,
  DONE_RESET_MS,
  SAFETY_INTERVAL_MS
} as const;
