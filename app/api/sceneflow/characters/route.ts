import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { createCharacter, listCharacters } from '@/lib/sceneflow/characters-db';
import type { CharacterType, VoiceProvider } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const list = await listCharacters(session.user.id);
  return NextResponse.json({ characters: list });
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
  const b = body as Record<string, unknown>;
  if (typeof b?.name !== 'string' || b.name.trim() === '') {
    return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  }
  if (b.type !== 'person' && b.type !== 'group') {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const id = await createCharacter({
    userId: session.user.id,
    name: b.name,
    type: b.type as CharacterType,
    referenceImageUrl: (b.referenceImageUrl as string | null | undefined) ?? null,
    voiceProvider: (b.voiceProvider as VoiceProvider | null | undefined) ?? null,
    voiceId: (b.voiceId as string | null | undefined) ?? null,
    voiceTestText: (b.voiceTestText as string | null | undefined) ?? null,
    imagePrompt: (b.imagePrompt as string | null | undefined) ?? null
  });
  return NextResponse.json({ id }, { status: 201 });
}
