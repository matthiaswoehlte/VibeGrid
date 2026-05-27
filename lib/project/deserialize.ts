import { migrate, useAppStore } from '@/lib/store';
import type { AppState } from '@/lib/store/types';
import type { SerializedProject } from './types';

/**
 * Apply a DB-loaded project to the Zustand store. Re-uses the existing
 * `migrate` chain (`lib/store/index.ts:14`) so a v4 snapshot from the
 * DB hydrates as a current-version v6 state. Transient ui/media fields
 * not present in the payload survive untouched.
 */
export function applySerializedProject(serialized: SerializedProject): void {
  const migrated = (migrate(serialized.state, serialized.store_version) ??
    serialized.state) as Partial<AppState>;
  // Plan 10 — skip:true because project hydration is not a user action
  // and must not appear in the Undo stack. clearHistory() then wipes
  // the previous project's stack so Ctrl+Z can't reach back across
  // project boundaries (architect L3).
  useAppStore.getState().recordingSet(
    'Load Project',
    (s) => {
      if (migrated.ui) Object.assign(s.ui, migrated.ui);
      if (migrated.timeline) Object.assign(s.timeline, migrated.timeline);
      if (migrated.audio) Object.assign(s.audio, migrated.audio);
      if (migrated.media) Object.assign(s.media, migrated.media);
    },
    { skip: true }
  );
  useAppStore.getState().clearHistory();
}
