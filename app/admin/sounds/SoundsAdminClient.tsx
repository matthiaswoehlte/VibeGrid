'use client';
import { useState } from 'react';
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
}

/**
 * Plan 8.7b — admin client shell. Stateful wrapper around the manifest
 * view + the upload / edit / delete modals. R2 URL for direct previews
 * comes from `NEXT_PUBLIC_R2_PUBLIC_URL` (separate from the server-only
 * `R2_PUBLIC_URL` — admin needs it client-side for `<audio>` previews,
 * exposing the public CDN host is intentional).
 */
export function SoundsAdminClient({ initialManifest }: SoundsAdminClientProps) {
  const [manifest, setManifest] = useState<SoundManifest>(initialManifest);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    entry: SoundEntry;
    categoryId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    entry: SoundEntry;
  } | null>(null);

  const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '';

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
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-dim)]">
          Version {manifest.version} · {manifest.categories.length} Kategorien ·{' '}
          {manifest.categories.reduce((n, c) => n + c.sounds.length, 0)} Sounds
        </p>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="text-xs px-3 py-1.5 rounded bg-[var(--a1)] text-white"
        >
          + Sound hochladen
        </button>
      </div>

      {manifest.categories.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] py-6 text-center">
          Kein Manifest in R2. Lade den ersten Sound hoch, um die Library zu
          starten.
        </div>
      )}

      <div className="space-y-4">
        {manifest.categories.map((cat) => (
          <CategorySection
            key={cat.id}
            category={cat}
            onCategoryRename={(label) => onCategoryLabelEdit(cat, label)}
            onEdit={(entry) => setEditTarget({ entry, categoryId: cat.id })}
            onDelete={(entry) => setDeleteTarget({ entry })}
            previewUrl={previewUrl}
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
}

function CategorySection({
  category,
  onCategoryRename,
  onEdit,
  onDelete,
  previewUrl
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
  onEdit(): void;
  onDelete(): void;
}

function SoundRow({ entry, previewUrl, onEdit, onDelete }: SoundRowProps) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--surface-2)] text-xs">
      <span aria-hidden>🔊</span>
      <span className="flex-1 truncate text-[var(--text)]" title={entry.label}>
        {entry.label}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
        {formatDurationSec(entry.duration)}
      </span>
      <span className="font-mono text-[10px] text-[var(--text-muted)] truncate max-w-[200px]">
        {entry.url}
      </span>
      {previewUrl && (
        <audio
          src={previewUrl}
          controls
          preload="none"
          className="h-6 w-32"
          aria-label={`Preview ${entry.label}`}
        />
      )}
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
