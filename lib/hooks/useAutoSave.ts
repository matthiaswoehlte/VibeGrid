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
 *
 * **Project-switch race fix (Mai 2026)**: BOTH `projectId` and `state`
 * are re-read AT TIMER-FIRE-TIME (not captured in closure when the
 * subscriber fires). The callsites that mutate the store before
 * switching projects (`ProjectListDrawer.load`, `NewProjectButton`)
 * historically caused the subscriber to capture the OLD projectId
 * paired with the NEW state — silently PATCHing the wrong project 30 s
 * later. By re-reading at fire-time, the autosave always reflects the
 * user's *current* selection (or skips when the project was cleared).
 */
export function useAutoSave(opts: UseAutoSaveOptions = {}): void {
  const debounce = opts.debounceMs ?? 30_000;
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useAppStore.subscribe(() => {
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
      pendingTimeout.current = setTimeout(() => {
        // CRITICAL: read both projectId AND state HERE, not from the
        // subscriber closure. See JSDoc above for the race details.
        const currentProjectId = useCurrentProject.getState().projectId;
        if (!currentProjectId) return;
        const currentState = useAppStore.getState();
        apiPatchProject(currentProjectId, {
          serialized: serializeProject(currentState)
        }).catch(() => {
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
