import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { AutomationPoint as PointDot } from '@/components/Workspace/Timeline/AutomationPoint';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-mod';
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
          label: 'Mod',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 2, value: 0.25 },
                { beat: 4, value: 0.5 },
                { beat: 6, value: 0.75 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    },
    ui: { ...s.ui, automationSnap: 'off' }
  }));
});

const renderInSvg = (pointIndex: number, beat: number, value: number) =>
  render(
    <svg width={160} height={50}>
      <PointDot
        clipId={CLIP_ID}
        paramKey={KEY}
        pointIndex={pointIndex}
        beat={beat}
        value={value}
        lengthBeats={8}
        laneWidthPx={160}
        laneHeightPx={50}
        valueMin={0}
        valueMax={1}
      />
    </svg>
  );

const drag = (
  el: Element,
  dx: number,
  dy: number,
  opts: { ctrl?: boolean; shift?: boolean } = {}
) => {
  el.dispatchEvent(
    new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true })
  );
  window.dispatchEvent(
    new MouseEvent('pointermove', {
      clientX: dx,
      clientY: dy,
      bubbles: true,
      ctrlKey: opts.ctrl,
      shiftKey: opts.shift
    })
  );
  window.dispatchEvent(
    new MouseEvent('pointerup', { clientX: dx, clientY: dy, bubbles: true })
  );
};

describe('AutomationPoint — modifier keys', () => {
  it('no modifier — both axes move (existing behaviour)', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 20, -10);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    // 20 px right at 20 px/beat = +1 beat; -10 px at 50 height (range 1) = +0.2
    expect(c.points[1].beat).toBeCloseTo(3, 5);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
  });

  it('ctrl — beat locked, only value moves', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 40, -10, { ctrl: true });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(2);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
  });

  it('shift — trailing points follow by same delta', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 20, 0, { shift: true });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    // Points at indices 1, 2, 3 all shift +1 beat; point 0 stays.
    expect(c.points.map((p) => p.beat)).toEqual([0, 3, 5, 7]);
  });

  it('ctrl + shift — trailing points move only in Y', () => {
    renderInSvg(1, 2, 0.25);
    drag(screen.getByLabelText(/automation point 2/i), 40, -10, {
      ctrl: true,
      shift: true
    });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points.map((p) => p.beat)).toEqual([0, 2, 4, 6]);
    expect(c.points[1].value).toBeCloseTo(0.45, 5);
    expect(c.points[2].value).toBeCloseTo(0.7, 5);
    expect(c.points[3].value).toBeCloseTo(0.95, 5);
  });

  it("snap '1/4' rounds the active beat", () => {
    useAppStore.getState().setAutomationSnap('1/4');
    renderInSvg(1, 2, 0.25);
    // 13 px ≈ 0.65 beat → with start at beat 2, target ≈ 2.65 → snap to 2.75
    drag(screen.getByLabelText(/automation point 2/i), 13, 0);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBeCloseTo(2.75, 5);
  });
});
