import 'server-only';
import { MsEdgeTTS, OUTPUT_FORMAT, type Voice } from 'msedge-tts';

/**
 * Cached Edge voice catalog. msedge-tts fetches the canonical list from
 * Microsoft on first call. We hold it in process memory for an hour —
 * the list barely changes day-to-day, no point hammering Bing on every
 * picker mount.
 */
let cachedVoices: { at: number; voices: Voice[] } | null = null;
const VOICE_TTL_MS = 60 * 60 * 1000; // 1h

export interface NormalizedVoice {
  id: string;          // ShortName, e.g. 'de-DE-KillianNeural'
  name: string;        // FriendlyName without "Microsoft" prefix
  locale: string;      // e.g. 'de-DE'
  gender: 'Male' | 'Female' | 'Unknown';
}

function normalize(v: Voice): NormalizedVoice {
  // FriendlyName looks like "Microsoft Killian Online (Natural) - German (Germany)".
  // We want a short label — use the first segment after "Microsoft ".
  const friendly = v.FriendlyName.replace(/^Microsoft\s+/, '');
  const name = friendly.split(' Online')[0] ?? friendly;
  const gender =
    v.Gender === 'Male' || v.Gender === 'Female' ? v.Gender : 'Unknown';
  return {
    id: v.ShortName,
    name,
    locale: v.Locale,
    gender
  };
}

export async function listEdgeVoices(): Promise<NormalizedVoice[]> {
  const now = Date.now();
  if (cachedVoices && now - cachedVoices.at < VOICE_TTL_MS) {
    return cachedVoices.voices.map(normalize);
  }
  const tts = new MsEdgeTTS();
  const voices = await tts.getVoices();
  cachedVoices = { at: now, voices };
  return voices.map(normalize);
}

/**
 * Synthesize text → MP3 Buffer via Edge TTS. Resolves once the WebSocket
 * stream completes. No SSML — plain text. Auto-closes the socket.
 */
export async function synthesizeEdge(args: {
  voiceId: string;
  text: string;
}): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(args.voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(args.text);
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => {
      tts.close();
      resolve(Buffer.concat(chunks));
    });
    audioStream.on('error', (e: unknown) => {
      tts.close();
      reject(e);
    });
  });
}

/** Test-only: drop the cached voice list. */
export function _resetEdgeVoiceCacheForTests(): void {
  cachedVoices = null;
}
