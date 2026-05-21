import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useRenderer } from '@/lib/hooks/useRenderer';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({ media: { ...s.media, mediaRefs: [] } }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/**
 * Tests run with `canvasRef.current = null` — the hook's effect bails
 * out at `if (!canvas) return;` before any renderer setup. The cache
 * (and therefore `getBitmap`) is still initialised because it sits in
 * `useRef(...)` outside the effect. jsdom can't provide a real 2D
 * context, so any test that actually mounted the renderer would crash
 * on `canvas.getContext('2d')`. We only need to verify the getter
 * surface here; renderer behaviour is covered by the dedicated tests
 * in `tests/unit/renderer/loop.test.ts`.
 */
function mountHook() {
  const canvasRef = createRef<HTMLCanvasElement>();
  return renderHook(() =>
    useRenderer({
      canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
      getCurrentTime: () => 0
    })
  );
}

describe('useRenderer().getBitmap', () => {
  it('returns a function on the hook return value', () => {
    const { result } = mountHook();
    expect(typeof result.current.getBitmap).toBe('function');
  });

  it('returns undefined for an unknown mediaId (cache is empty)', () => {
    const { result } = mountHook();
    expect(result.current.getBitmap('does-not-exist')).toBeUndefined();
  });

  it('does not throw when canvasRef.current is null at mount', () => {
    const { result } = mountHook();
    expect(() => result.current.getBitmap('x')).not.toThrow();
    expect(result.current.getBitmap('x')).toBeUndefined();
  });

  it('getBitmap identity is stable across re-renders', () => {
    const { result, rerender } = mountHook();
    const first = result.current.getBitmap;
    rerender();
    const second = result.current.getBitmap;
    // useVideoExporter can pass it through without re-wiring on every
    // parent re-render.
    expect(first).toBe(second);
  });
});
