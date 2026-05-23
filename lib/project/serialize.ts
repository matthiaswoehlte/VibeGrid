import { toPersistedShape, STORE_VERSION } from '@/lib/store/persist-shape';
import type { AppState } from '@/lib/store/types';
import type { SerializedProject } from './types';

export function serializeProject(state: AppState): SerializedProject {
  return { store_version: STORE_VERSION, state: toPersistedShape(state) };
}
