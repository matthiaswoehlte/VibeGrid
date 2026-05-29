'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  SoundManifest,
  SoundCategory,
  SoundEntry
} from '@/lib/sounds/types';
import { UploadModal } from './UploadModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

function formatDurationSec(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`;
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const r = total % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
}

interface SoundsAdminClientProps {
  initialManifest: SoundManifest;
  /**
   * R2 public-CDN base URL, passed down by the page server-component
   * (which reads `R2_PUBLIC_URL` via `getR2Config()`). Used to build
   * `<audio src>` URLs from the admin manifest's relative `sound.url`
   * paths — the admin path serves the raw manifest (no URL rewrite,
   * unlike the user BFF) so the client has to compose absolute URLs
   * itself.
   */
  r2PublicUrl: string;
}

/**
 * Plan 8.7b — admin client shell. Stateful wrapper around the manifest
 * view + the upload / edit / delete modals. R2 URL for direct previews
 * comes from `NEXT_PUBLIC_R2_PUBLIC_URL` (separate from the server-only
 * `R2_PUBLIC_URL` — admin needs it client-side for `<audio>` previews,
 * exposing the public CDN host is intentional).
 */
export function SoundsAdminClient({
  initialManifest,
  r2PublicUrl
}: SoundsAdminClientProps) {
  const [manifest, setManifest] = useState<SoundManifest>(initialManifest);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    entry: SoundEntry;
    categoryId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    entry: SoundEntry;
  } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Single-flight preview player — at most one sound plays at a time.
  // The current entry id drives the play/stop button state on rows.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = '';
      }
    };
  }, []);

  // r2PublicUrl comes from the page server-component (see prop docs above).

  function togglePreview(entryId: string, url: string) {
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.crossOrigin = 'anonymous';
      el.addEventListener('ended', () => setPlayingId(null));
      el.addEventListener('error', () => setPlayingId(null));
      audioRef.current = el;
    }
    if (playingId === entryId) {
      el.pause();
      el.currentTime = 0;
      setPlayingId(null);
      return;
    }
    el.src = url;
    el.currentTime = 0;
    void el
      .play()
      .then(() => setPlayingId(entryId))
      .catch(() => setPlayingId(null));
  }

  const visibleCategories = useMemo(() => {
    if (categoryFilter === 'all') return manifest.categories;
    return manifest.categories.filter((c) => c.id === categoryFilter);
  }, [manifest.categories, categoryFilter]);

  async function refreshManifest(): Promise<void> {
    const res = await fetch('/api/admin/sounds/manifest', { cache: 'no-store' });
    if (res.ok) setManifest((await res.json()) as SoundManifest);
  }

  async function onDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    const id = deleteTarget.entry.id;
    setDeleteTarget(null);
    const res = await fetch(`/api/admin/sounds/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      toast.error('Löschen fehlgeschlagen: ' + (body.error ?? res.status));
      return;
    }
    toast.success('Sound gelöscht');
    await refreshManifest();
  }

  async function onCategoryLabelEdit(
    cat: SoundCategory,
    newLabel: string
  ): Promise<void> {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === cat.label) return;
    const updatedManifest: SoundManifest = {
      ...manifest,
      categories: manifest.categories.map((c) =>
        c.id === cat.id ? { ...c, label: trimmed } : c
      )
    };
    const res = await fetch('/api/admin/sounds/manifest', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updatedManifest)
    });
    if (!res.ok) {
      toast.error('Kategorie-Update fehlgeschlagen');
      return;
    }
    toast.success('Kategorie umbenannt');
    await refreshManifest();
  }

  function previewUrl(entry: SoundEntry): string {
    // Admin manifest holds RELATIVE urls (see /api/admin/sounds/manifest).
    if (!r2PublicUrl) return '';
    return `${r2PublicUrl}/library/${entry.url}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-dim)]">
          Version {manifest.version} · {manifest.categories.length} Kategorien ·{' '}
          {manifest.categories.reduce((n, c) => n + c.sounds.length, 0)} Sounds
        </p>
        <div className="flex items-center gap-2">
          {manifest.categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-7 px-2 rounded bg-[var(--surface-2)] text-xs text-[var(--text)] focus:outline-none focus:bg-[var(--surface-3)]"
              aria-label="Kategorie filtern"
            >
              <option value="all">Alle Kategorien</option>
              {manifest.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.sounds.length})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="text-xs px-3 py-1.5 rounded bg-[var(--a1)] text-white"
          >
            + Sound hochladen
          </button>
        </div>
      </div>

      {manifest.categories.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] py-6 text-center">
          Kein Manifest in R2. Lade den ersten Sound hoch, um die Library zu
          starten.
        </div>
      )}

      <div className="space-y-4">
        {visibleCategories.map((cat) => (
          <CategorySection
            key={cat.id}
            category={cat}
            onCategoryRename={(label) => onCategoryLabelEdit(cat, label)}
            onEdit={(entry) => setEditTarget({ entry, categoryId: cat.id })}
            onDelete={(entry) => setDeleteTarget({ entry })}
            previewUrl={previewUrl}
            playingId={playingId}
            onTogglePreview={togglePreview}
          />
        ))}
      </div>

      <UploadModal
        open={uploadOpen}
        mode="create"
        categories={manifest.categories}
        onClose={() => setUploadOpen(false)}
        onComplete={(m) => setManifest(m)}
      />
      <UploadModal
        open={editTarget !== null}
        mode="edit"
        categories={manifest.categories}
        existingEntry={editTarget?.entry}
        existingCategoryId={editTarget?.categoryId}
        onClose={() => setEditTarget(null)}
        onComplete={(m) => setManifest(m)}
      />
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        soundLabel={deleteTarget?.entry.label ?? ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={onDeleteConfirm}
      />
    </div>
  );
}

interface CategorySectionProps {
  category: SoundCategory;
  onCategoryRename(label: string): void;
  onEdit(entry: SoundEntry): void;
  onDelete(entry: SoundEntry): void;
  previewUrl(entry: SoundEntry): string;
  playingId: string | null;
  onTogglePreview(entryId: string, url: string): void;
}

function CategorySection({
  category,
  onCategoryRename,
  onEdit,
  onDelete,
  previewUrl,
  playingId,
  onTogglePreview
}: CategorySectionProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(category.label);

  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        {editingLabel ? (
          <>
            <input
              type="text"
              value={labelDraft}
              autoFocus
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => {
                setEditingLabel(false);
                onCategoryRename(labelDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditingLabel(false);
                  onCategoryRename(labelDraft);
                }
                if (e.key === 'Escape') {
                  setEditingLabel(false);
                  setLabelDraft(category.label);
                }
              }}
              className="h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingLabel(true);
              setLabelDraft(category.label);
            }}
            className="text-sm font-bold text-[var(--text)] hover:text-[var(--a2)]"
            title="Kategorie umbenennen"
          >
            {category.label}
          </button>
        )}
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {category.sounds.length}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          id: <code>{category.id}</code>
        </span>
      </header>

      <ul className="space-y-1">
        {category.sounds.map((entry) => (
          <SoundRow
            key={entry.id}
            entry={entry}
            previewUrl={previewUrl(entry)}
            playing={playingId === entry.id}
            onTogglePreview={onTogglePreview}
            onEdit={() => onEdit(entry)}
            onDelete={() => onDelete(entry)}
          />
        ))}
      </ul>
    </section>
  );
}

interface SoundRowProps {
  entry: SoundEntry;
  previewUrl: string;
  playing: boolean;
  onTogglePreview(entryId: string, url: string): void;
  onEdit(): void;
  onDelete(): void;
}

function SoundRow({
  entry,
  previewUrl,
  playing,
  onTogglePreview,
  onEdit,
  onDelete
}: SoundRowProps) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--surface-2)] text-xs">
      <button
        type="button"
        onClick={() => previewUrl && onTogglePreview(entry.id, previewUrl)}
        disabled={!previewUrl}
        className={`w-7 h-7 flex items-center justify-center rounded ${
          playing
            ? 'bg-[var(--a1)] text-white'
            : 'bg-[var(--surface-3)] hover:bg-[var(--a1)]/40 text-[var(--text)]'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label={playing ? `Preview stoppen ${entry.label}` : `Preview abspielen ${entry.label}`}
        title={playing ? 'Stop' : 'Preview'}
      >
        {playing ? '■' : '▶'}
      </button>
      <span className="flex-1 truncate text-[var(--text)]" title={entry.label}>
        {entry.label}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
        {formatDurationSec(entry.duration)}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-muted)] truncate max-w-[200px]" title={entry.url}>
        {entry.url}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="px-2 py-0.5 rounded bg-[var(--surface-3)] hover:bg-[var(--a1)]/30 text-[var(--text)]"
        title="Bearbeiten"
      >
        ✏
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="px-2 py-0.5 rounded bg-[var(--surface-3)] hover:bg-red-500/30 text-[var(--text)]"
        title="Löschen"
      >
        🗑
      </button>
    </li>
  );
}
