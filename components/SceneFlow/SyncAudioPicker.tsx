'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import { detectBeats } from '@/lib/audio/beat-detector';
import type { StoryRecord } from '@/lib/sceneflow/types';

const SIZE_WARN_BYTES = 3 * 1024 * 1024;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Plan 8d — sync-audio upload + BPM detection + snap-mode radio.
 *
 * Lives in StorySetupForm. Uploads via the existing /api/upload route
 * (kind=audio), then decodes client-side via AudioContext + runs
 * detectBeats (energy-based, Plan 2). Both URL and detected BPM are
 * persisted to VG_stories via PATCH so the Transfer route reads them
 * directly without re-decoding.
 *
 * Edge cases:
 *  - File > 3 MB: info-toast warns about main-thread block before
 *    detect runs (no Web-Worker in v0.1) [Fix D2]
 *  - Decode error: toast + abort, no PATCH
 *  - BPM clamped to 40-300 by the PATCH route's validator
 */
export function SyncAudioPicker({
  story,
  onPatched
}: {
  story: StoryRecord;
  onPatched(patch: Partial<StoryRecord>): void;
}) {
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      if (file.size > SIZE_WARN_BYTES) {
        toast.info(
          `Große Datei (${(file.size / 1024 / 1024).toFixed(1)} MB) — BPM-Analyse dauert kurz`
        );
      }
      // crypto.randomUUID is available in modern browsers + Node 19+
      const id = (
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      ).toLowerCase();
      if (!UUID_V4_RE.test(id)) {
        toast.error('UUID-Generator nicht verfügbar — bitte modernen Browser nutzen');
        return;
      }

      // Step 1 — upload
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

      // Step 2 — decode + BPM detect (client-side, blocks main thread
      // briefly for large files — toast above warned the user)
      let bpm: number;
      try {
        const arrayBuffer = await file.arrayBuffer();
        // SSR-safe via 'use client'; AudioContext exists in the browser
        const Ctor =
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext ?? AudioContext;
        const ctx = new Ctor();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const channel0 = audioBuffer.getChannelData(0);
        const result = detectBeats({
          data: channel0,
          sampleRate: audioBuffer.sampleRate
        });
        bpm = Math.round(result.bpm);
        // Free the AudioContext eagerly so the browser doesn't keep an
        // idle one around for the rest of the session.
        await ctx.close().catch(() => {});
      } catch (e) {
        toast.error('BPM-Analyse fehlgeschlagen: ' + (e as Error).message);
        return;
      }

      // Step 3 — persist URL + BPM
      await apiPatchStory(story.id, {
        syncAudioUrl: upload.url,
        syncAudioBpm: bpm
      });
      onPatched({ sync_audio_url: upload.url, sync_audio_bpm: bpm });
      setFilename(file.name);
      toast.success(`Sync-Audio gesetzt — BPM ${bpm} detected`);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await apiPatchStory(story.id, {
        syncAudioUrl: null,
        syncAudioBpm: null
      });
      onPatched({ sync_audio_url: null, sync_audio_bpm: null });
      setFilename(null);
      toast.success('Sync-Audio entfernt');
    } finally {
      setBusy(false);
    }
  }

  async function handleSnapModeChange(mode: 'beat' | 'bar' | 'off') {
    try {
      await apiPatchStory(story.id, { snapMode: mode });
      onPatched({ snap_mode: mode });
    } catch {
      toast.error('Snap-Modus-Speichern fehlgeschlagen');
    }
  }

  const hasAudio = story.sync_audio_url !== null;

  return (
    <div className="space-y-2 border border-[var(--border)] rounded-lg bg-[var(--surface-1)] p-3">
      <div className="text-xs text-[var(--text-dim)]">Sync-Audio (optional)</div>
      {hasAudio ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--a3)]">♪</span>
          <span className="flex-1 truncate text-[var(--text)]">
            {filename ?? 'Hochgeladen'}
          </span>
          <span className="text-[var(--text-muted)] tabular-nums">
            BPM {story.sync_audio_bpm ?? '—'}
          </span>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="text-[var(--text-muted)] hover:text-red-300 px-1 disabled:opacity-50"
            title="Sync-Audio entfernen"
          >
            ✕
          </button>
        </div>
      ) : (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            className="text-[var(--text-dim)] text-[10px] file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-[var(--border)] file:bg-[var(--surface-2)] file:text-[var(--text)] file:text-xs hover:file:bg-[var(--surface-3)]"
          />
          {busy && (
            <span className="text-[var(--text-muted)] animate-pulse">
              … läuft
            </span>
          )}
        </label>
      )}
      <div className="flex items-center gap-3 text-xs text-[var(--text)] pt-1">
        <span className="text-[var(--text-muted)]">Snap-Modus:</span>
        {(['beat', 'bar', 'off'] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`snap-${story.id}`}
              checked={story.snap_mode === mode}
              onChange={() => void handleSnapModeChange(mode)}
            />
            {mode === 'beat' ? 'Beat' : mode === 'bar' ? 'Takt (4 Beats)' : 'Aus'}
          </label>
        ))}
      </div>
    </div>
  );
}
