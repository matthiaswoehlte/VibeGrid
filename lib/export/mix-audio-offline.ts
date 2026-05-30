import { resolveParam } from '@/lib/automation/resolve';
import type { Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';
import type { StaticOrAuto } from '@/lib/automation/types';

/**
 * Plan 5.9d — offline mixdown for the export pipeline.
 *
 * Single `OfflineAudioContext` as a mix bus. Each audio clip becomes
 * a `BufferSource → GainNode → destination`; volume automation is
 * baked into the GainNode via `setValueAtTime` on a 0.1-beat raster.
 * Video clips with `audioEnabled` get their embedded audio extracted
 * via `decodeAudioData` (no GainNode — v0.1 has no volume control on
 * video audio).
 *
 * After `startRendering()`, the summed peak is checked; if it
 * exceeded 1.0, the buffer is normalised to 0.95 peak to prevent
 * hard clipping. Loudness-targeting (LUFS) is out of scope for v0.1
 * and documented in KNOWN_LIMITATIONS.
 *
 * The result is a single AudioBuffer ready for the existing
 * WebCodecs `AudioEncoder` chunker (`chunkAudioBuffer` consumes it
 * unchanged).
 */

/** Sample rate for the offline mix. 48 kHz is the WAV/MP4 standard
 *  and matches what the WebCodecs AudioEncoder expects downstream.
 *  Some older Android browsers only support 44.1 kHz in
 *  OfflineAudioContext and throw NotSupportedError here; that's
 *  out-of-scope for the Vercel/desktop v0.1 target and noted in
 *  KNOWN_LIMITATIONS. */
const EXPORT_SAMPLE_RATE = 48_000;

/** Volume automation raster — every 0.1 beats we emit a
 *  `setValueAtTime`. Fine enough for audibly-smooth slow ramps,
 *  coarse enough that long clips don't accumulate thousands of
 *  scheduled events. Sub-0.1-beat volume stabs get quantised
 *  (documented in KNOWN_LIMITATIONS). */
const VOLUME_AUTOMATION_STEP_BEATS = 0.1;

/** Peak ceiling for post-render normalisation. Headroom below 1.0
 *  to prevent hard digital clipping when downstream encoders apply
 *  their own dithering / re-sampling. */
const PEAK_NORMALIZE_TARGET = 0.95;

export interface VideoAudioClip {
  url: string;
  startBeat: number;
  /** Timeline length of the video clip in beats. Required so the video-audio
   *  path can apply the same symmetric window guard as the audio-clip path:
   *  clips whose end falls before rangeStart are skipped without fetching. */
  lengthBeats: number;
  audioEnabled: boolean;
}

export async function mixAudioOffline(
  audioClips: Clip[],
  mediaRefs: MediaRef[],
  bpm: number,
  totalDurationSec: number,
  videoAudioClips: VideoAudioClip[] = [],
  exportRange?: { start: number; end: number } | null
): Promise<AudioBuffer> {
  // Plan 9d Task 4 — audio windowing (W1).
  // When an export range is active, the OfflineAudioContext covers only the
  // window [rangeStart, rangeEnd]. Clips scheduled relative to this window
  // use the W1 split to avoid negative `when` in source.start().
  const rangeActive = exportRange != null;
  const rangeStartSec = rangeActive ? exportRange!.start : 0;
  const rangeEndSec = rangeActive ? exportRange!.end : totalDurationSec;
  const windowDurationSec = rangeEndSec - rangeStartSec;

  const totalSamples = Math.max(1, Math.ceil(windowDurationSec * EXPORT_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(2, totalSamples, EXPORT_SAMPLE_RATE);

  // Audio clips — each gets its own GainNode for volume automation.
  for (const clip of audioClips) {
    const ref = mediaRefs.find((m) => m.id === clip.mediaId);
    if (!ref) continue;
    const arrayBuffer = await fetch(ref.url).then((r) => r.arrayBuffer());
    let buffer: AudioBuffer;
    try {
      buffer = await offlineCtx.decodeAudioData(arrayBuffer);
    } catch {
      // Codec the browser refuses — skip silently.
      continue;
    }
    const startSec = (clip.startBeat * 60) / bpm;
    const clipDurationSec = (clip.lengthBeats * 60) / bpm;
    const clipEndSec = startSec + clipDurationSec;

    // Skip clips that do not overlap the export window.
    // No-range: equivalent to window [0, totalDurationSec] — same as before.
    if (startSec >= rangeEndSec) continue;    // starts after window
    if (clipEndSec <= rangeStartSec) continue; // ends before window

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    const gain = offlineCtx.createGain();
    applyVolumeAutomation(gain, clip, bpm, rangeStartSec);
    source.connect(gain);
    gain.connect(offlineCtx.destination);

    // W1 split — Web Audio source.start(when, offset):
    //   rel >= 0: clip starts inside the window → schedule at rel, play from buffer 0
    //   rel <  0: clip overhangs window start → schedule at 0, seek into buffer by -rel
    const rel = startSec - rangeStartSec;
    if (rel >= 0) {
      source.start(rel, 0);
    } else {
      source.start(0, -rel);
    }
  }

  // Video-audio clips — `audioEnabled` opt-in. No GainNode (v0.1
  // doesn't support volume on video audio).
  for (const vc of videoAudioClips) {
    if (!vc.audioEnabled) continue;
    const arrayBuffer = await fetch(vc.url).then((r) => r.arrayBuffer());
    let buffer: AudioBuffer;
    try {
      buffer = await offlineCtx.decodeAudioData(arrayBuffer);
    } catch {
      // Video has no embedded audio track or codec is unsupported —
      // skip silently (matches the silent-live-preview state).
      continue;
    }
    const startSec = (vc.startBeat * 60) / bpm;
    const clipEndSec = startSec + (vc.lengthBeats * 60) / bpm;

    // Skip clips that do not overlap the export window — mirrors the
    // symmetric guard on the audio-clip path above.
    if (startSec >= rangeEndSec) continue;    // starts after window
    if (clipEndSec <= rangeStartSec) continue; // ends before window

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);

    // W1 split — same logic as audio-clip path above.
    const rel = startSec - rangeStartSec;
    if (rel >= 0) {
      source.start(rel, 0);
    } else {
      source.start(0, -rel);
    }
  }

  const mixed = await offlineCtx.startRendering();

  // Peak normalisation. OfflineAudioContext clips hard at ±1.0; if
  // the sum exceeded that, scale to 0.95 peak.
  const peak = findPeak(mixed);
  if (peak > 1.0) normalizePCM(mixed, PEAK_NORMALIZE_TARGET / peak);

  return mixed;
}

function applyVolumeAutomation(
  gain: GainNode,
  clip: Clip,
  bpm: number,
  rangeStartSec = 0
): void {
  const vol = (clip.params as { volume?: StaticOrAuto<number> } | undefined)?.volume ?? 1.0;
  // IEEE-754 accumulation: `beat += 0.1` 40× lands at 4.00000…001
  // (skip last point) or 3.99999…9 (overshoot). Iterate by integer
  // step count instead, clamp the last beat to lengthBeats.
  const steps = Math.ceil(clip.lengthBeats / VOLUME_AUTOMATION_STEP_BEATS);
  for (let i = 0; i <= steps; i++) {
    const beat = Math.min(i * VOLUME_AUTOMATION_STEP_BEATS, clip.lengthBeats);
    const v = resolveParam(vol, beat, clip.lengthBeats);
    // Plan 9d Task 4 — rebase the gain-schedule time to the window.
    // `setValueAtTime` uses the OfflineAudioContext's own time axis
    // which starts at 0 == rangeStart (absolute). Subtract rangeStartSec
    // so fade/automation authored in absolute beat time lands at the
    // correct position in the windowed mix. When rangeStartSec=0 (no
    // range) the expression reduces to the original formula.
    const absoluteTimeSec = ((clip.startBeat + beat) * 60) / bpm;
    const windowTimeSec = Math.max(0, absoluteTimeSec - rangeStartSec);
    gain.gain.setValueAtTime(v, windowTimeSec);
  }
}

function findPeak(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function normalizePCM(buf: AudioBuffer, factor: number): void {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= factor;
  }
}
