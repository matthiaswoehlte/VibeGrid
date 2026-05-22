import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppStore } from '@/lib/store';

// Capture the handler passed to usePinch so we can invoke it directly.
// Testing the pinch gesture itself requires multi-pointer events that
// jsdom can't fake well — verifying the clamp + setZoom logic via the
// captured handler is the meaningful unit. Real pinch behavior is
// validated in the smoke test (manual on a real device).
let pinchHandler:
  | ((args: { offset: [number, number] }) => void)
  | null = null;

vi.mock('@use-gesture/react', () => ({
  usePinch: vi.fn((handler: (args: { offset: [number, number] }) => void) => {
    pinchHandler = handler;
  })
}));

// Import AFTER the mock so the hook captures the mocked usePinch.
import {
  useTimelinePinchZoom,
  ZOOM_MIN,
  ZOOM_MAX
} from '@/lib/hooks/useTimelinePinchZoom';

beforeEach(() => {
  pinchHandler = null;
  useAppStore.getState().setZoom(1);
});

describe('useTimelinePinchZoom (Plan 5.10)', () => {
  it('exposes the same zoom bounds the Toolbar slider uses (0.5, 3)', () => {
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(3);
  });

  it('pinch with scale 2 sets zoom to 2', () => {
    const ref = { current: document.createElement('div') };
    renderHook(() => useTimelinePinchZoom(ref));
    pinchHandler?.({ offset: [2, 0] });
    expect(useAppStore.getState().ui.zoom).toBe(2);
  });

  it('clamps zoom to ZOOM_MAX on pinch-out beyond the limit', () => {
    const ref = { current: document.createElement('div') };
    renderHook(() => useTimelinePinchZoom(ref));
    pinchHandler?.({ offset: [10, 0] });
    expect(useAppStore.getState().ui.zoom).toBe(ZOOM_MAX);
  });

  it('clamps zoom to ZOOM_MIN on pinch-in below the limit', () => {
    const ref = { current: document.createElement('div') };
    renderHook(() => useTimelinePinchZoom(ref));
    pinchHandler?.({ offset: [0.1, 0] });
    expect(useAppStore.getState().ui.zoom).toBe(ZOOM_MIN);
  });
});
