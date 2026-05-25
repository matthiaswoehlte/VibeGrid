import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';
import { enqueueVideoJobs } from '@/lib/sceneflow/render-pipeline';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const story = await loadStory({
    userId: session.user.id,
    storyId: params.id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const scenes = await listScenes(session.user.id, params.id);
  // Phase 1 must be complete for non-endcard scenes: each needs an image_url.
  const missingImage = scenes.find(
    (s) => s.type !== 'endcard' && s.image_url === null
  );
  if (missingImage) {
    return NextResponse.json(
      {
        error: 'phase-1-incomplete',
        message: 'Some scenes still need image generation (Phase 1)'
      },
      { status: 400 }
    );
  }

  const results = await enqueueVideoJobs({ story, scenes });
  const enqueued = results.filter((r) => r.ok).length;
  return NextResponse.json({ enqueued, results });
}
