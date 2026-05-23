import 'server-only';
import { pool } from '@/lib/db/pg';
import type { SerializedProject, ProjectRecord } from './types';

export async function createProject(args: {
  userId: string;
  name: string;
  serialized: SerializedProject;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_projects" (user_id, name, store_version, state)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [args.userId, args.name, args.serialized.store_version, args.serialized.state]
  );
  return rows[0]!.id;
}

export async function listProjects(
  userId: string
): Promise<Array<Pick<ProjectRecord, 'id' | 'name' | 'updated_at'>>> {
  const { rows } = await pool.query<Pick<ProjectRecord, 'id' | 'name' | 'updated_at'>>(
    `SELECT id, name, updated_at FROM "VG_projects"
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function loadProject(args: {
  userId: string;
  projectId: string;
}): Promise<ProjectRecord | null> {
  const { rows } = await pool.query<ProjectRecord>(
    `SELECT id, user_id, name, store_version, state, created_at, updated_at
     FROM "VG_projects" WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [args.projectId, args.userId]
  );
  return rows[0] ?? null;
}

export async function updateProject(args: {
  userId: string;
  projectId: string;
  patch: { name?: string; serialized?: SerializedProject };
}): Promise<boolean> {
  // SET-Builder pattern — clear, easy to review, easy to extend with
  // more patch fields. Order is fixed (serialized fields first, then
  // name) and pinned by tests so future refactors fail loudly if the
  // ordering changes silently.
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;

  if (args.patch.serialized !== undefined) {
    sets.push(`state = $${n++}`);
    vals.push(args.patch.serialized.state);
    sets.push(`store_version = $${n++}`);
    vals.push(args.patch.serialized.store_version);
  }
  if (args.patch.name !== undefined) {
    sets.push(`name = $${n++}`);
    vals.push(args.patch.name);
  }
  if (sets.length === 0) return false; // empty-patch no-op

  vals.push(args.projectId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_projects" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteProject(args: {
  userId: string;
  projectId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_projects" WHERE id = $1 AND user_id = $2`,
    [args.projectId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
