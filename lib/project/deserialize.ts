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
  useAppStore.setState((current) => ({
    ...current,
    ui: { ...current.ui, ...(migrated.ui ?? {}) },
    timeline: { ...current.timeline, ...(migrated.timeline ?? {}) },
    audio: { ...current.audio, ...(migrated.audio ?? {}) },
    media: { ...current.media, ...(migrated.media ?? {}) }
  }));
}
