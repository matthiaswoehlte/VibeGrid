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

export async function listStories(userId: string): Promise<StoryRecord[]> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT id, user_id, title, format, visual_style, status, created_at, updated_at
     FROM "VG_stories" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
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
