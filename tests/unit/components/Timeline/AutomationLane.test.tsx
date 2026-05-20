import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { AutomationLane } from '@/components/Workspace/Timeline/AutomationLane';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-lane-1';
const PX_PER_BEAT = 40;

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
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
            } satisfies AutomationCurve<number>,
            color: '#ff00ff'
          }
        }
      ]
    }
  }));
});

describe('AutomationLane (read-only preview)', () => {
  it('renders nothing when the clip has no automated slider params', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: s.timeline.clips.map((c) =>
          c.id === CLIP_ID ? { ...c, params: { intensity: 0.5, color: '#ff00ff' } } : c
        )
      }
    }));
    const { container } = render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one sub-row per automated slider param', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getAllByTestId('automation-lane-row')).toHaveLength(1);
  });

  it('shows the param label in the row header', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getByText(/intensity/i)).toBeDefined();
  });

  it('does NOT render the snap, interpolation or close controls (preview is read-only)', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.queryByRole('combobox', { name: /snap to grid/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /interpolation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /close automation/i })).toBeNull();
  });

  it('renders the curve path inside the SVG surface', () => {
    const { container } = render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const path = svg!.querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M /);
  });

  it('renders non-interactive points (no point events attached)', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    // The non-interactive variant of AutomationPoint marks itself aria-hidden
    // and skips the wrapper <g>'s onPointerDown / onContextMenu / onDoubleClick.
    const dot = screen.getByLabelText(/automation point 1/i);
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });

  it('filters out reserved __-prefix params (e.g. __blend) from the preview', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: s.timeline.clips.map((c) =>
          c.id === CLIP_ID
            ? {
                ...c,
                params: {
                  intensity: 0.5,
                  __blend: {
                    mode: 'automation',
                    interpolation: 'linear',
                    points: [
                      { beat: 0, value: 0 },
                      { beat: 4, value: 1 }
                    ]
                  } satisfies AutomationCurve<number>
                }
              }
            : c
        )
      }
    }));
    const { container } = render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(container.firstChild).toBeNull();
  });
});
