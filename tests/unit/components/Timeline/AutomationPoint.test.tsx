import { describe, it, expect, beforeEach } from 'vitest';
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
    }
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
    expect(dot.getAttribute('cx')).toBe('0');
    expect(dot.getAttribute('cy')).toBe('50');
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
});
