/**
 * Plan-6-R Task 3: WebCodecs feature detection + codec preference picker.
 *
 * Returns null when (a) WebCodecs isn't available in this browser
 * (Firefox < ~130, older Safari) or (b) no preferred codec config was
 * accepted by `isConfigSupported`. Callers fall back to the realtime
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

const VIDEO_PREFS: Array<{ codec: string; ext: 'mp4' | 'webm'; label: string }> = [
  // H.264 baseline profile, level 4.0 — accepts up to 1080p / 30 fps.
  // Widest playback compat across desktop, mobile, and most editors.
  { codec: 'avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264 Baseline + AAC)' },
  // VP9 profile 0, level 4.0 — Firefox + WebM fallback.
  { codec: 'vp09.00.10.08', ext: 'webm', label: 'WebM (VP9 + Opus)' }
];

const AUDIO_PREFS: Array<{ codec: 'mp4a.40.2' | 'opus'; label: string }> = [
  { codec: 'mp4a.40.2', label: 'AAC LC' },
  { codec: 'opus', label: 'Opus' }
];

const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 128_000;

export function isWebCodecsSupported(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>).VideoEncoder !== 'undefined' &&
    typeof (globalThis as Record<string, unknown>).AudioEncoder !== 'undefined'
  );
}

export async function pickVideoEncoderConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoCodecPick | null> {
  if (!isWebCodecsSupported()) return null;
  const VideoEncoderCtor = (globalThis as Record<string, any>).VideoEncoder;
  for (const pref of VIDEO_PREFS) {
    const config = {
      codec: pref.codec,
      width,
      height,
      framerate: fps,
      bitrate: VIDEO_BITRATE,
      bitrateMode: 'variable'
    };
    try {
      const res = await VideoEncoderCtor.isConfigSupported(config);
      if (res?.supported) {
        return { config: res.config ?? config, ext: pref.ext, label: pref.label };
      }
    } catch {
      // Continue to the next preference — some browsers throw on unknown codecs.
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
  for (const pref of AUDIO_PREFS) {
    const config = {
      codec: pref.codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: AUDIO_BITRATE
    };
    try {
      const res = await AudioEncoderCtor.isConfigSupported(config);
      if (res?.supported) {
        return { config: res.config ?? config, codec: pref.codec, label: pref.label };
      }
    } catch {
      // Continue.
    }
  }
  return null;
}
