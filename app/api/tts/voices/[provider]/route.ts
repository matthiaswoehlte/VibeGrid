import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { listEdgeVoices } from '@/lib/tts/edge';
import {
  listElevenLabsVoices,
  ElevenLabsNotConfigured
} from '@/lib/tts/elevenlabs';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { provider: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    if (params.provider === 'edge') {
      const voices = await listEdgeVoices();
      return NextResponse.json({ voices });
    }
    if (params.provider === 'elevenlabs') {
      const voices = await listElevenLabsVoices();
      return NextResponse.json({ voices });
    }
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
  } catch (e) {
    if (e instanceof ElevenLabsNotConfigured) {
      return NextResponse.json(
        { error: 'ELEVENLABS_API_KEY not set on server' },
        { status: 503 }
      );
    }
    // eslint-disable-next-line no-console
    console.error('[tts/voices]', e);
    return NextResponse.json(
      { error: 'voice list failed: ' + (e as Error).message },
      { status: 502 }
    );
  }
}
