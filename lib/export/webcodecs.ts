/**
 * Plan-6-R Task 3 — fix: WebCodecs feature detection + codec PAIR picker.
 *
 * Picks (video, audio, container) as a coherent pair. Walks a preference
 * list of complete pairs, in order:
 *   1. MP4: H.264 (Baseline 4.0 → Main 4.0 → High 4.0) + AAC LC
 *   2. WebM: VP9 profile 0 level 4.0 + Opus
 *
 * The first pair where BOTH video and audio configs return
 * `isConfigSupported.supported === true` wins. This guarantees we never
 * mux Opus into an MP4 container or AAC into a WebM container — both
 * the muxer libraries reject mismatched codecs at runtime.
 *
 * Returns null when (a) WebCodecs isn't available in this browser, or
 * (b) no preferred pair was accepted. Callers fall back to the realtime
 * MediaRecorder path in either case.
 *
 * Default video bitrate is 8 Mbit/s — up from the realtime path's
 * 6 Mbit/s. The realtime constraint is gone in offline mode, so we
 * spend a bit more on quality.
 */

// WebCodecs types ship in lib.dom on recent TypeScript versions. We
// cast loosely here to stay compatible with older toolchains that don't
// yet have VideoEncoderConfig / AudioEncoderConfig in lib.dom.

export interface VideoCodecPick {
  config: any;
  ext: 'mp4' | 'webm';
  label: string;
}

export interface AudioCodecPick {
  config: any;
  codec: 'mp4a.40.2' | 'opus';
  label: string;
}

export interface CodecPair {
  video: VideoCodecPick;
  audio: AudioCodecPick;
  ext: 'mp4' | 'webm';
  label: string;
}

/**
 * Container-aligned codec pairs. Iterate in priority order; first that
 * passes both encoder's `isConfigSupported` wins.
 */
interface PairPref {
  video: { codec: string; label: string };
  audio: { codec: 'mp4a.40.2' | 'opus'; label: string };
  ext: 'mp4' | 'webm';
  label: string;
}

const PAIR_PREFS: PairPref[] = [
  // 1. H.264 Baseline 4.0 + AAC LC — widest playback compat (iOS, WMP, every editor).
  {
    video: { codec: 'avc1.42E01E', label: 'H.264 Baseline 4.0' },
    audio: { codec: 'mp4a.40.2', label: 'AAC LC' },
    ext: 'mp4',
    label: 'MP4 (H.264 Baseline + AAC)'
  },
  // 2. H.264 Main 4.0 + AAC LC — some Chromium builds reject Baseline but accept Main.
  {
    video: { codec: 'avc1.4D401E', label: 'H.264 Main 4.0' },
    audio: { codec: 'mp4a.40.2', label: 'AAC LC' },
    ext: 'mp4',
    label: 'MP4 (H.264 Main + AAC)'
  },
  // 3. H.264 High 4.0 + AAC LC — last MP4 fallback before container switch.
  {
    video: { codec: 'avc1.640028', label: 'H.264 High 4.0' },
    audio: { codec: 'mp4a.40.2', label: 'AAC LC' },
    ext: 'mp4',
    label: 'MP4 (H.264 High + AAC)'
  },
  // 4. VP9 + Opus WebM — Firefox / Chromium-without-H.264 fallback.
  //    User has been warned that some media players (Windows Media Player)
  //    won't play this; VLC and modern browsers play it cleanly.
  {
    video: { codec: 'vp09.00.10.08', label: 'VP9 Profile 0 Level 4.0' },
    audio: { codec: 'opus', label: 'Opus' },
    ext: 'webm',
    label: 'WebM (VP9 + Opus) — Fallback'
  }
];

const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 128_000;

export function isWebCodecsSupported(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>).VideoEncoder !== 'undefined' &&
    typeof (globalThis as Record<string, unknown>).AudioEncoder !== 'undefined'
  );
}

interface PickOptions {
  /** Default true — set false in tests that pre-mock the encoders to avoid
   *  noisy "rejected" lines. */
  logRejections?: boolean;
}

/**
 * Returns the first complete (video, audio, container) pair that the
 * browser's WebCodecs implementation accepts. Logs each rejected
 * attempt to console.warn so the user can see in DevTools why their
 * preferred MP4 codec didn't make it.
 */
export async function pickCodecPair(
  width: number,
  height: number,
  fps: number,
  sampleRate: number,
  channels: number,
  opts: PickOptions = {}
): Promise<CodecPair | null> {
  if (!isWebCodecsSupported()) return null;
  const VideoEncoderCtor = (globalThis as Record<string, any>).VideoEncoder;
  const AudioEncoderCtor = (globalThis as Record<string, any>).AudioEncoder;
  const logRejections = opts.logRejections ?? true;

  for (const pref of PAIR_PREFS) {
    const videoConfig = {
      codec: pref.video.codec,
      width,
      height,
      framerate: fps,
      bitrate: VIDEO_BITRATE,
      bitrateMode: 'variable'
    };
    const audioConfig = {
      codec: pref.audio.codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: AUDIO_BITRATE
    };

    let videoOk = false;
    let videoResolved: any = videoConfig;
    try {
      const videoRes = await VideoEncoderCtor.isConfigSupported(videoConfig);
      videoOk = !!videoRes?.supported;
      videoResolved = videoRes?.config ?? videoConfig;
    } catch {
      videoOk = false;
    }
    if (!videoOk) {
      if (logRejections) {
        // eslint-disable-next-line no-console
        console.warn(
          `[export] rejected ${pref.label}: video codec ${pref.video.codec} unsupported`
        );
      }
      continue;
    }

    let audioOk = false;
    let audioResolved: any = audioConfig;
    try {
      const audioRes = await AudioEncoderCtor.isConfigSupported(audioConfig);
      audioOk = !!audioRes?.supported;
      audioResolved = audioRes?.config ?? audioConfig;
    } catch {
      audioOk = false;
    }
    if (!audioOk) {
      if (logRejections) {
        // eslint-disable-next-line no-console
        console.warn(
          `[export] rejected ${pref.label}: audio codec ${pref.audio.codec} unsupported`
        );
      }
      continue;
    }

    // Both accepted — this is our pair.
    // eslint-disable-next-line no-console
    console.info(`[export] picked ${pref.label}`);
    return {
      video: {
        config: videoResolved,
        ext: pref.ext,
        label: pref.video.label
      },
      audio: {
        config: audioResolved,
        codec: pref.audio.codec,
        label: pref.audio.label
      },
      ext: pref.ext,
      label: pref.label
    };
  }
  return null;
}

// Legacy independent pickers — kept for the unit tests in
// `tests/unit/export/webcodecs.test.ts` that exercise them directly.
// New code should use `pickCodecPair`.
export async function pickVideoEncoderConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoCodecPick | null> {
  if (!isWebCodecsSupported()) return null;
  const VideoEncoderCtor = (globalThis as Record<string, any>).VideoEncoder;
  for (const pref of PAIR_PREFS) {
    const config = {
      codec: pref.video.codec,
      width,
      height,
      framerate: fps,
      bitrate: VIDEO_BITRATE,
      bitrateMode: 'variable'
    };
    try {
      const res = await VideoEncoderCtor.isConfigSupported(config);
      if (res?.supported) {
        return {
          config: res.config ?? config,
          ext: pref.ext,
          label: pref.video.label
        };
      }
    } catch {
      // Continue.
    }
  }
  return null;
}

export async function pickAudioEncoderConfig(
  sampleRate: number,
  channels: number
): Promise<AudioCodecPick | null> {
  if (!isWebCodecsSupported()) return null;
  const AudioEncoderCtor = (globalThis as Record<string, any>).AudioEncoder;
  for (const codec of ['mp4a.40.2', 'opus'] as const) {
    const config = {
      codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: AUDIO_BITRATE
    };
    try {
      const res = await AudioEncoderCtor.isConfigSupported(config);
      if (res?.supported) {
        return {
          config: res.config ?? config,
          codec,
          label: codec === 'mp4a.40.2' ? 'AAC LC' : 'Opus'
        };
      }
    } catch {
      // Continue.
    }
  }
  return null;
}
