import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { AutomationLane } from '@/components/Workspace/Timeline/AutomationLane';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';
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
    },
    ui: { ...s.ui, zoom: 1, expandedAutomationClipId: CLIP_ID }
  }));
});

describe('AutomationLane', () => {
  it('renders nothing when expandedAutomationClipId !== clip.id', () => {
    useAppStore.getState().setExpandedAutomationClipId(null);
    const { container } = render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one sub-row per automated slider param (skips color/toggle)', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getAllByTestId('automation-lane-row')).toHaveLength(1);
  });

  it('shows the param label + interpolation picker in the header', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    expect(screen.getByText(/intensity/i)).toBeDefined();
    expect(screen.getByRole('combobox', { name: /interpolation/i })).toBeDefined();
  });

  it('changing the interpolation picker dispatches setParamInterpolation', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    fireEvent.change(screen.getByRole('combobox', { name: /interpolation/i }), {
      target: { value: 'easeOut' }
    });
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.interpolation).toBe('easeOut');
  });

  it('close button clears expandedAutomationClipId', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    fireEvent.click(screen.getByRole('button', { name: /close automation/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });

  it('clicking the empty lane area adds a new point', () => {
    render(<AutomationLane clipId={CLIP_ID} pxPerBeat={PX_PER_BEAT} />);
    const surface = screen.getByTestId('automation-lane-surface');
    surface.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 80, clientY: 25, button: 0, bubbles: true })
    );
    const v = useAppStore.getState().timeline.clips[0].params!.intensity as AutomationCurve<number>;
    expect(v.points.length).toBe(3);
  });
});
