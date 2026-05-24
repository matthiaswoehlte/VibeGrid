import 'server-only';

const VOICES_URL = 'https://api.elevenlabs.io/v1/voices';
const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_TTL_MS = 60 * 60 * 1000; // 1h

export interface ElevenLabsVoice {
  id: string;          // voice_id, e.g. '21m00Tcm4TlvDq8ikWAM'
  name: string;        // "Rachel"
  category: string;    // 'premade' | 'cloned' | ...
  description: string | null;
  labels: Record<string, string>; // { accent, age, gender, use case }
}

interface ElevenLabsApiVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
}

interface VoiceListResponse {
  voices: ElevenLabsApiVoice[];
}

let cache: { at: number; voices: ElevenLabsVoice[] } | null = null;

export class ElevenLabsNotConfigured extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY is not set');
    this.name = 'ElevenLabsNotConfigured';
  }
}

function apiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k || k.trim().length === 0) throw new ElevenLabsNotConfigured();
  return k;
}

function normalize(v: ElevenLabsApiVoice): ElevenLabsVoice {
  return {
    id: v.voice_id,
    name: v.name,
    category: v.category ?? 'unknown',
    description: v.description ?? null,
    labels: v.labels ?? {}
  };
}

export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  const now = Date.now();
  if (cache && now - cache.at < VOICE_TTL_MS) return cache.voices;
  const key = apiKey();
  const res = await fetch(VOICES_URL, {
    headers: { 'xi-api-key': key, accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs voices fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as VoiceListResponse;
  const voices = (data.voices ?? []).map(normalize);
  cache = { at: now, voices };
  return voices;
}

/**
 * Synthesize text → MP3 Buffer via ElevenLabs.
 *
 * Uses the eleven_multilingual_v2 model and the default voice settings.
 * Output: audio/mpeg.
 */
export async function synthesizeElevenLabs(args: {
  voiceId: string;
  text: string;
}): Promise<Buffer> {
  const key = apiKey();
  const url = `${TTS_URL}/${encodeURIComponent(args.voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'content-type': 'application/json',
      accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: args.text,
      model_id: 'eleven_multilingual_v2'
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Test-only: drop the cached voice list. */
export function _resetElevenLabsCacheForTests(): void {
  cache = null;
}
