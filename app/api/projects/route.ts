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
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    typeof (body as { serialized?: unknown }).serialized !== 'object' ||
    (body as { serialized?: unknown }).serialized === null
  ) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { name, serialized } = body as {
    name: string;
    serialized: Parameters<typeof createProject>[0]['serialized'];
  };
  const id = await createProject({ userId: session.user.id, name, serialized });
  return NextResponse.json({ id }, { status: 201 });
}
