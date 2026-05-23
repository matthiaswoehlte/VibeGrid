import type { PersistedShape } from '@/lib/store/persist-shape';

/**
 * Wire format for VG_projects.state — what travels between the client,
 * the API routes, and the DB JSONB column.
 */
export interface SerializedProject {
  store_version: number;
  state: PersistedShape;
}

/**
 * Shape of a row in VG_projects, returned by the load endpoint.
 */
export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  store_version: number;
  state: PersistedShape;
  created_at: string;
  updated_at: string;
}
