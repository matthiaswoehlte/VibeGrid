import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { pool } from '@/lib/db/pg';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import { generateScenesViaSonnet } from '@/lib/sceneflow/sonnet';
import { deleteScenesByStory, createScenes } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const storyText = (body as { storyText?: unknown }).storyText;
  if (typeof storyText !== 'string' || storyText.trim().length === 0) {
    return NextResponse.json({ error: 'empty storyText' }, { status: 400 });
  }

  // 1. Story laden + Ownership-Check
  const story = await loadStory({ userId: session.user.id, storyId: params.id });
  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 2. Charaktere der Story laden
  const characters = await listCharactersByIds(session.user.id, story.characters);
  if (characters.length === 0) {
    return NextResponse.json({ error: 'no characters in story' }, { status: 400 });
  }

  // 3. Server-side @Name-Validierung (Defense in Depth)
  const knownNames = new Set(characters.map((c) => c.name.toLowerCase()));
  const referenced = Array.from(storyText.matchAll(/@(\w+)/g)).map((m) =>
    m[1]!.toLowerCase()
  );
  const unknown = referenced.find((n) => !knownNames.has(n));
  if (unknown !== undefined) {
    return NextResponse.json(
      { error: `unknown character @${unknown}` },
      { status: 400 }
    );
  }

  // 4. Sonnet-Call — Fehler hier bedeutet ALTE SZENEN BLEIBEN
  let sonnetResult;
  try {
    sonnetResult = await generateScenesViaSonnet({
      storyText,
      story,
      characters
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[generate-scenes] sonnet error', e);
    return NextResponse.json(
      { error: 'sonnet call failed: ' + (e as Error).message },
      { status: 502 }
    );
  }

  // 5. Token-Usage loggen (Cost-Audit)
  // eslint-disable-next-line no-console
  console.log('[generate-scenes]', {
    storyId: params.id,
    input_tokens: sonnetResult.usage.input_tokens,
    output_tokens: sonnetResult.usage.output_tokens,
    scene_count: sonnetResult.scenes.length
  });

  // 6. Transaktion: DELETE alte + INSERT neue
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteScenesByStory(params.id, client);
    const created = await createScenes(params.id, sonnetResult.scenes, client);
    await client.query('COMMIT');
    return NextResponse.json({ scenes: created });
  } catch (e) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('[generate-scenes] tx error', e);
    return NextResponse.json(
      { error: 'database tx failed: ' + (e as Error).message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
