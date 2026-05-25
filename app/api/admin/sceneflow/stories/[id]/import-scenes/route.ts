import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { loadStoryUnchecked, updateStory } from '@/lib/sceneflow/stories-db';
import {
  deleteScenesByStory,
  createScenes
} from '@/lib/sceneflow/scenes-db';
import { listCharacters } from '@/lib/sceneflow/characters-db';
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

  // Look at ALL of the story owner's global characters — not just those
  // already in story.characters[]. If the JSON references a name that
  // exists globally (e.g. "Rider"), we auto-add it to the story below.
  // Saves the user a separate trip through StorySetupForm's picker.
  const allUserCharacters = await listCharacters(story.user_id);

  let parsed;
  try {
    parsed = parseScenesEnvelope({
      envelope: body,
      storyCharacterNames: allUserCharacters.map((c) => c.name)
    });
  } catch (e) {
    if (e instanceof ScenesImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // Auto-add globally-known characters that the JSON references but
  // aren't yet in story.characters[]. Names that don't exist anywhere
  // surface in parsed.unknownCharacterNames so the UI can warn.
  const storyCharSet = new Set(story.characters);
  const idByName = new Map(allUserCharacters.map((c) => [c.name, c.id]));
  const referenced = new Set(
    parsed.scenes
      .map((s) => s.speaking_character)
      .filter((n): n is string => n !== null)
  );
  const autoAdded: string[] = [];
  for (const name of referenced) {
    const id = idByName.get(name);
    if (id && !storyCharSet.has(id)) {
      storyCharSet.add(id);
      autoAdded.push(name);
    }
  }
  if (autoAdded.length > 0) {
    await updateStory({
      userId: story.user_id,
      storyId: story.id,
      patch: { characters: Array.from(storyCharSet) }
    });
  }

  // Build the full mapping using every character now in story.characters[]
  // (including the just-auto-added ones). Unknown names (not in any
  // global character) stay unmapped → speaking_character_id = null.
  const inStoryCharacters = allUserCharacters.filter((c) =>
    storyCharSet.has(c.id)
  );
  const newScenes = portableToNewSceneInputs(parsed.scenes, inStoryCharacters);

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
      autoAddedCharacterNames: autoAdded,
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
