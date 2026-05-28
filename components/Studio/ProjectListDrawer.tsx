'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import {
  apiListProjects,
  apiLoadProject,
  apiDeleteProject
} from '@/lib/project/api-client';
import { applySerializedProject } from '@/lib/project/deserialize';

interface ProjectListDrawerProps {
  open: boolean;
  onClose(): void;
}

export function ProjectListDrawer({ open, onClose }: ProjectListDrawerProps) {
  const [list, setList] = useState<
    Array<{ id: string; name: string; updated_at: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiListProjects()
      .then((r) => setList(r.projects))
      .catch((e) => toast.error('Liste fehlgeschlagen: ' + (e as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  async function load(id: string): Promise<void> {
    try {
      const rec = await apiLoadProject(id);
      // ORDER MATTERS: setProject FIRST so the autosave subscriber that
      // fires inside applySerializedProject sees the new projectId — not
      // the previous one. (useAutoSave also re-reads at fire-time as a
      // belt; this is the suspenders.) Reversing this order silently
      // PATCHed the previously-loaded project with the freshly-loaded
      // one's content 30 s later (Mai 2026 incident).
      useCurrentProject.getState().setProject(rec.id, rec.name);
      applySerializedProject({ store_version: rec.store_version, state: rec.state });
      toast.success('Projekt geladen');
      onClose();
    } catch (e) {
      toast.error('Laden fehlgeschlagen: ' + (e as Error).message);
    }
  }

  async function del(id: string): Promise<void> {
    if (!confirm('Projekt wirklich löschen?')) return;
    try {
      await apiDeleteProject(id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      // Liste NICHT lokal updaten — sonst sieht User leere Liste, lädt
      // neu, Projekt ist wieder da. User-Confusion vermieden.
      return;
    }
    setList((xs) => xs.filter((x) => x.id !== id));
    if (useCurrentProject.getState().projectId === id) {
      useCurrentProject.getState().setProject(null);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50" onPointerDown={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-80 bg-[var(--surface-1)] border-l border-[var(--border)] p-4 overflow-y-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-bold text-[var(--text)] mb-3">Projekte</h2>
        {loading && (
          <div className="text-xs text-[var(--text-dim)]">Lädt...</div>
        )}
        {!loading && list.length === 0 && (
          <div className="text-xs text-[var(--text-dim)]">Noch keine Projekte.</div>
        )}
        <ul className="space-y-1">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between bg-[var(--surface-2)] rounded px-2 py-1"
            >
              <button
                type="button"
                onClick={() => load(p.id)}
                className="text-xs text-[var(--text)] hover:text-[var(--a1)] truncate flex-1 text-left"
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => del(p.id)}
                className="text-xs text-[var(--text-dim)] hover:text-red-400 ml-2"
                title="Löschen"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
