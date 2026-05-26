import { toast } from 'sonner';
import { detectBeats } from '@/lib/audio/beat-detector';
import { findEffectiveAudioEndSec } from '@/lib/audio/trailing-silence';
import { layoutClips } from '@/lib/sceneflow/clip-layout';
import { buildAutoDuckCurve, type DuckWindow } from '@/lib/sceneflow/auto-duck';
import type { Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';
import type { AutomationCurve } from '@/lib/automation/types';

/**
 * Plan 8d — shared sync-audio-application pipeline.
 *
 * Two callers feed this:
 *   - `SyncAudioDropZone` — click-to-upload of a fresh File. The
 *     caller uploads first, then calls this with the decoded
 *     arrayBuffer.
 *   - `Tracks.tsx` onNativeDrop — drag-from-library of an audio
 *     mediaRef whose URL is already on R2. The caller fetches the
 *     arrayBuffer (`fetch(url).then(r => r.arrayBuffer())`) and
 *     passes it in.
 *
 * Both paths share: decode → detectBeats → setBPM → remove old
 * sync-audio clip → addClip → re-snap all main-video clips. The
 * mediaRef itself is the caller's responsibility (upload path
 * creates one; library path already has one).
 */

export interface ApplySyncAudioArgs {
  arrayBuffer: ArrayBuffer;
  mediaId: string;
  filename: string;
  trackId: string;
  /** Existing clip on the sync-audio track, if any. Will be removed. */
  existingClip: Clip | null;
  /** All main-video clips at call time — used to compute the maximum length. */
  mainVideoClips: ReadonlyArray<Clip>;
  /** Lookup function for mediaRef.duration on main-video clips. */
  getMediaRef: (id: string) => MediaRef | undefined;
  /** Current BPM — used as fallback if a main-video clip has no mediaRef.duration. */
  currentBpm: number;
  /** Store actions (passed in, not imported, so this stays pure-of-React). */
  setBPM: (bpm: number) => void;
  addClip: (clip: Clip) => void;
  removeClip: (id: string) => void;
  removeMediaRef: (id: string) => void;
  replaceMainVideoClips: (
    layout: Map<string, { startBeat: number; lengthBeats: number }>
  ) => void;
  /** Plan 8d — sets the new sync-audio clip's volume curve so the
   *  Re-Snap path matches the initial Transfer's auto-duck for lipsync
   *  scenes. Called once with the freshly-laid-out duck windows. */
  setClipParam: (
    clipId: string,
    key: string,
    value: AutomationCurve<number> | boolean | number
  ) => void;
  /**
   * Used to walk all clips and decide whether the old sync clip's
   * mediaRef is still referenced elsewhere before deleting it. We
   * pass a getter (not a snapshot) so the check sees the state AFTER
   * removeClip ran in the same tick.
   */
  getAllClips: () => ReadonlyArray<Clip>;
}

export async function applySyncAudioFromArrayBuffer(
  args: ApplySyncAudioArgs
): Promise<void> {
  const {
    arrayBuffer,
    mediaId,
    filename,
    trackId,
    existingClip,
    mainVideoClips,
    getMediaRef,
    currentBpm,
    setBPM,
    addClip,
    removeClip,
    removeMediaRef,
    replaceMainVideoClips,
    setClipParam,
    getAllClips
  } = args;

  // Decode + BPM-detect + trailing-silence trim.
  let bpm: number;
  let durationSec: number;
  let trimmed = false;
  try {
    const Ctor =
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? AudioContext;
    const ctx = new Ctor();
    // Some browsers (Safari) require a writable ArrayBuffer; clone defensively.
    const buf = arrayBuffer.slice(0);
    const audioBuffer = await ctx.decodeAudioData(buf);
    const channel0 = audioBuffer.getChannelData(0);
    const result = detectBeats({
      data: channel0,
      sampleRate: audioBuffer.sampleRate
    });
    bpm = Math.round(result.bpm);
    // Plan 8d — trim trailing silence so the clip-bar reflects the
    // audible music end, not the file's zero-padded tail. MP3 exports
    // routinely pad several seconds (the user's 33 s song was a 139 s
    // file with 106 s of silence). The clip is sized to the trimmed
    // duration; audio engine playback still respects clip bounds, so
    // the silent tail is never reached.
    const silence = findEffectiveAudioEndSec(
      channel0,
      audioBuffer.sampleRate
    );
    durationSec = silence.effectiveDurationSec;
    trimmed = silence.trimmed;
    await ctx.close().catch(() => {});
  } catch (e) {
    toast.error('BPM-Analyse fehlgeschlagen: ' + (e as Error).message);
    return;
  }

  // Remove old clip + (if orphaned) mediaRef.
  if (existingClip) {
    if (existingClip.mediaId && existingClip.mediaId !== mediaId) {
      removeClip(existingClip.id);
      const stillReferenced = getAllClips().some(
        (c) => c.mediaId === existingClip.mediaId
      );
      if (!stillReferenced) removeMediaRef(existingClip.mediaId);
    } else {
      removeClip(existingClip.id);
    }
  }

  setBPM(bpm);

  // Sync-audio clip length = ACTUAL song duration (no Math.max with
  // the main-video timeline length). If the song is shorter than the
  // video sequence the user gets silence at the end of the timeline;
  // they can move or trim manually. The old "stretch to timeline
  // length" behavior produced a clip bar far longer than the music,
  // which was confusing — the bar suggested ongoing audio that wasn't
  // playing.
  const songLengthBeats = (durationSec * bpm) / 60;
  const clipLengthBeats = songLengthBeats || 16;
  const syncClipId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `clip-sync-${Date.now()}`;
  addClip({
    id: syncClipId,
    trackId,
    kind: 'audio',
    mediaId,
    startBeat: 0,
    lengthBeats: clipLengthBeats,
    label: filename
  });

  // Re-layout main-video clips at the new BPM. snap mode 'beat' matches
  // the default post-Transfer state — VibeGrid doesn't currently know
  // per-story snap from inside the timeline.
  if (mainVideoClips.length > 0) {
    const sceneRefs = mainVideoClips
      .map((c) => {
        if (!c.mediaId) return null;
        const ref = getMediaRef(c.mediaId);
        return {
          mediaId: c.mediaId,
          durationSec: ref?.duration ?? c.lengthBeats * (60 / currentBpm),
          // No transition metadata on Clip — fall back to 'cut'. Crossfades
          // set up at transfer time get flattened to sequential here.
          // Documented in KNOWN_LIMITATIONS.md.
          transition: 'cut' as const,
          sceneOrder: 0,
          sceneType: 'action' as const
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const layout = layoutClips({
      clips: sceneRefs,
      bpm,
      snapMode: 'beat'
    });
    const layoutMap = new Map(
      layout.clips.map((c) => [
        c.mediaId,
        { startBeat: c.startBeat, lengthBeats: c.lengthBeats }
      ])
    );
    replaceMainVideoClips(layoutMap);

    // Auto-duck regeneration. Walk the freshly-laid-out main-video
    // clips and detect lipsync ones via clip.params.audioEnabled (set
    // by the initial Transfer). Their NEW (post-re-snap) windows feed
    // into the duck curve on the new sync-audio clip so the duck
    // points follow the moved lipsync clips.
    const duckWindows: DuckWindow[] = [];
    for (const c of mainVideoClips) {
      const isLipsync =
        (c.params as { audioEnabled?: boolean } | undefined)?.audioEnabled === true;
      if (!isLipsync) continue;
      const laid = layoutMap.get(c.mediaId ?? '');
      if (!laid) continue;
      duckWindows.push({
        startBeat: laid.startBeat,
        endBeat: laid.startBeat + laid.lengthBeats
      });
    }
    const duckCurve = buildAutoDuckCurve(duckWindows);
    if (duckCurve) {
      setClipParam(syncClipId, 'volume', duckCurve);
    }

    toast.success(
      `Song hinzugefügt — BPM ${bpm}, ${mainVideoClips.length} Clip(s) re-snapped` +
        (duckWindows.length > 0
          ? ` · ${duckWindows.length} LipSync-Duck aktualisiert`
          : '') +
        (trimmed ? ' · Stille am Ende getrimmt' : '')
    );
  } else {
    toast.success(
      `Song hinzugefügt — BPM ${bpm}` +
        (trimmed ? ' · Stille am Ende getrimmt' : '')
    );
  }
}
