import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { loadStoryUnchecked } from '@/lib/sceneflow/stories-db';
import { loadScenesByStoryUnchecked } from '@/lib/sceneflow/scenes-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import { serializeScenesToEnvelope } from '@/lib/sceneflow/scenes-json';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const story = await loadStoryUnchecked(params.id);
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const scenes = await loadScenesByStoryUnchecked(params.id);
  const characters = await listCharactersByIds(story.user_id, story.characters);

  const envelope = serializeScenesToEnvelope({
    scenes,
    characters,
    model: 'claude-sonnet-4-export'
  });

  const safeTitle = story.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const filename = `${safeTitle || 'storyboard'}_${story.id.slice(0, 8)}.json`;

  return new NextResponse(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    }
  });
}
