import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { deleteStory, updateStory } from '@/lib/sceneflow/stories-db';
import type { UpdateStoryPatch } from '@/lib/sceneflow/stories-db';

export const runtime = 'nodejs';

const VALID_FORMATS = ['16:9', '9:16', '4:3'] as const;

export async function PATCH(
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
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const patch: UpdateStoryPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.format === 'string') {
    if (!VALID_FORMATS.includes(b.format as (typeof VALID_FORMATS)[number])) {
      return NextResponse.json({ error: 'invalid format' }, { status: 400 });
    }
    patch.format = b.format as UpdateStoryPatch['format'];
  }
  if ('visualStyle' in b) {
    patch.visualStyle =
      typeof b.visualStyle === 'string' ? b.visualStyle : null;
  }
  if (Array.isArray(b.characters)) {
    if (b.characters.some((c) => typeof c !== 'string')) {
      return NextResponse.json({ error: 'invalid characters' }, { status: 400 });
    }
    patch.characters = b.characters as string[];
  }
  if ('storyText' in b) {
    patch.storyText =
      typeof b.storyText === 'string' ? b.storyText : null;
  }
  if (typeof b.imageModel === 'string') patch.imageModel = b.imageModel;
  if (typeof b.videoModel === 'string') patch.videoModel = b.videoModel;
  if (typeof b.lipsyncModel === 'string') patch.lipsyncModel = b.lipsyncModel;

  const ok = await updateStory({
    userId: session.user.id,
    storyId: params.id,
    patch
  });
  if (!ok) return NextResponse.json({ error: 'not found or unchanged' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteStory({ userId: session.user.id, storyId: params.id });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
