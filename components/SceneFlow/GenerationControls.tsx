'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useSession } from '@/lib/auth/better-auth-client';
import {
  apiGenerateImagesAndVoices,
  apiGenerateVideos,
  apiTransfer,
  type TransferResponse
} from '@/lib/sceneflow/api-client';
import {
  validateScenesForGeneration,
  hasBlockers,
  warningsByScene
} from '@/lib/sceneflow/validation';
import { SceneWarningList } from './SceneWarning';
import { TransferConfirmModal } from './TransferConfirmModal';
import { useAppStore } from '@/lib/store';
import { layoutClips } from '@/lib/sceneflow/clip-layout';
import {
  getMediaDuration,
  getEffectiveAudioDuration
} from '@/lib/sceneflow/media-duration';
import {
  buildAutoDuckCurve,
  type DuckWindow
} from '@/lib/sceneflow/auto-duck';
import type {
  SceneRecord,
  CharacterRecord,
  StoryRecord
} from '@/lib/sceneflow/types';

/**
 * Plan 8c/8d — bottom-bar controls for Phase 1, Phase 2, and Transfer.
 *
 * Phase 1: gated on validation blockers + warns on 🟡.
 * Phase 2: enabled once every non-endcard scene has image_url.
 * Transfer (Plan 8d): warning modal → wipe project → rebuild tracks
 * + clips from the story → router.push('/').
 */
export function GenerationControls({
  story,
  scenes,
  characters
}: {
  story: StoryRecord;
  scenes: SceneRecord[];
  characters: CharacterRecord[];
}) {
  const router = useRouter();
  const session = useSession();
  const userId = session.data?.user?.id ?? null;

  const [busyPhase1, setBusyPhase1] = useState(false);
  const [busyPhase2, setBusyPhase2] = useState(false);
  const [busyTransfer, setBusyTransfer] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingPayload, setPendingPayload] =
    useState<TransferResponse | null>(null);

  // Live store counts for the modal — read inside the component so
  // mode/clip count are fresh at modal-open time.
  const trackCount = useAppStore((s) => s.timeline.tracks.length);
  const clipCount = useAppStore((s) => s.timeline.clips.length);
  const setBPM = useAppStore((s) => s.audioActions.setBPM);
  const addTrack = useAppStore((s) => s.timelineActions.addTrack);
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const clearAllTracks = useAppStore(
    (s) => s.timelineActions.clearAllTracks
  );
  const addMediaRef = useAppStore((s) => s.mediaActions.addMediaRef);
  const purgeSceneflowMediaRefs = useAppStore(
    (s) => s.mediaActions.purgeSceneflowMediaRefs
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  // Plan 10 — Transfer is a project-boundary wipe; the undo stack from
  // the previous timeline state must not bleed across or Ctrl+Z would
  // resurrect deleted clips into a now-inconsistent tracks layout.
  const clearHistory = useAppStore((s) => s.clearHistory);

  const warnings = validateScenesForGeneration({
    story,
    scenes,
    characters
  });
  const blockerOn = hasBlockers(warnings);
  const warnOnly = warnings.length > 0 && !blockerOn;

  const phase1Done = scenes
    .filter((s) => s.type !== 'endcard')
    .every((s) => s.image_url !== null);

  const phase2HasAnyVideo = scenes.some(
    (s) => s.video_url !== null || s.type === 'endcard'
  );
  const phase2Done = scenes.every(
    (s) => s.type === 'endcard' || s.video_url !== null
  );

  const renderableSceneCount = useMemo(
    () =>
      scenes.filter(
        (s) =>
          (s.type !== 'endcard' && s.video_url !== null) ||
          (s.type === 'endcard' && s.image_url !== null)
      ).length,
    [scenes]
  );

  async function runPhase1() {
    if (blockerOn) return;
    if (warnOnly) {
      const ok = window.confirm(
        'Es gibt gelbe Warnungen. Generierung trotzdem starten?'
      );
      if (!ok) return;
    }
    setBusyPhase1(true);
    try {
      const res = await apiGenerateImagesAndVoices(story.id);
      const ttsFail = res.tts.total - res.tts.ok;
      const imgFail = res.images.total - res.images.ok;
      if (ttsFail === 0 && imgFail === 0) {
        toast.success('Phase 1 fertig — Bilder und Stimmen generiert.');
      } else {
        toast.warning(
          `Phase 1 teilweise fehlgeschlagen — TTS ${ttsFail}, Bilder ${imgFail}`
        );
      }
    } catch (e) {
      toast.error('Phase 1 fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyPhase1(false);
    }
  }

  async function runPhase2() {
    setBusyPhase2(true);
    try {
      const res = await apiGenerateVideos(story.id);
      toast.success(`Phase 2 gestartet — ${res.enqueued} Job(s) in der Queue.`);
    } catch (e) {
      toast.error('Phase 2 fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyPhase2(false);
    }
  }

  /**
   * Transfer — Step 1: fetch the payload, open the confirm modal with
   * the wipe-preview. The actual destructive write happens in
   * `commitTransfer` once the user clicks "Transferieren".
   */
  async function openTransferModal() {
    if (!userId) {
      toast.error('Nicht eingeloggt');
      return;
    }
    setBusyTransfer(true);
    try {
      const payload = await apiTransfer(story.id);
      setPendingPayload(payload);
      setModalOpen(true);
    } catch (e) {
      toast.error('Transfer-Vorbereitung fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyTransfer(false);
    }
  }

  /**
   * Transfer — Step 2: apply the payload to the Zustand store
   * (purge → wipe → build tracks → layout clips → setBPM) and
   * navigate to the VibeGrid tab.
   *
   * Plan 8d — async because we probe the actual rendered video/audio
   * durations (HTMLMediaElement preload="metadata") before laying
   * clips out. The user-intent `scene.duration` from the DB often
   * doesn't match the real file (lipsync trims to audio length, Kling
   * pads to its discrete options), and that mismatch makes the
   * timeline window not match the playable content. Probing takes
   * ~50-200 ms per file in parallel — added to the existing modal-
   * close → store-write pipeline, indistinguishable from UI latency.
   */
  async function commitTransfer() {
    if (!pendingPayload || !userId) return;
    const payload = pendingPayload;
    setModalOpen(false);
    setBusyTransfer(true);

    try {
      // 0. Probe REAL durations for every video URL + the sync audio
      //    in parallel. Falls back to the DB-supplied durationSec on
      //    timeout / CORS / network error.
      const accurateDurations = new Map<string, number>();
      const probes: Promise<void>[] = [];
      for (const c of payload.clips) {
        if (!c.videoUrl) continue;
        probes.push(
          getMediaDuration(c.videoUrl, 'video').then((d) => {
            if (d !== null) accurateDurations.set(c.mediaId, d);
          })
        );
      }
      let syncAudioDurationSec: number | null = null;
      if (payload.syncAudio) {
        // Sync-audio uses the silence-aware probe (full decode +
        // trailing-silence trim) instead of metadata-only — MP3 files
        // routinely report a 139 s duration when only 33 s is audible
        // music. Heavier (~1-2 s for a 3 MB file) but the only way to
        // make the clip-bar reflect the audible end.
        probes.push(
          getEffectiveAudioDuration(payload.syncAudio.url).then((d) => {
            syncAudioDurationSec = d;
          })
        );
      }
      await Promise.all(probes);

      // 1. Purge orphan SceneFlow MediaRefs from previous transfers of
      //    THIS story (different stories' assets stay).
      purgeSceneflowMediaRefs(payload.storyId, userId);
      // 2. Wipe the rest (other tracks, FX, manual clips). Tabula rasa.
      clearAllTracks();

      // 3. BPM — use the song's BPM if present, default 120.
      const bpm = payload.syncAudio?.bpm ?? 120;
      setBPM(bpm);

      // 4. Sync-audio track always exists post-transfer (even empty —
      //    user can drop a song later in VibeGrid). addTrack assigns its
      //    own UUID; we read it back via getState() right below.
      addTrack('sync-audio', 'Sync Audio');
      // addTrack assigns a fresh UUID; find it post-add to know the id.
      const syncTrack = useAppStore
        .getState()
        .timeline.tracks.find((t) => t.kind === 'sync-audio');
      if (!syncTrack) {
        toast.error('Sync-Audio-Spur konnte nicht angelegt werden');
        return;
      }

      // 5. Main-video track.
      addTrack('main-video', 'Main Video');
      const mainTrack = useAppStore
        .getState()
        .timeline.tracks.find((t) => t.kind === 'main-video');
      if (!mainTrack) {
        toast.error('Main-Video-Spur konnte nicht angelegt werden');
        return;
      }

      // 6. MediaRefs for every clip + the sync audio. Use probed
      //    duration when available so re-snap (apply-sync-audio) sees
      //    the real length too.
      for (const c of payload.clips) {
        const url = c.videoUrl ?? c.imageUrl;
        if (!url) continue;
        const effectiveDuration =
          accurateDurations.get(c.mediaId) ?? c.durationSec;
        addMediaRef({
          id: c.mediaId,
          kind: c.videoUrl ? 'video' : 'image',
          url,
          filename: `scene-${c.sceneOrder}.${c.videoUrl ? 'mp4' : 'jpg'}`,
          duration: effectiveDuration,
          uploadedAt: new Date().toISOString()
        });
      }
      if (payload.syncAudio) {
        addMediaRef({
          id: `sync-${payload.storyId}`,
          kind: 'audio',
          url: payload.syncAudio.url,
          filename: 'sync-audio',
          duration: syncAudioDurationSec ?? undefined,
          uploadedAt: new Date().toISOString()
        });
      }

      // 7. Run the layout algorithm + add main-video clips. Use real
      //    durations from the probe; fall back to scene.duration on
      //    probe failure. lipsync clips with probed durations < scene
      //    intent get an accurate-length window so the video doesn't
      //    freeze on its last frame past its real end.
      const layout = layoutClips({
        clips: payload.clips.map((c) => ({
          mediaId: c.mediaId,
          durationSec: accurateDurations.get(c.mediaId) ?? c.durationSec,
          transition: c.transition,
          sceneOrder: c.sceneOrder,
          sceneType: c.sceneType
        })),
        bpm,
        snapMode: payload.snapMode
      });

      // Track lipsync windows in the laid-out timeline so we can build
      // the auto-duck curve for the sync-audio clip below.
      const duckWindows: DuckWindow[] = [];
      const lipsyncClipIds: string[] = [];

      for (const r of layout.clips) {
        const sourceClip = payload.clips.find((x) => x.mediaId === r.mediaId);
        if (!sourceClip) continue;
        const isLipsync = sourceClip.audioType === 'lipsync';
        const clipId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `clip-${r.mediaId}-${Date.now()}`;
        addClip({
          id: clipId,
          trackId: mainTrack.id,
          kind: sourceClip.videoUrl ? 'video' : 'image',
          mediaId: r.mediaId,
          startBeat: r.startBeat,
          lengthBeats: r.lengthBeats,
          label: `Szene ${sourceClip.sceneOrder}`
        });
        if (isLipsync) {
          // Set BOTH params separately so the existing setClipParam
          // (single-key writer) can do its work without a custom batch.
          setClipParam(clipId, 'audioEnabled', true);
          duckWindows.push({
            startBeat: r.startBeat,
            endBeat: r.startBeat + r.lengthBeats
          });
          lipsyncClipIds.push(clipId);
        }
      }

      // 8. Sync-audio clip: length = ACTUAL song duration (not the
      //    main-video stack length). If the song is shorter than the
      //    timeline, the user gets silence at the end. If longer, the
      //    clip overhangs and the user can trim manually. Auto-duck
      //    curve attached if there are lipsync clips.
      if (payload.syncAudio) {
        const songLengthBeats =
          syncAudioDurationSec !== null && syncAudioDurationSec > 0
            ? (syncAudioDurationSec * bpm) / 60
            : // Fallback if metadata probe failed: span the timeline.
              layout.clips.reduce(
                (m, c) => Math.max(m, c.startBeat + c.lengthBeats),
                0
              ) || 16;
        const syncClipId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `clip-sync-${Date.now()}`;
        addClip({
          id: syncClipId,
          trackId: syncTrack.id,
          kind: 'audio',
          mediaId: `sync-${payload.storyId}`,
          startBeat: 0,
          lengthBeats: songLengthBeats,
          label: 'Sync Audio'
        });
        const duckCurve = buildAutoDuckCurve(duckWindows);
        if (duckCurve) {
          setClipParam(syncClipId, 'volume', duckCurve);
        }
      }

      setPendingPayload(null);

      // Plan 10 — wipe the undo stack now that the destination project
      // is fully rebuilt. The user was warned in the confirm modal.
      clearHistory();

      const trimmedCount = layout.clips.filter((c) => c.trimmed).length;
      const lipsyncCount = lipsyncClipIds.length;
      const probedCount = accurateDurations.size;
      const totalVideoClips = payload.clips.filter((c) => c.videoUrl).length;
      toast.success(
        `${layout.clips.length} Clip(s) auf die Timeline übertragen` +
          (trimmedCount > 0
            ? ` · ${trimmedCount} getrimmt auf Snap-Grid`
            : '') +
          (lipsyncCount > 0
            ? ` · ${lipsyncCount} LipSync (Audio on + Duck)`
            : '') +
          (probedCount < totalVideoClips
            ? ` · ${totalVideoClips - probedCount} Dauer-Probe(s) fehlgeschlagen`
            : '')
      );
      for (const w of layout.warnings) {
        toast.warning(w.message);
      }

      // 9. Switch to the VibeGrid tab. '/' is a real route under
      // app/(studio)/page.tsx; typedRoutes inference drops it due to the
      // route group + storyboard re-export, hence the cast.
      router.push('/' as Route);
    } finally {
      setBusyTransfer(false);
    }
  }

  function cancelTransfer() {
    setModalOpen(false);
    setPendingPayload(null);
  }

  const byScene = warningsByScene(warnings);

  return (
    <>
      <div className="sticky bottom-0 mt-4 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-3 space-y-2">
        {warnings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--text-dim)] select-none">
              {blockerOn ? '🔴' : '🟡'} {warnings.length} Warnung(en) — Details
            </summary>
            <div className="mt-2 space-y-2">
              {Array.from(byScene.entries()).map(([sceneId, sceneWarnings]) => {
                const s = scenes.find((x) => x.id === sceneId);
                return (
                  <div key={sceneId}>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase">
                      Szene {s?.scene_order}
                    </div>
                    <SceneWarningList warnings={sceneWarnings} />
                  </div>
                );
              })}
            </div>
          </details>
        )}
        <div className="flex gap-2 items-center">
          <button
            type="button"
            disabled={busyPhase1 || blockerOn || scenes.length === 0}
            onClick={runPhase1}
            className="px-3 py-1.5 text-xs rounded bg-[var(--a1)] text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busyPhase1 ? 'läuft …' : 'Image + Voice Generation'}
          </button>
          <button
            type="button"
            disabled={busyPhase2 || !phase1Done}
            onClick={runPhase2}
            className="px-3 py-1.5 text-xs rounded bg-[var(--a2)] text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busyPhase2 ? 'enqueued …' : 'Create Full Movie'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={busyTransfer || !phase2HasAnyVideo}
            onClick={openTransferModal}
            className="px-3 py-1.5 text-xs rounded bg-[var(--a3)] text-black disabled:opacity-30 disabled:cursor-not-allowed"
            title={
              phase2Done
                ? 'Alle Szenen fertig — Timeline öffnen'
                : 'Mindestens ein Video erstellt'
            }
          >
            {busyTransfer ? '...' : 'Transfer to Timeline'}
          </button>
        </div>
      </div>
      <TransferConfirmModal
        open={modalOpen}
        trackCount={trackCount}
        clipCount={clipCount}
        sceneCount={renderableSceneCount}
        syncAudio={
          pendingPayload?.syncAudio
            ? { bpm: pendingPayload.syncAudio.bpm }
            : null
        }
        snapMode={pendingPayload?.snapMode ?? story.snap_mode}
        onConfirm={commitTransfer}
        onCancel={cancelTransfer}
      />
    </>
  );
}
