'use client';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { applySyncAudioFromArrayBuffer } from '@/lib/sceneflow/apply-sync-audio';
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
  existingClip,
  pxPerBeat
}: {
  track: { id: string; kind: 'sync-audio' };
  existingClip: Clip | null;
  /** Plan 8d — used to anchor the "↻ Replace" button to the clip's
   *  right edge instead of the lane's far-right edge (which extends
   *  past the content via the DROP_HEADROOM_BEATS in
   *  `computeTotalBeats`). The lane-edge position made it look like
   *  the timeline ended 16 s after the music — confusing both visually
   *  and as a user mental model of "where does my project end". */
  pxPerBeat: number;
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
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const replaceMainVideoClips = useAppStore(
    (s) => s.timelineActions.replaceMainVideoClips
  );
  const currentBpm = useAppStore((s) => s.audio.grid.bpm);

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

      // Read bytes once — shared between addMediaRef (sets duration
      // after decode) and the apply pipeline. Plan 8d hotfix: the
      // pipeline also handles BPM-detect + clip layout + auto-duck so
      // SyncAudioDropZone doesn't duplicate it.
      const arrayBuffer = await file.arrayBuffer();
      const mediaId = `sync-${id}`;

      // MediaRef is registered up-front so the helper can read it via
      // getMediaRef during main-video re-layout. Duration is unknown
      // until decode finishes — the helper updates it implicitly via
      // its own state read (mediaRef.duration is only used as a hint).
      addMediaRef({
        id: mediaId,
        kind: 'audio',
        url: upload.url,
        filename: file.name,
        uploadedAt: new Date().toISOString()
      });

      // Snapshot main-video clips and refs at this moment so the helper
      // sees a consistent state (existingClip is still present; pipeline
      // removes it).
      const snapshot = useAppStore.getState();
      const mainVideoClips = snapshot.timeline.clips.filter((c) => {
        const t = snapshot.timeline.tracks.find((tr) => tr.id === c.trackId);
        return t?.kind === 'main-video';
      });

      await applySyncAudioFromArrayBuffer({
        arrayBuffer,
        mediaId,
        filename: file.name,
        trackId: track.id,
        existingClip,
        mainVideoClips,
        getMediaRef: useAppStore.getState().mediaActions.getMediaRef,
        currentBpm,
        setBPM,
        addClip,
        removeClip,
        removeMediaRef,
        replaceMainVideoClips,
        setClipParam,
        getAllClips: () => useAppStore.getState().timeline.clips
      });
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
        // Existing clip: Replace button anchored to the clip's right
        // edge. `left` = clip end in px, minus a few px so the button
        // overlaps the clip-edge slightly (clear visual anchor) but
        // never escapes the lane on a heavily zoomed-out view.
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          style={{
            left:
              Math.max(
                0,
                (existingClip.startBeat + existingClip.lengthBeats) * pxPerBeat - 64
              )
          }}
          className="absolute top-1 text-[9px] uppercase tracking-wider bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text)] rounded px-1.5 py-0.5 disabled:opacity-50"
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
