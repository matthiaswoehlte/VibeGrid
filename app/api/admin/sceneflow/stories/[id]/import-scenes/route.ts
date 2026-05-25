import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { loadStoryUnchecked } from '@/lib/sceneflow/stories-db';
import {
  deleteScenesByStory,
  createScenes
} from '@/lib/sceneflow/scenes-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import {
  parseScenesEnvelope,
  portableToNewSceneInputs,
  ScenesImportError
} from '@/lib/sceneflow/scenes-json';
import { pool } from '@/lib/db/pg';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const story = await loadStoryUnchecked(params.id);
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const characters = await listCharactersByIds(story.user_id, story.characters);

  let parsed;
  try {
    parsed = parseScenesEnvelope({
      envelope: body,
      storyCharacterNames: characters.map((c) => c.name)
    });
  } catch (e) {
    if (e instanceof ScenesImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const newScenes = portableToNewSceneInputs(parsed.scenes, characters);

  // Replace scenes in a single transaction — same pattern as
  // generate-scenes so a partial failure doesn't leave half a story.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteScenesByStory(params.id, client);
    const created = await createScenes(params.id, newScenes, client);
    await client.query('COMMIT');
    return NextResponse.json({
      scenes: created,
      unknownCharacterNames: parsed.unknownCharacterNames
    });
  } catch (e) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('[import-scenes] tx error', e);
    return NextResponse.json(
      { error: 'database tx failed: ' + (e as Error).message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
