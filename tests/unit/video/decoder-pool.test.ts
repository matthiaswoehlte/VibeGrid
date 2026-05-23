import { describe, it, expect } from 'vitest';
import { findSampleForTime, createVideoDecoderPool } from '@/lib/video/decoder-pool';

// Full decoder integration (mp4box demux + WebCodecs VideoDecoder)
// requires a real MP4 binary fixture AND WebCodecs in the test env,
// neither available in jsdom. The pool's correctness on the actual
// pipeline is covered by manual smoke test (export-with-video).
//
// These unit tests cover the pure helper + the createPool() guard
// rails — the parts that can be exercised without a real codec.

describe('findSampleForTime (Plan 5.10+ video-decoder)', () => {
  const samples = [
    { ts: 0 },
    { ts: 33333 },
    { ts: 66666 },
    { ts: 100000 },
    { ts: 133333 }
  ];

  it('returns -1 for an empty sample array', () => {
    expect(findSampleForTime([], 0)).toBe(-1);
    expect(findSampleForTime([], 12345)).toBe(-1);
  });

  it('returns 0 when the target is before the first sample', () => {
    // Pre-roll: caller asked for a frame before the video even starts.
    // Returning the first frame is the friendly default — caller sees
    // SOMETHING instead of null.
    expect(findSampleForTime(samples, -100)).toBe(0);
  });

  it('returns the exact match when the target hits a sample timestamp', () => {
    expect(findSampleForTime(samples, 0)).toBe(0);
    expect(findSampleForTime(samples, 66666)).toBe(2);
    expect(findSampleForTime(samples, 133333)).toBe(4);
  });

  it('returns the LATEST sample whose ts <= target (round-down)', () => {
    expect(findSampleForTime(samples, 10000)).toBe(0);
    expect(findSampleForTime(samples, 33333)).toBe(1);
    expect(findSampleForTime(samples, 33334)).toBe(1);
    expect(findSampleForTime(samples, 99999)).toBe(2);
    expect(findSampleForTime(samples, 100000)).toBe(3);
  });

  it('returns the last sample for any target beyond the end', () => {
    expect(findSampleForTime(samples, 200000)).toBe(4);
    expect(findSampleForTime(samples, Number.MAX_SAFE_INTEGER)).toBe(4);
  });
});

describe('createVideoDecoderPool — environment guards', () => {
  it('returns null when window is absent (SSR)', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — emulate server env
    delete globalThis.window;
    try {
      expect(createVideoDecoderPool()).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('returns null when VideoDecoder is unavailable (jsdom default)', () => {
    // jsdom doesn't ship WebCodecs. The pool refuses to construct so
    // callers can fall back to the HTMLVideoElement path or surface
    // the limitation cleanly. Live preview (which never instantiates
    // the pool) is unaffected.
    expect(typeof (globalThis as Record<string, unknown>).VideoDecoder).toBe(
      'undefined'
    );
    expect(createVideoDecoderPool()).toBeNull();
  });
});
