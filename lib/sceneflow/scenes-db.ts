import 'server-only';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pg';
import type { SceneRecord, CameraControl } from './types';

const SCENE_INSERT_COLS = [
  'story_id',
  'scene_order',
  'type',
  'image_prompt',
  'motion_prompt',
  'camera_control',
  'duration',
  'audio_type',
  'tts_text',
  'speaking_character_id',
  'transition',
  'start_frame_mode',
  'status',
  'fal_request_ids'
] as const;

export interface NewSceneInput {
  scene_order: number;
  type: SceneRecord['type'];
  image_prompt: string;
  motion_prompt: string;
  camera_control: CameraControl | null;
  duration: number;
  audio_type: SceneRecord['audio_type'];
  tts_text: string | null;
  speaking_character_id: string | null;
  transition: SceneRecord['transition'];
  start_frame_mode: SceneRecord['start_frame_mode'];
  status: SceneRecord['status'];
  fal_request_ids: Record<string, string> | null;
}

export async function createScenes(
  storyId: string,
  scenes: NewSceneInput[],
  txClient?: PoolClient
): Promise<SceneRecord[]> {
  if (scenes.length === 0) return [];
  const cols = SCENE_INSERT_COLS;
  const placeholders = scenes
    .map((_, i) => {
      const base = i * cols.length;
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    })
    .join(', ');
  const values = scenes.flatMap((s) => [
    storyId,
    s.scene_order,
    s.type,
    s.image_prompt,
    s.motion_prompt,
    s.camera_control === null ? null : JSON.stringify(s.camera_control),
    s.duration,
    s.audio_type,
    s.tts_text,
    s.speaking_character_id,
    s.transition,
    s.start_frame_mode,
    s.status,
    s.fal_request_ids === null ? null : JSON.stringify(s.fal_request_ids)
  ]);
  const sql = `INSERT INTO "VG_story_scenes" (${cols.join(', ')})
               VALUES ${placeholders} RETURNING *`;
  const q = txClient ?? pool;
  const { rows } = await q.query<SceneRecord>(sql, values);
  return rows;
}

const SCENE_SELECT_COLS = `s.id, s.story_id, s.scene_order, s.type, s.image_prompt,
            s.motion_prompt, s.camera_control, s.duration, s.audio_type,
            s.tts_text, s.speaking_character_id, s.transition,
            s.start_frame_mode, s.start_frame_url, s.image_url,
            s.video_url, s.audio_url, s.neutral_video_url, s.end_frame_url, s.status,
            s.error_message, s.fal_request_ids, s.created_at, s.updated_at`;

export async function listScenes(
  userId: string,
  storyId: string
): Promise<SceneRecord[]> {
  const { rows } = await pool.query<SceneRecord>(
    `SELECT ${SCENE_SELECT_COLS}
     FROM "VG_story_scenes" s
     JOIN "VG_stories" st ON s.story_id = st.id
     WHERE st.id = $1 AND st.user_id = $2
     ORDER BY s.scene_order ASC`,
    [storyId, userId]
  );
  return rows;
}

/**
 * Server-internal scene loader for the render pipeline. Skips the
 * user_id scope check — callers MUST validate ownership upstream
 * (via loadStory). Used by API routes that operate by scene id and
 * already enforced session+ownership at the route boundary.
 */
export async function loadSceneById(sceneId: string): Promise<SceneRecord | null> {
  const { rows } = await pool.query<SceneRecord>(
    `SELECT ${SCENE_SELECT_COLS} FROM "VG_story_scenes" s WHERE s.id = $1`,
    [sceneId]
  );
  return rows[0] ?? null;
}

export async function loadScenesByStoryUnchecked(
  storyId: string
): Promise<SceneRecord[]> {
  const { rows } = await pool.query<SceneRecord>(
    `SELECT ${SCENE_SELECT_COLS} FROM "VG_story_scenes" s
     WHERE s.story_id = $1 ORDER BY s.scene_order ASC`,
    [storyId]
  );
  return rows;
}

export interface UpdateScenePatch {
  type?: SceneRecord['type'];
  image_prompt?: string;
  motion_prompt?: string;
  camera_control?: CameraControl | null;
  duration?: number;
  audio_type?: SceneRecord['audio_type'];
  tts_text?: string | null;
  speaking_character_id?: string | null;
  transition?: SceneRecord['transition'];
  start_frame_mode?: SceneRecord['start_frame_mode'];
}

const UPDATABLE_FIELDS: ReadonlyArray<keyof UpdateScenePatch> = [
  'type',
  'image_prompt',
  'motion_prompt',
  'camera_control',
  'duration',
  'audio_type',
  'tts_text',
  'speaking_character_id',
  'transition',
  'start_frame_mode'
];

export async function updateScene(args: {
  userId: string;
  sceneId: string;
  patch: UpdateScenePatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  for (const k of UPDATABLE_FIELDS) {
    const v = args.patch[k];
    if (v === undefined) continue;
    if (k === 'camera_control') {
      sets.push(`${k} = $${n++}::jsonb`);
      vals.push(v === null ? null : JSON.stringify(v));
    } else {
      sets.push(`${k} = $${n++}`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  const sceneIdParam = n++;
  const userIdParam = n;
  vals.push(args.sceneId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_story_scenes" s
     SET ${sets.join(', ')}, updated_at = now()
     FROM "VG_stories" st
     WHERE s.id = $${sceneIdParam}
       AND s.story_id = st.id
       AND st.user_id = $${userIdParam}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Plan 8c — server-internal render-pipeline patch.
 *
 * Lets the API status route / render orchestrator set generated URLs +
 * status + the JSONB fal_request_ids map without going through the user-
 * scoped updateScene path (which intentionally doesn't expose these fields
 * to the client). Optional idempotency guards apply NULL-only updates so a
 * second poll doesn't race a first.
 */
export interface RenderUpdatePatch {
  image_url?: string;
  audio_url?: string;
  neutral_video_url?: string;
  video_url?: string;
  status?: SceneRecord['status'];
  error_message?: string | null;
  fal_request_ids?: Record<string, string> | null;
}

export interface RenderUpdateOptions {
  /** If true, only apply image_url/audio_url/neutral_video_url/video_url
   *  when the current value is NULL — prevents two parallel pollers from
   *  triggering double-uploads. */
  onlyIfNull?: boolean;
}

export async function patchSceneRender(
  sceneId: string,
  patch: RenderUpdatePatch,
  options: RenderUpdateOptions = {}
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const nullGuards: string[] = [];
  const urlFields: Array<keyof RenderUpdatePatch> = [
    'image_url',
    'audio_url',
    'neutral_video_url',
    'video_url'
  ];

  for (const field of urlFields) {
    const v = patch[field];
    if (v === undefined) continue;
    sets.push(`${field} = $${n++}`);
    vals.push(v);
    if (options.onlyIfNull) nullGuards.push(`${field} IS NULL`);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${n++}`);
    vals.push(patch.status);
  }
  if (patch.error_message !== undefined) {
    sets.push(`error_message = $${n++}`);
    vals.push(patch.error_message);
  }
  if (patch.fal_request_ids !== undefined) {
    sets.push(`fal_request_ids = $${n++}::jsonb`);
    vals.push(
      patch.fal_request_ids === null ? null : JSON.stringify(patch.fal_request_ids)
    );
  }
  if (sets.length === 0) return false;
  const sceneIdParam = n++;
  vals.push(sceneId);
  const where = nullGuards.length > 0
    ? `id = $${sceneIdParam} AND (${nullGuards.join(' OR ')})`
    : `id = $${sceneIdParam}`;
  const { rowCount } = await pool.query(
    `UPDATE "VG_story_scenes" SET ${sets.join(', ')}, updated_at = now() WHERE ${where}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Atomically claim the lipsync queue slot for a dialog scene. Uses
 * Postgres' JSONB ->> operator to test that fal_request_ids->>'lipsync'
 * IS NULL before writing, so two parallel pollers can't both submit a
 * second-step lipsync job.
 *
 * Returns true if THIS caller claimed the slot (and must now submit the
 * job and write back the request_id). Returns false if another poller
 * already claimed it.
 *
 * Limitation: this relies on Postgres JSONB syntax — see KNOWN_LIMITATIONS.md.
 */
export async function setNeutralVideoUrlAndClaimLipsync(args: {
  sceneId: string;
  neutralVideoUrl: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE "VG_story_scenes"
     SET neutral_video_url = $1, updated_at = now()
     WHERE id = $2
       AND neutral_video_url IS NULL
       AND (fal_request_ids->>'lipsync' IS NULL)`,
    [args.neutralVideoUrl, args.sceneId]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteScene(args: {
  userId: string;
  sceneId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_story_scenes" s
     USING "VG_stories" st
     WHERE s.id = $1 AND s.story_id = st.id AND st.user_id = $2`,
    [args.sceneId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteScenesByStory(
  storyId: string,
  txClient?: PoolClient
): Promise<void> {
  const q = txClient ?? pool;
  await q.query(`DELETE FROM "VG_story_scenes" WHERE story_id = $1`, [storyId]);
}

/**
 * Atomar `scene_order` zwischen zwei Szenen tauschen.
 * Beide Szenen müssen demselben User UND derselben Story gehören.
 */
export async function swapSceneOrder(args: {
  userId: string;
  aId: string;
  bId: string;
}): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      scene_order: number;
      story_id: string;
    }>(
      `SELECT s.id, s.scene_order, s.story_id
       FROM "VG_story_scenes" s
       JOIN "VG_stories" st ON s.story_id = st.id
       WHERE s.id = ANY($1::uuid[]) AND st.user_id = $2`,
      [[args.aId, args.bId], args.userId]
    );
    if (rows.length !== 2 || rows[0]!.story_id !== rows[1]!.story_id) {
      await client.query('ROLLBACK');
      return false;
    }
    const a = rows.find((r) => r.id === args.aId)!;
    const b = rows.find((r) => r.id === args.bId)!;
    await client.query(
      `UPDATE "VG_story_scenes" SET scene_order = $1 WHERE id = $2`,
      [b.scene_order, a.id]
    );
    await client.query(
      `UPDATE "VG_story_scenes" SET scene_order = $1 WHERE id = $2`,
      [a.scene_order, b.id]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
