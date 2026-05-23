import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVideoEngine } from '@/lib/video/engine';

// MockVideoElement is set up by vitest.setup.ts on globalThis.
const MockVideoElement = (globalThis as Record<string, unknown>)
  .MockVideoElement as new () => HTMLVideoElement & {
  currentTime: number;
  src: string;
  onloadeddata: (() => void) | null;
  onerror: (() => void) | null;
};

// Stub videoBytesCache.fetch so engine.load() doesn't hit real network
// (every test calls load(); the bytes-cache is exercised separately).
vi.mock('@/lib/video/bytes-cache', () => ({
  videoBytesCache: {
    fetch: vi.fn(async () => new ArrayBuffer(8)),
    get: () => null,
    bytesUsed: () => 0,
    clear: () => {}
  }
}));

// jsdom stubs for URL.createObjectURL — return a predictable blob URL so
// assertions can pattern-match it.
let blobUrlCounter = 0;
beforeEach(() => {
  blobUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => `blob:test/${++blobUrlCounter}`
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const orig = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'video') {
      return new MockVideoElement() as unknown as HTMLVideoElement;
    }
    return orig(tag);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createVideoEngine', () => {
  it('returns an engine instance in the browser environment', () => {
    const engine = createVideoEngine();
    expect(engine).not.toBeNull();
    expect(typeof engine!.load).toBe('function');
  });

  it('load() creates a <video> element with the right defaults', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    const el = engine.getElement('m1');
    expect(el).not.toBeNull();
    expect((el as unknown as { muted: boolean }).muted).toBe(true);
    expect((el as unknown as { playsInline: boolean }).playsInline).toBe(true);
    // Engine routes the network URL through the bytes-cache and
    // points the <video> at a blob URL of the cached bytes.
    expect(el!.src.startsWith('blob:')).toBe(true);
  });

  it('load() is idempotent — second call for the same id is a no-op', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    const first = engine.getElement('m1');
    const firstSrc = first!.src;
    await engine.load('m1', 'https://other/v.mp4');
    const second = engine.getElement('m1');
    expect(first).toBe(second);
    expect(first!.src).toBe(firstSrc);
  });

  it('unload() removes the element and clears src', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    expect(engine.loadedIds()).toEqual(['m1']);
    engine.unload('m1');
    expect(engine.loadedIds()).toEqual([]);
    expect(engine.getElement('m1')).toBeNull();
  });

  it('seekTo() with `requestVideoFrameCallback` resolves once the callback fires', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    const el = engine.getElement('m1')!;
    // Inject the optional API to take the fast path.
    let storedCb: (() => void) | null = null;
    (el as unknown as {
      requestVideoFrameCallback: (fn: () => void) => void;
    }).requestVideoFrameCallback = (fn: () => void) => {
      storedCb = fn;
    };
    const promise = engine.seekTo('m1', 2.5);
    expect(el.currentTime).toBe(2.5);
    expect(storedCb).not.toBeNull();
    (storedCb as unknown as () => void)();
    await promise; // resolves
  });

  it('seekTo() fallback uses the `seeked` event when rVFC is absent', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    const el = engine.getElement('m1')!;
    const listeners: Record<string, EventListener> = {};
    el.addEventListener = vi.fn((event: string, cb: EventListener) => {
      listeners[event] = cb;
    }) as unknown as typeof el.addEventListener;
    el.removeEventListener = vi.fn() as unknown as typeof el.removeEventListener;
    const promise = engine.seekTo('m1', 1);
    expect(el.currentTime).toBe(1);
    listeners.seeked?.(new Event('seeked'));
    await promise;
  });

  it('seekTo() is a no-op when already within SEEK_EPS', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    const el = engine.getElement('m1')!;
    el.currentTime = 5;
    // Tiny delta — should NOT trigger requestVideoFrameCallback
    let cbCalled = false;
    (el as unknown as {
      requestVideoFrameCallback: (fn: () => void) => void;
    }).requestVideoFrameCallback = () => {
      cbCalled = true;
    };
    await engine.seekTo('m1', 5.005);
    expect(cbCalled).toBe(false);
  });

  it('seekAllTo() seeks every loaded element', async () => {
    const engine = createVideoEngine()!;
    await engine.load('a', 'https://x/a.mp4');
    await engine.load('b', 'https://x/b.mp4');
    // Wire up fast-path on both
    for (const id of ['a', 'b']) {
      const el = engine.getElement(id)!;
      (el as unknown as {
        requestVideoFrameCallback: (fn: () => void) => void;
      }).requestVideoFrameCallback = (fn) => fn();
    }
    await engine.seekAllTo(3);
    expect(engine.getElement('a')!.currentTime).toBe(3);
    expect(engine.getElement('b')!.currentTime).toBe(3);
  });

  it('play() and pause() propagate to every loaded element', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    await engine.load('m2', 'https://x/v2.mp4');
    const playSpy = vi.spyOn(engine.getElement('m1')!, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(engine.getElement('m1')!, 'pause');
    engine.play();
    expect(playSpy).toHaveBeenCalled();
    engine.pause();
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('destroy() clears every element', async () => {
    const engine = createVideoEngine()!;
    await engine.load('m1', 'https://x/v.mp4');
    engine.destroy();
    expect(engine.loadedIds()).toEqual([]);
  });
});
