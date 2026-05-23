'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { apiPatchProject } from '@/lib/project/api-client';

export function ProjectNameField() {
  const projectId = useCurrentProject((s) => s.projectId);
  const name = useCurrentProject((s) => s.projectName);
  const setName = useCurrentProject((s) => s.setProjectName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  async function commit() {
    setEditing(false);
    const trimmed = draft.trim() || 'Untitled Project';
    setName(trimmed);
    if (projectId) {
      try {
        await apiPatchProject(projectId, { name: trimmed });
      } catch (e) {
        toast.error('Umbenennen fehlgeschlagen: ' + (e as Error).message);
      }
    }
  }

  return editing ? (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setEditing(false);
          setDraft(name);
        }
      }}
      className="text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-0.5 text-[var(--text)] w-40"
    />
  ) : (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Projekt umbenennen"
      className="text-sm text-[var(--text)] hover:text-[var(--a1)] truncate max-w-[200px]"
    >
      {name}
    </button>
  );
}
