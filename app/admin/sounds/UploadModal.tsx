'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  SoundCategory,
  SoundEntry,
  SoundManifest
} from '@/lib/sounds/types';

export type UploadModalMode = 'create' | 'edit';

export interface UploadModalProps {
  open: boolean;
  mode: UploadModalMode;
  categories: SoundCategory[];
  /** Required when mode === 'edit'. */
  existingEntry?: SoundEntry;
  /** Required when mode === 'edit'. */
  existingCategoryId?: string;
  onClose(): void;
  /** Receives the updated manifest from the server. */
  onComplete(manifest: SoundManifest): void;
}

let _audioCtx: AudioContext | null = null;

/**
 * Plan 8.7b — AudioContext singleton (W12). Recreated on close so a
 * series of uploads in one session shares one context (Safari/iOS have
 * an ~6-context cap before the browser refuses to spin up new ones).
 */
function getAudioCtx(): AudioContext {
  if (
    !_audioCtx ||
    _audioCtx.state === 'closed'
  ) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) throw new Error('AudioContext unavailable in this browser');
    _audioCtx = new Ctor();
  }
  return _audioCtx;
}

async function measureDuration(file: File): Promise<number> {
  const buf = await file.arrayBuffer();
  const decoded = await getAudioCtx().decodeAudioData(buf);
  return decoded.duration;
}

function suggestLabelFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Plan 8.7b — upload/edit modal.
 *
 * Create-mode: file picker active, label autosuggested from filename,
 *   duration measured via AudioContext, submit → POST /api/admin/sounds/upload
 *   (atomic — server does MP3 PUT + manifest merge in one request).
 *
 * Edit-mode: file picker disabled (no MP3 replacement in 8.7b — see
 *   plan-doc "Nicht im Scope"), label/tags/license/bpm/category editable,
 *   submit → PUT /api/admin/sounds/manifest with a full-manifest copy
 *   containing the edits. Moving an entry between categories is allowed;
 *   the R2 url stays the same (no file move).
 */
export function UploadModal({
  open,
  mode,
  categories,
  existingEntry,
  existingCategoryId,
  onClose,
  onComplete
}: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState(
    existingCategoryId ?? categories[0]?.id ?? ''
  );
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [label, setLabel] = useState(existingEntry?.label ?? '');
  const [tagsRaw, setTagsRaw] = useState(
    (existingEntry?.tags ?? []).join(', ')
  );
  const [license, setLicense] = useState(existingEntry?.license ?? '');
  const [bpm, setBpm] = useState(
    existingEntry?.bpm !== undefined ? String(existingEntry.bpm) : ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset transient state every time the modal opens fresh.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDuration(existingEntry?.duration ?? null);
    setCategoryId(existingCategoryId ?? categories[0]?.id ?? '');
    setNewCategoryMode(false);
    setLabel(existingEntry?.label ?? '');
    setTagsRaw((existingEntry?.tags ?? []).join(', '));
    setLicense(existingEntry?.license ?? '');
    setBpm(existingEntry?.bpm !== undefined ? String(existingEntry.bpm) : '');
    setBusy(false);
    setError(null);
  }, [open, existingEntry, existingCategoryId, categories]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'audio/mpeg') {
      setError('Nur MP3 (audio/mpeg) erlaubt.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Max 10 MB.');
      return;
    }
    setError(null);
    setFile(f);
    if (!label) setLabel(suggestLabelFromFilename(f.name));
    try {
      const d = await measureDuration(f);
      setDuration(d);
    } catch (e) {
      setError(
        'Konnte Audiolänge nicht messen: ' +
          (e instanceof Error ? e.message : 'unknown')
      );
    }
  }

  async function onSubmit() {
    setError(null);
    if (!label.trim()) {
      setError('Label ist erforderlich.');
      return;
    }
    if (!categoryId.trim()) {
      setError('Kategorie ist erforderlich.');
      return;
    }
    if (mode === 'create' && !file) {
      setError('Bitte eine MP3-Datei auswählen.');
      return;
    }
    if (mode === 'create' && (duration === null || !Number.isFinite(duration))) {
      setError('Audiolänge nicht gemessen.');
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      if (mode === 'create') {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('category', categoryId.trim());
        fd.append('label', label.trim());
        fd.append('duration', String(duration));
        if (tags.length > 0) fd.append('tags', JSON.stringify(tags));
        if (license.trim()) fd.append('license', license.trim());
        if (bpm.trim()) fd.append('bpm', bpm.trim());
        const res = await fetch('/api/admin/sounds/upload', {
          method: 'POST',
          body: fd
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            'Upload fehlgeschlagen: ' +
              ((body as { error?: string }).error ?? res.status)
          );
          return;
        }
        // Reload the manifest after the atomic upload + bubble it up.
        const m = await fetch('/api/admin/sounds/manifest');
        if (m.ok) onComplete((await m.json()) as SoundManifest);
        onClose();
        return;
      }
      // Edit mode — PUT a modified copy of the manifest.
      const fetchManifest = await fetch('/api/admin/sounds/manifest');
      if (!fetchManifest.ok) {
        setError('Manifest nicht ladbar.');
        return;
      }
      const manifest = (await fetchManifest.json()) as SoundManifest;
      const updatedManifest = applyEntryEdit({
        manifest,
        entryId: existingEntry!.id,
        sourceCategoryId: existingCategoryId!,
        targetCategoryId: categoryId.trim(),
        edits: {
          label: label.trim(),
          tags,
          license: license.trim() || undefined,
          bpm: bpm.trim() ? Number(bpm) : undefined
        }
      });
      const putRes = await fetch('/api/admin/sounds/manifest', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updatedManifest)
      });
      if (!putRes.ok) {
        const body = await putRes.json().catch(() => ({}));
        setError(
          'Edit fehlgeschlagen: ' +
            ((body as { error?: string }).error ?? putRes.status)
        );
        return;
      }
      const refresh = await fetch('/api/admin/sounds/manifest');
      if (refresh.ok) onComplete((await refresh.json()) as SoundManifest);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? 'Sound hochladen' : 'Sound bearbeiten'}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg max-w-md w-full p-5 space-y-4 text-[var(--text)]">
        <h2 className="text-base font-bold">
          {mode === 'create' ? 'Sound hochladen' : 'Sound bearbeiten'}
        </h2>

        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">Kategorie</span>
            {newCategoryMode ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  placeholder="z. B. braams"
                  className="flex-1 h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
                />
                <button
                  type="button"
                  onClick={() => setNewCategoryMode(false)}
                  className="text-xs px-2 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
                  title="Bestehende Kategorie wählen"
                >
                  ←
                </button>
              </div>
            ) : (
              <div className="flex gap-1">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="flex-1 h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setNewCategoryMode(true);
                    setCategoryId('');
                  }}
                  className="text-xs px-2 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
                  title="Neue Kategorie"
                >
                  + Neu
                </button>
              </div>
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">Datei (MP3)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg"
              disabled={mode === 'edit' || busy}
              onChange={onFilePicked}
              className="block text-xs text-[var(--text)] file:mr-2 file:rounded file:border-0 file:bg-[var(--surface-2)] file:px-2 file:py-1 file:text-xs disabled:opacity-50"
            />
            {file && (
              <span className="text-[10px] text-[var(--text-muted)] font-mono block truncate">
                {file.name}
                {duration !== null && ` · ${duration.toFixed(2)} s`}
              </span>
            )}
            {mode === 'edit' && (
              <span className="text-[10px] text-[var(--text-muted)]">
                MP3-Replacement ist in dieser Version nicht enthalten.
              </span>
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">Label</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">
              Tags (kommagetrennt)
            </span>
            <input
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="dark, cinematic"
              className="w-full h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">Lizenz / Quelle</span>
            <input
              type="text"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="z. B. Freesound CC0"
              className="w-full h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[var(--text-dim)]">
              BPM (optional)
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              className="w-full h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
            />
          </label>
        </div>

        {error && (
          <div className="text-xs text-red-400" role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-[var(--a1)] text-white disabled:opacity-50"
          >
            {busy ? '…' : mode === 'create' ? 'Hochladen' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Test-only — exported pure helper used by the Edit-mode submit path. */
export function applyEntryEdit(args: {
  manifest: SoundManifest;
  entryId: string;
  sourceCategoryId: string;
  targetCategoryId: string;
  edits: {
    label?: string;
    tags?: string[];
    license?: string;
    bpm?: number;
  };
}): SoundManifest {
  const { manifest, entryId, sourceCategoryId, targetCategoryId, edits } = args;
  let movedEntry: SoundEntry | null = null;
  // First pass: remove the entry from its source category.
  const stripped = manifest.categories.map((c) => {
    if (c.id !== sourceCategoryId) return c;
    const next = c.sounds.filter((s) => {
      if (s.id === entryId) {
        movedEntry = { ...s };
        return false;
      }
      return true;
    });
    return { ...c, sounds: next };
  });
  if (!movedEntry) return manifest;
  // Apply edits.
  const edited: SoundEntry = {
    ...(movedEntry as SoundEntry),
    label: edits.label ?? (movedEntry as SoundEntry).label,
    tags: edits.tags && edits.tags.length > 0 ? edits.tags : undefined,
    license: edits.license,
    bpm: edits.bpm
  };
  // Second pass: insert into target category (or create it).
  let inserted = false;
  const next = stripped.map((c) => {
    if (c.id === targetCategoryId) {
      inserted = true;
      return { ...c, sounds: [...c.sounds, edited] };
    }
    return c;
  });
  if (!inserted) {
    next.push({
      id: targetCategoryId,
      label: targetCategoryId[0].toUpperCase() + targetCategoryId.slice(1),
      sounds: [edited]
    });
  }
  return { ...manifest, categories: next };
}
