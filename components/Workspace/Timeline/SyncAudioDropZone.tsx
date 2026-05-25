'use client';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { detectBeats } from '@/lib/audio/beat-detector';
import { layoutClips } from '@/lib/sceneflow/clip-layout';
import { ConfirmReplaceAudioModal } from '@/components/SceneFlow/ConfirmReplaceAudioModal';
import type { Clip } from '@/lib/timeline/types';

const SIZE_WARN_BYTES = 3 * 1024 * 1024;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Plan 8d — drop zone overlay for the sync-audio lane.
 *
 * Shown when the sync-audio track exists. Empty: "Drop song here or
 * click to upload". With clip: small Replace button. Both paths funnel
 * through `handleFile` which uploads, decodes, runs detectBeats,
 * setBPM, and re-layouts all main-video clips with the new BPM via
 * replaceMainVideoClips (clip.ids preserved for Undo/Redo safety).
 *
 * Replace path opens ConfirmReplaceAudioModal first — protects against
 * accidental BPM-tweak loss.
 */
export function SyncAudioDropZone({
  track,
  existingClip
}: {
  track: { id: string; kind: 'sync-audio' };
  existingClip: Clip | null;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setBPM = useAppStore((s) => s.audioActions.setBPM);
  const addMediaRef = useAppStore((s) => s.mediaActions.addMediaRef);
  const removeMediaRef = useAppStore((s) => s.mediaActions.removeMediaRef);
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const removeClip = useAppStore((s) => s.timelineActions.removeClip);
  const replaceMainVideoClips = useAppStore(
    (s) => s.timelineActions.replaceMainVideoClips
  );
  const currentBpm = useAppStore((s) => s.audio.grid.bpm);
  const currentMediaRefs = useAppStore((s) => s.media.mediaRefs);
  const mainVideoClips = useAppStore((s) =>
    s.timeline.clips.filter((c) => {
      const t = s.timeline.tracks.find((tr) => tr.id === c.trackId);
      return t?.kind === 'main-video';
    })
  );

  function pickFile() {
    if (busy) return;
    fileInputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (existingClip) {
      setPendingFile(f);
      setConfirmOpen(true);
    } else {
      void handleFile(f);
    }
  }

  function onConfirmReplace() {
    setConfirmOpen(false);
    if (pendingFile) {
      const f = pendingFile;
      setPendingFile(null);
      void handleFile(f);
    }
  }

  function onCancelReplace() {
    setConfirmOpen(false);
    setPendingFile(null);
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      if (file.size > SIZE_WARN_BYTES) {
        toast.info(
          `Große Datei (${(file.size / 1024 / 1024).toFixed(1)} MB) — BPM-Analyse dauert kurz`
        );
      }
      const id = (
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      ).toLowerCase();
      if (!UUID_V4_RE.test(id)) {
        toast.error('UUID-Generator nicht verfügbar');
        return;
      }

      // Upload to R2
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'audio');
      fd.append('id', id);
      const upRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!upRes.ok) {
        const body = (await upRes.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error('Upload fehlgeschlagen: ' + (body.error ?? `HTTP ${upRes.status}`));
        return;
      }
      const upload = (await upRes.json()) as { url: string };

      // Decode + BPM
      let bpm: number;
      let durationSec: number;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const Ctor =
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext ?? AudioContext;
        const ctx = new Ctor();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const result = detectBeats({
          data: audioBuffer.getChannelData(0),
          sampleRate: audioBuffer.sampleRate
        });
        bpm = Math.round(result.bpm);
        durationSec = audioBuffer.duration;
        await ctx.close().catch(() => {});
      } catch (e) {
        toast.error('BPM-Analyse fehlgeschlagen: ' + (e as Error).message);
        return;
      }

      // Remove old clip + mediaRef (if any)
      if (existingClip) {
        if (existingClip.mediaId) {
          const stillReferenced = useAppStore
            .getState()
            .timeline.clips.some(
              (c) => c.id !== existingClip.id && c.mediaId === existingClip.mediaId
            );
          if (!stillReferenced) removeMediaRef(existingClip.mediaId);
        }
        removeClip(existingClip.id);
      }

      // Add fresh MediaRef + clip
      const mediaId = `sync-${id}`;
      addMediaRef({
        id: mediaId,
        kind: 'audio',
        url: upload.url,
        filename: file.name,
        duration: durationSec,
        uploadedAt: new Date().toISOString()
      });
      setBPM(bpm);

      // Sync-audio clip spans the maximum of (song duration in beats,
      // current main-video timeline length). Music shorter than the
      // video sequence still has its clip end at the song end — user
      // can extend manually later.
      const songLengthBeats = (durationSec * bpm) / 60;
      const mainLengthBeats =
        mainVideoClips.reduce(
          (m, c) => Math.max(m, c.startBeat + c.lengthBeats),
          0
        ) || 0;
      const clipLengthBeats = Math.max(songLengthBeats, mainLengthBeats) || 16;
      addClip({
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `clip-sync-${Date.now()}`,
        trackId: track.id,
        kind: 'audio',
        mediaId,
        startBeat: 0,
        lengthBeats: clipLengthBeats,
        label: file.name
      });

      // Re-layout main-video clips at the new BPM. Snap mode default
      // 'beat' — VibeGrid doesn't currently know per-story snap (it'd
      // need a context). For now use 'beat' which matches the default
      // post-Transfer state.
      if (mainVideoClips.length > 0) {
        const sceneRefs = mainVideoClips
          .map((c) => {
            if (!c.mediaId) return null;
            const ref = currentMediaRefs.find((m) => m.id === c.mediaId);
            return {
              mediaId: c.mediaId,
              durationSec: ref?.duration ?? c.lengthBeats * (60 / currentBpm),
              // We don't have transition metadata on the Clip — use
              // 'cut' so re-snap stays sequential. Crossfades the user
              // set up at transfer time get flattened to sequential
              // here; future fix could persist transition on the clip.
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
        toast.success(
          `Song hinzugefügt — BPM ${bpm}, ${mainVideoClips.length} Clip(s) re-snapped`
        );
      } else {
        toast.success(`Song hinzugefügt — BPM ${bpm}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const existingFilename = existingClip?.label ?? null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a"
        onChange={onFileChange}
        className="hidden"
      />
      {!existingClip ? (
        // Empty lane: full-width drop hint + click-to-upload
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]/30 transition-colors disabled:opacity-50"
          title="Audio-Datei hochladen (MP3, WAV, M4A)"
        >
          {busy
            ? '… Datei wird verarbeitet'
            : '♪  Drop song here or click to upload'}
        </button>
      ) : (
        // Existing clip: replace button overlay on the right edge of the lane
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="absolute top-1 right-1 text-[9px] uppercase tracking-wider bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text)] rounded px-1.5 py-0.5 disabled:opacity-50"
          title="Anderen Song wählen"
        >
          {busy ? '…' : '↻ Replace'}
        </button>
      )}
      <ConfirmReplaceAudioModal
        open={confirmOpen}
        currentFilename={existingFilename}
        currentBpm={currentBpm}
        onConfirm={onConfirmReplace}
        onCancel={onCancelReplace}
      />
    </>
  );
}
