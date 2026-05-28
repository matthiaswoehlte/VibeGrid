'use client';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import type { SoundEntry, SoundCategory } from '@/lib/sounds/types';
import { SoundLibraryItem } from './SoundLibraryItem';

/**
 * Plan 8.7 — Sound Library panel (4th LeftPanel tab).
 *
 * Reads manifest + loading/error state from the `sounds` slice — no
 * own fetches. Renders a search bar + collapsible category accordions
 * (open by default). [+] / drag-to-track delegate to
 * `addSoundToTimeline` which mirrors the SyncAudioDropZone pattern
 * (addMediaRef skip + addClip record).
 *
 * Empty / loading / error states are first-class — Sound Library is
 * optional, a missing manifest never crashes the app.
 */
export function SoundLibrary() {
  const manifest = useAppStore((s) => s.sounds.manifest);
  const isLoading = useAppStore((s) => s.sounds.isLoading);
  const error = useAppStore((s) => s.sounds.error);
  const tracks = useAppStore((s) => s.timeline.tracks);
  const bpm = useAppStore((s) => s.audio.grid.bpm);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => filterCategories(manifest?.categories ?? [], query), [
    manifest,
    query
  ]);

  function toggleCategory(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSoundToTimeline(sound: SoundEntry) {
    // Pick the first non-sync audio track (sync-audio is reserved for
    // the BPM grid source). Falling back to sync-audio would interfere
    // with the auto-duck pipeline.
    const audioTrack = tracks.find((t) => t.kind === 'audio');
    if (!audioTrack) {
      toast.error('Kein Audio-Track vorhanden — erst einen anlegen.');
      return;
    }
    const mediaId = `library-${sound.id}`;
    const state = useAppStore.getState();
    if (!state.mediaActions.getMediaRef(mediaId)) {
      state.mediaActions.addMediaRef({
        id: mediaId,
        kind: 'audio',
        url: sound.url,
        filename: sound.label,
        uploadedAt: new Date().toISOString(),
        duration: sound.duration,
        source: 'library',
        license: sound.license
      });
    }
    const effectiveBpm = bpm || 120;
    const lengthBeats = Math.max(0.5, (sound.duration * effectiveBpm) / 60);
    state.timelineActions.addClip({
      id: crypto.randomUUID(),
      trackId: audioTrack.id,
      kind: 'audio',
      mediaId,
      startBeat: state.timeline.playhead.beats,
      lengthBeats,
      label: sound.label
    });
    toast.success(`${sound.label} hinzugefügt`);
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Suche…"
        className="w-full h-7 px-2 rounded bg-[var(--surface-2)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:bg-[var(--surface-3)]"
      />

      {isLoading && (
        <div className="text-xs text-[var(--text-dim)] px-2 py-3">Lade Sound Library…</div>
      )}

      {!isLoading && error && (
        <div className="text-xs text-[var(--text-muted)] px-2 py-3">
          Sound Library nicht verfügbar.
        </div>
      )}

      {!isLoading && !error && manifest && filtered.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] px-2 py-3">
          {query ? 'Keine Treffer.' : 'Manifest ist leer.'}
        </div>
      )}

      {!isLoading && !error && filtered.map((cat) => {
        const isCollapsed = collapsed.has(cat.id);
        return (
          <section key={cat.id} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center gap-1 px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              <span aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
              {cat.icon && <span className="not-sr-only">{cat.icon}</span>}
              <span className="flex-1 text-left">{cat.label}</span>
              <span className="font-mono text-[var(--text-muted)] tabular-nums">
                {cat.sounds.length}
              </span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-1">
                {cat.sounds.map((s) => (
                  <SoundLibraryItem key={s.id} sound={s} onAdd={addSoundToTimeline} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function filterCategories(
  cats: SoundCategory[],
  query: string
): SoundCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return cats;
  return cats
    .map((cat) => ({
      ...cat,
      sounds: cat.sounds.filter((s) => matchesQuery(s, q))
    }))
    .filter((cat) => cat.sounds.length > 0);
}

function matchesQuery(s: SoundEntry, q: string): boolean {
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}
