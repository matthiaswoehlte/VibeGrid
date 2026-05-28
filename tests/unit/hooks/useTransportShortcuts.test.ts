import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransportShortcuts } from '@/lib/hooks/useTransportShortcuts';
import { useAppStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Minimal AudioEngine mock — only the methods the hook calls.
// ---------------------------------------------------------------------------
function makeEngine() {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn()
  };
}

// ---------------------------------------------------------------------------
// Store baseline (not playing)
// ---------------------------------------------------------------------------
function setPlayingState(playing: boolean) {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      playhead: { ...s.timeline.playhead, playing }
    }
  }));
}

/** Fire a Spacebar keydown on window and flush the microtask queue. */
async function pressSpacebar() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useTransportShortcuts', () => {
  beforeEach(() => {
    // Start each test with a known not-playing state.
    setPlayingState(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Spacebar press calls engine.play() and sets playhead.playing=true when not playing', async () => {
    const engine = makeEngine();
    renderHook(() => useTransportShortcuts(engine as never));

    await pressSpacebar();

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().timeline.playhead.playing).toBe(true);
  });

  it('Spacebar press calls engine.pause() and sets playhead.playing=false when playing', async () => {
    setPlayingState(true);
    const engine = makeEngine();
    renderHook(() => useTransportShortcuts(engine as never));

    await pressSpacebar();

    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
    expect(useAppStore.getState().timeline.playhead.playing).toBe(false);
  });

  it('Spacebar press is a no-op (no throw) when engine is null', async () => {
    renderHook(() => useTransportShortcuts(null));

    await expect(pressSpacebar()).resolves.not.toThrow();
    // Store remains untouched (playing still false).
    expect(useAppStore.getState().timeline.playhead.playing).toBe(false);
  });

  it('non-Space keys are ignored', async () => {
    const engine = makeEngine();
    renderHook(() => useTransportShortcuts(engine as never));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('removes the event listener on unmount (no lingering handler)', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));
    unmount();

    await pressSpacebar();

    expect(engine.play).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Focus-bail: when target is INPUT/TEXTAREA/contenteditable, the hook MUST
// skip so native text-entry handling (insert space char) wins. DAW-standard
// behavior matches useUndoRedoShortcuts. Verified by dispatching keydown
// with the input as `target` — same shape browsers produce when focus is on
// the element.
// ---------------------------------------------------------------------------
describe('useTransportShortcuts — bails when text-entry element is the event target', () => {
  beforeEach(() => {
    setPlayingState(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Dispatch Space directly onto `target`, mirroring the browser path where
   *  keydown bubbles from the focused element up to window. */
  async function pressSpaceOn(target: Element) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it('skips toggle when target is an INPUT', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));
    const input = document.createElement('input');
    document.body.appendChild(input);

    await pressSpaceOn(input);

    expect(engine.play).not.toHaveBeenCalled();
    expect(useAppStore.getState().timeline.playhead.playing).toBe(false);

    unmount();
    document.body.removeChild(input);
  });

  it('skips toggle when target is a TEXTAREA', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);

    await pressSpaceOn(ta);

    expect(engine.play).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(ta);
  });

  it('skips toggle when target is contenteditable', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);

    await pressSpaceOn(div);

    expect(engine.play).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(div);
  });

  it('toggles when target is a non-text element (e.g. button)', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    await pressSpaceOn(btn);

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().timeline.playhead.playing).toBe(true);

    unmount();
    document.body.removeChild(btn);
  });
});
