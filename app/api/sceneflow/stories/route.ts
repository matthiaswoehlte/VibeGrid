import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { createStory, listStories } from '@/lib/sceneflow/stories-db';
import type { StoryFormat } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

const VALID_FORMATS: readonly StoryFormat[] = ['16:9', '9:16', '4:3'];

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const list = await listStories(session.user.id);
  return NextResponse.json({ stories: list });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const title =
    typeof b.title === 'string' && b.title.trim() !== '' ? b.title : 'Untitled Story';
  const format = (b.format as StoryFormat | undefined) ?? '16:9';
  if (!VALID_FORMATS.includes(format)) {
    return NextResponse.json({ error: 'invalid format' }, { status: 400 });
  }
  const visualStyle =
    typeof b.visualStyle === 'string' && b.visualStyle.trim() !== ''
      ? b.visualStyle
      : null;
  const id = await createStory({
    userId: session.user.id,
    title,
    format,
    visualStyle
  });
  return NextResponse.json({ id }, { status: 201 });
}
