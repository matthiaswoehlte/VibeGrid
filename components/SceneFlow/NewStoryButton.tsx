'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiCreateStory } from '@/lib/sceneflow/api-client';
import type { StoryFormat } from '@/lib/sceneflow/types';

export function NewStoryButton({ onCreated }: { onCreated(): void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<StoryFormat>('16:9');
  const [visualStyle, setVisualStyle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiCreateStory({
        title: title.trim() || 'Untitled Story',
        format,
        visualStyle: visualStyle.trim() || null
      });
      toast.success('Story angelegt');
      setOpen(false);
      setTitle('');
      setVisualStyle('');
      onCreated();
    } catch (e) {
      toast.error('Anlegen fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded"
      >
        + Neue Story
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
          onPointerDown={() => setOpen(false)}
        >
          <form
            onSubmit={submit}
            onPointerDown={(e) => e.stopPropagation()}
            className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 w-96 space-y-3"
          >
            <h3 className="text-sm font-bold text-[var(--text)]">Neue Story</h3>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">Titel</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled Story"
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as StoryFormat)}
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="4:3">4:3</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">
                Visueller Stil (optional)
              </span>
              <input
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                placeholder="cinematisch, warmes Licht ..."
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={busy}
                className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                {busy ? '...' : 'Anlegen'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
