import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { synthesizeEdge } from '@/lib/tts/edge';
import { synthesizeElevenLabs, ElevenLabsNotConfigured } from '@/lib/tts/elevenlabs';

export const runtime = 'nodejs';

const MAX_TEXT_LEN = 500;
const PROVIDERS = ['edge', 'elevenlabs'] as const;
type Provider = (typeof PROVIDERS)[number];

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as { provider?: unknown; voiceId?: unknown; text?: unknown };
  const provider = b.provider;
  const voiceId = b.voiceId;
  const text = b.text;
  if (
    typeof provider !== 'string' ||
    !PROVIDERS.includes(provider as Provider)
  ) {
    return NextResponse.json({ error: 'invalid provider' }, { status: 400 });
  }
  if (typeof voiceId !== 'string' || voiceId.trim().length === 0) {
    return NextResponse.json({ error: 'invalid voiceId' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'empty text' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json(
      { error: `text too long (max ${MAX_TEXT_LEN} chars)` },
      { status: 400 }
    );
  }

  try {
    const audio =
      provider === 'edge'
        ? await synthesizeEdge({ voiceId, text })
        : await synthesizeElevenLabs({ voiceId, text });
    return new Response(audio, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    if (e instanceof ElevenLabsNotConfigured) {
      return NextResponse.json(
        { error: 'ELEVENLABS_API_KEY not set on server' },
        { status: 503 }
      );
    }
    // eslint-disable-next-line no-console
    console.error('[tts/preview] synth error', e);
    return NextResponse.json(
      { error: 'tts synthesis failed: ' + (e as Error).message },
      { status: 502 }
    );
  }
}
