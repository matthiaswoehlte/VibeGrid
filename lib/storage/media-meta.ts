import { isClient } from '@/lib/utils/is-client';

export interface ImageMeta {
  width: number;
  height: number;
}
export interface AudioMeta {
  duration: number;
}

export function extractImageMeta(file: File, signal?: AbortSignal): Promise<ImageMeta> {
  if (!isClient()) return Promise.reject(new Error('extractImageMeta: client only'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('extractImageMeta: aborted'));
    };
    img.onload = () => {
      cleanup();
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('extractImageMeta: image failed to load'));
    };
    signal?.addEventListener('abort', onAbort);
    img.src = url;
  });
}

export async function extractAudioMeta(file: File, signal?: AbortSignal): Promise<AudioMeta> {
  if (!isClient()) throw new Error('extractAudioMeta: client only');
  const Ctor = (window as unknown as { AudioContext: typeof AudioContext }).AudioContext;
  const ctx = new Ctor();
  try {
    const buf = await file.arrayBuffer();
    if (signal?.aborted) throw new Error('extractAudioMeta: aborted');
    const audioBuf = await ctx.decodeAudioData(buf);
    return { duration: audioBuf.duration };
  } catch (err) {
    throw new Error(
      `extractAudioMeta: decode failed (${err instanceof Error ? err.message : 'unknown'})`
    );
  } finally {
    await ctx.close?.();
  }
}
