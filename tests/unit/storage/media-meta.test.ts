import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractImageMeta, extractAudioMeta } from '@/lib/storage/media-meta';

// jsdom does not implement URL.createObjectURL or Blob.arrayBuffer. Stub both.
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = (_b: Blob) => 'blob:stub';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = (_u: string) => undefined;
  }
});

function fileWithBuffer(name: string, type: string, bytes: Uint8Array): File {
  const f = new File([bytes], name, { type });
  // jsdom's File extends Blob but lacks .arrayBuffer(); patch per-instance.
  if (typeof f.arrayBuffer !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f as any).arrayBuffer = async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  }
  return f;
}

describe('extractImageMeta', () => {
  it('returns width and height from a valid image File', async () => {
    const file = fileWithBuffer('x.jpg', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const origImage = window.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1920;
      naturalHeight = 1080;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Image = StubImage;
    try {
      const meta = await extractImageMeta(file);
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
    } finally {
      window.Image = origImage;
    }
  });

  it('rejects when the Image element errors', async () => {
    const file = fileWithBuffer('bad.jpg', 'image/jpeg', new Uint8Array([0]));
    const origImage = window.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Image = StubImage;
    try {
      await expect(extractImageMeta(file)).rejects.toThrow(/image/i);
    } finally {
      window.Image = origImage;
    }
  });
});

describe('extractAudioMeta', () => {
  it('returns duration from a decoded audio File via AudioContext', async () => {
    const file = fileWithBuffer('song.mp3', 'audio/mpeg', new Uint8Array(16));
    const meta = await extractAudioMeta(file);
    expect(typeof meta.duration).toBe('number');
  });

  it('rejects when decode fails', async () => {
    const file = fileWithBuffer('empty.mp3', 'audio/mpeg', new Uint8Array(0));
    const proto = (window as unknown as { AudioContext: new () => AudioContext }).AudioContext.prototype;
    const spy = vi.spyOn(proto, 'decodeAudioData').mockRejectedValueOnce(new Error('decode failed'));
    try {
      await expect(extractAudioMeta(file)).rejects.toThrow(/decode/i);
    } finally {
      spy.mockRestore();
    }
  });
});
