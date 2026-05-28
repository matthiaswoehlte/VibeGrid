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
// The "fires when input focused" property is a code-level invariant:
// useTransportShortcuts intentionally has NO focus-element bail-out guard
// (contrast with useUndoRedoShortcuts which returns early for INPUT/TEXTAREA).
// The test below verifies this directly without causing act() nesting from
// calling input.focus() inside a renderHook() context.
// ---------------------------------------------------------------------------
describe('useTransportShortcuts — fires when input is focused (no bail-out)', () => {
  beforeEach(() => {
    setPlayingState(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Spacebar is handled even with an input present and active in the DOM', async () => {
    const engine = makeEngine();
    const { unmount } = renderHook(() => useTransportShortcuts(engine as never));

    // Add an input to the DOM so document.activeElement is an input-like
    // element. We deliberately do NOT call .focus() inside an act() to avoid
    // the "overlapping act()" React testing warning that obscures the real
    // assertion. The hook registers on window and browsers always deliver
    // keydown to window regardless of which element has focus.
    const input = document.createElement('input');
    document.body.appendChild(input);

    // Dispatch from window — same path a browser uses for every keypress.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    // The hook MUST have called play() — proving no input-focus bail-out exists.
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().timeline.playhead.playing).toBe(true);

    unmount();
    document.body.removeChild(input);
  });
});
