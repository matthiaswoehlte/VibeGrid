import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMediaDuration } from '@/lib/sceneflow/media-duration';

class FakeMediaElement extends EventTarget {
  preload = '';
  crossOrigin: string | null = null;
  src = '';
  duration = NaN;
  load(): void {
    /* no-op */
  }
}

beforeEach(() => {
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'video' || tag === 'audio') {
      return new FakeMediaElement() as unknown as HTMLMediaElement;
    }
    return orig(tag);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getMediaDuration', () => {
  it('resolves to the duration when loadedmetadata fires', async () => {
    const p = getMediaDuration('https://x/v.mp4', 'video');
    // Find the created element by dispatching to the spy — `createElement`
    // returns the FakeMediaElement instance; we capture it via the
    // returned promise's microtask path.
    const calls = (
      document.createElement as unknown as {
        mock: { results: Array<{ value: FakeMediaElement }> };
      }
    ).mock.results;
    const el = calls[calls.length - 1].value;
    el.duration = 5.3;
    el.dispatchEvent(new Event('loadedmetadata'));
    await expect(p).resolves.toBe(5.3);
  });

  it('resolves to null on error', async () => {
    const p = getMediaDuration('https://x/bad.mp4', 'video');
    const calls = (
      document.createElement as unknown as {
        mock: { results: Array<{ value: FakeMediaElement }> };
      }
    ).mock.results;
    const el = calls[calls.length - 1].value;
    el.dispatchEvent(new Event('error'));
    await expect(p).resolves.toBeNull();
  });

  it('resolves to null when duration is NaN or non-finite', async () => {
    const p = getMediaDuration('https://x/v.mp4', 'video');
    const calls = (
      document.createElement as unknown as {
        mock: { results: Array<{ value: FakeMediaElement }> };
      }
    ).mock.results;
    const el = calls[calls.length - 1].value;
    // NaN duration (no metadata) → null
    el.duration = NaN;
    el.dispatchEvent(new Event('loadedmetadata'));
    await expect(p).resolves.toBeNull();
  });

  it('resolves to null on timeout', async () => {
    vi.useFakeTimers();
    try {
      const p = getMediaDuration('https://x/slow.mp4', 'video', 200);
      vi.advanceTimersByTime(250);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the audio constructor for kind=audio', async () => {
    const p = getMediaDuration('https://x/song.mp3', 'audio');
    expect(document.createElement).toHaveBeenLastCalledWith('audio');
    const calls = (
      document.createElement as unknown as {
        mock: { results: Array<{ value: FakeMediaElement }> };
      }
    ).mock.results;
    const el = calls[calls.length - 1].value;
    el.duration = 12.7;
    el.dispatchEvent(new Event('loadedmetadata'));
    await expect(p).resolves.toBe(12.7);
  });
});
