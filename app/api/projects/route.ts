import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { createProject, listProjects } from '@/lib/project/db';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const list = await listProjects(session.user.id);
  return NextResponse.json({ projects: list });
}

export async function POST(req: Request): Promise<Response> {
  console.log('[api/projects POST] cookies header present?', !!req.headers.get('cookie'));
  console.log('[api/projects POST] cookie header sample:', req.headers.get('cookie')?.slice(0, 80));
  const session = await auth.api.getSession({ headers: req.headers });
  console.log('[api/projects POST] session=', session ? `user=${session.user.id}` : 'null');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    console.warn('[api/projects POST] invalid json', e);
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    typeof (body as { serialized?: unknown }).serialized !== 'object' ||
    (body as { serialized?: unknown }).serialized === null
  ) {
    console.warn('[api/projects POST] invalid body shape');
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { name, serialized } = body as {
    name: string;
    serialized: Parameters<typeof createProject>[0]['serialized'];
  };
  try {
    const id = await createProject({ userId: session.user.id, name, serialized });
    console.log('[api/projects POST] inserted id=', id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    console.error('[api/projects POST] createProject threw', e);
    return NextResponse.json({ error: 'db error: ' + (e as Error).message }, { status: 500 });
  }
}
