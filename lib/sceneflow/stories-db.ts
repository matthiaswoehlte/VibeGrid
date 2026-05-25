import 'server-only';
import { pool } from '@/lib/db/pg';
import type { StoryRecord, StoryFormat } from './types';

export interface CreateStoryInput {
  userId: string;
  title: string;
  format: StoryFormat;
  visualStyle: string | null;
}

export async function createStory(input: CreateStoryInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_stories" (user_id, title, format, visual_style)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.userId, input.title, input.format, input.visualStyle]
  );
  return rows[0]!.id;
}

const STORY_SELECT_COLS = `id, user_id, title, format, visual_style, status,
            characters, story_text, image_model, video_model, lipsync_model,
            credit_budget, created_at, updated_at`;

export async function listStories(userId: string): Promise<StoryRecord[]> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT ${STORY_SELECT_COLS}
     FROM "VG_stories" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function loadStory(args: {
  userId: string;
  storyId: string;
}): Promise<StoryRecord | null> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT ${STORY_SELECT_COLS}
     FROM "VG_stories" WHERE id = $1 AND user_id = $2`,
    [args.storyId, args.userId]
  );
  return rows[0] ?? null;
}

/** Server-internal story loader without ownership scope — for render-pipeline
 *  routes that already enforce auth+ownership upstream by scene id. */
export async function loadStoryUnchecked(storyId: string): Promise<StoryRecord | null> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT ${STORY_SELECT_COLS} FROM "VG_stories" WHERE id = $1`,
    [storyId]
  );
  return rows[0] ?? null;
}

export interface UpdateStoryPatch {
  title?: string;
  format?: StoryFormat;
  visualStyle?: string | null;
  characters?: string[];
  storyText?: string | null;
  imageModel?: string;
  videoModel?: string;
  lipsyncModel?: string;
  creditBudget?: number | null;
}

export async function updateStory(args: {
  userId: string;
  storyId: string;
  patch: UpdateStoryPatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const p = args.patch;
  if (p.title !== undefined) { sets.push(`title = $${n++}`); vals.push(p.title); }
  if (p.format !== undefined) { sets.push(`format = $${n++}`); vals.push(p.format); }
  if (p.visualStyle !== undefined) {
    sets.push(`visual_style = $${n++}`); vals.push(p.visualStyle);
  }
  if (p.characters !== undefined) {
    sets.push(`characters = $${n++}::jsonb`); vals.push(JSON.stringify(p.characters));
  }
  if (p.storyText !== undefined) {
    sets.push(`story_text = $${n++}`); vals.push(p.storyText);
  }
  if (p.imageModel !== undefined) {
    sets.push(`image_model = $${n++}`); vals.push(p.imageModel);
  }
  if (p.videoModel !== undefined) {
    sets.push(`video_model = $${n++}`); vals.push(p.videoModel);
  }
  if (p.lipsyncModel !== undefined) {
    sets.push(`lipsync_model = $${n++}`); vals.push(p.lipsyncModel);
  }
  if (p.creditBudget !== undefined) {
    sets.push(`credit_budget = $${n++}`); vals.push(p.creditBudget);
  }
  if (sets.length === 0) return false;
  const sceneIdParam = n++;
  const userIdParam = n;
  vals.push(args.storyId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_stories" SET ${sets.join(', ')} WHERE id = $${sceneIdParam} AND user_id = $${userIdParam}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteStory(args: {
  userId: string;
  storyId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_stories" WHERE id = $1 AND user_id = $2`,
    [args.storyId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
