import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { Inspector } from '@/components/Workspace/Inspector';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { BLEND_KEY } from '@/lib/timeline/blend';
import type { AutomationCurve } from '@/lib/automation/types';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [] }
  }));
});

const setupOverlap = () => {
  useAppStore.getState().timelineActions.addClip({
    id: 'a',
    trackId: 'track-pulse',
    kind: 'pulse',
    fxId: 'pulse',
    startBeat: 0,
    lengthBeats: 8,
    label: 'A'
  });
  useAppStore.getState().timelineActions.addClip({
    id: 'b',
    trackId: 'track-pulse',
    kind: 'pulse',
    fxId: 'pulse',
    startBeat: 6,
    lengthBeats: 8,
    label: 'B'
  });
  useAppStore.getState().setSelectedClipId('b');
};

describe('Inspector — Transition section', () => {
  it('does NOT render when the selected clip has no incoming overlap', () => {
    useAppStore.getState().timelineActions.addClip({
      id: 'solo',
      trackId: 'track-pulse',
      kind: 'pulse',
      fxId: 'pulse',
      startBeat: 0,
      lengthBeats: 4,
      label: 'Solo'
    });
    useAppStore.getState().setSelectedClipId('solo');
    render(<Inspector />);
    expect(screen.queryByText(/transition/i)).toBeNull();
  });

  it('renders the interpolation select reflecting the current __blend mode', () => {
    setupOverlap();
    render(<Inspector />);
    const select = screen.getByRole('combobox', { name: /transition curve/i }) as HTMLSelectElement;
    expect(select.value).toBe('linear');
  });

  it('changing the select dispatches setBlendInterpolation', () => {
    setupOverlap();
    render(<Inspector />);
    fireEvent.change(screen.getByRole('combobox', { name: /transition curve/i }), {
      target: { value: 'easeIn' }
    });
    const b = useAppStore.getState().timeline.clips.find((c) => c.id === 'b')!;
    const curve = b.params?.[BLEND_KEY] as AutomationCurve<number>;
    expect(curve.interpolation).toBe('easeIn');
  });
});
