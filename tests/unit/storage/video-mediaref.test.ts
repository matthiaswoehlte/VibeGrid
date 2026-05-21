import { describe, it, expect } from 'vitest';
import type { MediaRef } from '@/lib/storage/types';

describe('MediaRef — Plan 5.9b extensions', () => {
  it('accepts kind === "video"', () => {
    const ref: MediaRef = {
      id: '1',
      kind: 'video',
      url: 'https://x/v.mp4',
      filename: 'v.mp4',
      uploadedAt: '2026-05-21T00:00:00Z',
      duration: 30
    };
    expect(ref.kind).toBe('video');
    expect(ref.duration).toBe(30);
  });

  it('accepts a thumbnailUrl alongside other fields', () => {
    const ref: MediaRef = {
      id: '1',
      kind: 'video',
      url: 'https://x/v.mp4',
      filename: 'v.mp4',
      uploadedAt: '2026-05-21T00:00:00Z',
      duration: 30,
      thumbnailUrl: 'data:image/jpeg;base64,abc'
    };
    expect(ref.thumbnailUrl?.startsWith('data:image/jpeg')).toBe(true);
  });

  it('thumbnailUrl is optional', () => {
    const ref: MediaRef = {
      id: '1',
      kind: 'video',
      url: 'https://x/v.mp4',
      filename: 'v.mp4',
      uploadedAt: '2026-05-21T00:00:00Z',
      duration: 30
    };
    expect(ref.thumbnailUrl).toBeUndefined();
  });
});

describe('MockVideoElement (Plan 5.9b — vitest.setup.ts)', () => {
  it('is available on globalThis for tests that opt in', () => {
    const Ctor = (globalThis as Record<string, unknown>).MockVideoElement as
      | (new () => {
          currentTime: number;
          duration: number;
          muted: boolean;
          load: () => void;
        })
      | undefined;
    expect(Ctor).toBeDefined();
    const el = new Ctor!();
    expect(el.muted).toBe(true);
    expect(el.duration).toBe(60);
    expect(typeof el.load).toBe('function');
  });

  it('calls onloadeddata in a microtask after load()', async () => {
    const Ctor = (globalThis as Record<string, unknown>).MockVideoElement as new () => {
      onloadeddata: (() => void) | null;
      onloadedmetadata: (() => void) | null;
      load: () => void;
    };
    const el = new Ctor();
    let dataReady = false;
    el.onloadeddata = () => {
      dataReady = true;
    };
    el.load();
    expect(dataReady).toBe(false); // not yet — load() schedules a microtask
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(dataReady).toBe(true);
  });
});
