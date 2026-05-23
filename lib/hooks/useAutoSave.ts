'use client';
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { serializeProject } from '@/lib/project/serialize';
import { apiPatchProject } from '@/lib/project/api-client';

export interface UseAutoSaveOptions {
  debounceMs?: number;
}

/**
 * Plan 7 — debounced auto-save of the current project to the DB.
 *
 * Fires only when a projectId is set (i.e. the project was explicitly
 * saved at least once). New/unsaved projects don't auto-save, so a
 * user experimenting around can't accidentally pin a half-finished
 * draft to their account.
 *
 * Errors are swallowed silently — the explicit Save button shows a
 * toast on failure; auto-save retries on the next state change.
 */
export function useAutoSave(opts: UseAutoSaveOptions = {}): void {
  const debounce = opts.debounceMs ?? 30_000;
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const projectId = useCurrentProject.getState().projectId;
      if (!projectId) return;
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
      pendingTimeout.current = setTimeout(() => {
        apiPatchProject(projectId, { serialized: serializeProject(state) }).catch(() => {
          /* swallow — explicit save surfaces errors */
        });
      }, debounce);
    });
    return () => {
      unsub();
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
    };
  }, [debounce]);
}
