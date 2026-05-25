import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';
import { advanceSceneRender } from '@/lib/sceneflow/render-pipeline';
import { readBalance } from '@/lib/credits/credits';

export const runtime = 'nodejs';

/**
 * Batch status endpoint [Fix N2]. The Storyboard polls this every few
 * seconds instead of N parallel /scenes/[id]/status calls — keeps the
 * polling cost linear in stories, not in scenes.
 */
export async function GET(
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

  // Only advance scenes that have outstanding work. Endcards stay 'done'.
  const targets = scenes.filter(
    (s) =>
      s.status !== 'done' &&
      (s.fal_request_ids !== null ||
        s.image_url === null ||
        (s.type === 'dialog' && s.neutral_video_url === null) ||
        s.video_url === null)
  );

  const results = await Promise.allSettled(
    targets.map((scene) => advanceSceneRender({ scene, story }))
  );

  const payload = results.map((r, i) => {
    const sceneId = targets[i]!.id;
    if (r.status === 'fulfilled') return r.value;
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return {
      sceneId,
      status: 'error' as const,
      imageUrl: null,
      audioUrl: null,
      neutralVideoUrl: null,
      videoUrl: null,
      step: 'image' as const,
      error: msg
    };
  });

  // Plan 8.5 [Fix D4] — piggyback the balance so the SceneFlow header
  // CreditDisplay refreshes on the same 4-s polling tick. readBalance is
  // SELECT-only (no UPSERT) so hot-path polling stays cheap.
  const balance = await readBalance(session.user.id);

  return NextResponse.json({ scenes: payload, balance });
}
