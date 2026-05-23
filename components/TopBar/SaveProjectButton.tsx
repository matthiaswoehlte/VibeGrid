'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { apiCreateProject, apiPatchProject } from '@/lib/project/api-client';
import { serializeProject } from '@/lib/project/serialize';

export function SaveProjectButton() {
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    const state = useAppStore.getState();
    const cur = useCurrentProject.getState();
    try {
      if (cur.projectId === null) {
        const { id } = await apiCreateProject(cur.projectName, serializeProject(state));
        useCurrentProject.getState().setProject(id, cur.projectName);
        toast.success('Projekt gespeichert');
      } else {
        await apiPatchProject(cur.projectId, { serialized: serializeProject(state) });
        toast.success('Gespeichert');
      }
    } catch (e) {
      toast.error('Speichern fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onSave}
      disabled={busy}
      className="h-7 px-3 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--a1)] text-white hover:opacity-90 disabled:opacity-50"
      title="Save project"
    >
      {busy ? '...' : 'Save'}
    </button>
  );
}
