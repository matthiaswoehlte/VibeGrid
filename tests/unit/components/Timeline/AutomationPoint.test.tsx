import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { AutomationPoint as PointDot } from '@/components/Workspace/Timeline/AutomationPoint';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';
const KEY = 'intensity';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 1 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    },
    // Plan 5.7: reset transient UI fields so other test files can't leak
    // state (especially automationSnap, which the drag handler reads).
    ui: { ...s.ui, automationSnap: 'off' }
  }));
});

const baseProps = {
  clipId: CLIP_ID,
  paramKey: KEY,
  pointIndex: 0,
  beat: 0,
  value: 0,
  lengthBeats: 8,
  laneWidthPx: 160,
  laneHeightPx: 50,
  valueMin: 0,
  valueMax: 1
};

const renderInSvg = (extra?: Partial<typeof baseProps>) =>
  render(
    <svg width={baseProps.laneWidthPx} height={baseProps.laneHeightPx}>
      <PointDot {...baseProps} {...extra} />
    </svg>
  );

describe('AutomationPoint', () => {
  it('renders at (beat·px, valueY) from schema min/max', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    // Wrapper is now a <g> with two child circles (hit area + visible dot).
    // Both share cx/cy — read from the first circle inside the group.
    const circle = dot.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe('0');
    expect(circle?.getAttribute('cy')).toBe('50');
  });

  it('right-click on a non-last point dispatches removeParamPoint', () => {
    renderInSvg();
    fireEvent.contextMenu(screen.getByLabelText(/automation point 1/i));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points.map((p) => p.beat)).toEqual([4]);
  });

  it('right-click on the LAST remaining point collapses to static (no empty-curve throw)', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: s.timeline.clips.map((c) =>
          c.id === CLIP_ID
            ? {
                ...c,
                params: {
                  intensity: {
                    mode: 'automation',
                    interpolation: 'linear',
                    points: [{ beat: 0, value: 0.5 }]
                  } satisfies AutomationCurve<number>
                }
              }
            : c
        )
      }
    }));
    renderInSvg({ value: 0.5 });
    fireEvent.contextMenu(screen.getByLabelText(/automation point 1/i));
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.5);
  });

  it('pointer-drag updates store with clamped beat+value', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    // jsdom's PointerEvent strips clientX/Y through fireEvent. Use native
    // MouseEvent with the pointer* type names — same pattern as Clip.test.tsx.
    dot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 25, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 25, bubbles: true }));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points[0].beat).toBeCloseTo(2, 5);
    expect(v.points[0].value).toBeCloseTo(0.5, 5);
  });

  it('pointer-drag clamps to lane bounds', () => {
    renderInSvg();
    const dot = screen.getByLabelText(/automation point 1/i);
    dot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -100, clientY: -100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: -100, clientY: -100, bubbles: true }));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points[0].beat).toBeCloseTo(0, 5);
    expect(v.points[0].value).toBeCloseTo(1, 5);
  });

  it('long-press (held > 600ms without movement) deletes the point', async () => {
    vi.useFakeTimers();
    try {
      renderInSvg();
      const dot = screen.getByLabelText(/automation point 1/i);
      dot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 50, bubbles: true }));
      // Advance fake time past the 600 ms long-press threshold without any
      // pointermove — the timer fires and removeParamPoint is dispatched.
      vi.advanceTimersByTime(700);
      const v = useAppStore.getState().timeline.clips[0].params!
        .intensity as AutomationCurve<number>;
      expect(v.points.map((p) => p.beat)).toEqual([4]); // point at beat 0 removed
    } finally {
      vi.useRealTimers();
    }
  });

  it('long-press is cancelled when the pointer moves before the threshold', () => {
    vi.useFakeTimers();
    try {
      renderInSvg();
      const dot = screen.getByLabelText(/automation point 1/i);
      dot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 50, bubbles: true }));
      // Move 10 px right BEFORE the 600 ms threshold — cancels long-press.
      window.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 10, clientY: 50, bubbles: true })
      );
      vi.advanceTimersByTime(700);
      window.dispatchEvent(
        new MouseEvent('pointerup', { clientX: 10, clientY: 50, bubbles: true })
      );
      const v = useAppStore.getState().timeline.clips[0].params!
        .intensity as AutomationCurve<number>;
      // Both original points still present — long-press did NOT fire delete.
      expect(v.points).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
