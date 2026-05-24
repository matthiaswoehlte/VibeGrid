import 'server-only';
import { pool } from '@/lib/db/pg';
import type { CharacterRecord, CharacterType, VoiceProvider } from './types';

export interface CreateCharacterInput {
  userId: string;
  name: string;
  type: CharacterType;
  referenceImageUrl: string | null;
  voiceProvider: VoiceProvider | null;
  voiceId: string | null;
  voiceTestText: string | null;
  imagePrompt: string | null;
}

export async function createCharacter(input: CreateCharacterInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_characters"
     (user_id, name, type, reference_image_url, voice_provider, voice_id, voice_test_text, image_prompt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.userId,
      input.name,
      input.type,
      input.referenceImageUrl,
      input.voiceProvider,
      input.voiceId,
      input.voiceTestText,
      input.imagePrompt
    ]
  );
  return rows[0]!.id;
}

export async function listCharacters(userId: string): Promise<CharacterRecord[]> {
  const { rows } = await pool.query<CharacterRecord>(
    `SELECT id, user_id, name, type, reference_image_url, voice_provider,
            voice_id, voice_test_text, image_prompt, created_at, updated_at
     FROM "VG_characters" WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function listCharactersByIds(
  userId: string,
  ids: string[]
): Promise<CharacterRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<CharacterRecord>(
    `SELECT id, user_id, name, type, reference_image_url, voice_provider,
            voice_id, voice_test_text, image_prompt, created_at, updated_at
     FROM "VG_characters"
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids]
  );
  return rows;
}

export interface UpdateCharacterPatch {
  name?: string;
  type?: CharacterType;
  referenceImageUrl?: string | null;
  voiceProvider?: VoiceProvider | null;
  voiceId?: string | null;
  voiceTestText?: string | null;
  imagePrompt?: string | null;
}

export async function updateCharacter(args: {
  userId: string;
  characterId: string;
  patch: UpdateCharacterPatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const p = args.patch;
  if (p.name !== undefined) {
    sets.push(`name = $${n++}`);
    vals.push(p.name);
  }
  if (p.type !== undefined) {
    sets.push(`type = $${n++}`);
    vals.push(p.type);
  }
  if (p.referenceImageUrl !== undefined) {
    sets.push(`reference_image_url = $${n++}`);
    vals.push(p.referenceImageUrl);
  }
  if (p.voiceProvider !== undefined) {
    sets.push(`voice_provider = $${n++}`);
    vals.push(p.voiceProvider);
  }
  if (p.voiceId !== undefined) {
    sets.push(`voice_id = $${n++}`);
    vals.push(p.voiceId);
  }
  if (p.imagePrompt !== undefined) {
    sets.push(`image_prompt = $${n++}`);
    vals.push(p.imagePrompt);
  }
  if (p.voiceTestText !== undefined) {
    sets.push(`voice_test_text = $${n++}`);
    vals.push(p.voiceTestText);
  }
  if (sets.length === 0) return false;

  vals.push(args.characterId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_characters" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteCharacter(args: {
  userId: string;
  characterId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_characters" WHERE id = $1 AND user_id = $2`,
    [args.characterId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
