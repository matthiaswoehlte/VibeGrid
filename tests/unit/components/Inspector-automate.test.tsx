import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { Inspector } from '@/components/Workspace/Inspector';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-auto-1';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      playhead: { beats: 2, playing: false },
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Pulse',
          params: { intensity: 0.5, color: '#ff00ff' }
        }
      ]
    },
    ui: { ...s.ui, selectedClipId: CLIP_ID, expandedAutomationClipId: null }
  }));
});

describe('Inspector — Automate button', () => {
  it('renders an Automate button only for slider params', () => {
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /automate intensity/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /automate glow color/i })).toBeNull();
  });

  it('converts static → automation on click (uses playhead beat)', () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /automate intensity/i }));
    const v = useAppStore.getState().timeline.clips[0].params!.intensity;
    expect(isAutomationCurve(v)).toBe(true);
    const c = v as AutomationCurve<number>;
    expect(c.points).toEqual([{ beat: 2, value: 0.5 }]);
  });

  it('converts automation → static on second click (uses points[0].value)', () => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    useAppStore.getState().timelineActions.updateParamPoint(CLIP_ID, 'intensity', 0, { value: 0.9 });
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /automate intensity/i }));
    expect(useAppStore.getState().timeline.clips[0].params!.intensity).toBe(0.9);
  });

  it('"Edit on timeline" link appears only when at least one param is automated', () => {
    const { rerender } = render(<Inspector />);
    expect(screen.queryByRole('button', { name: /edit on timeline/i })).toBeNull();
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
    rerender(<Inspector />);
    expect(screen.getByRole('button', { name: /edit on timeline/i })).toBeDefined();
  });
});

describe('Inspector — Edit on timeline wiring', () => {
  beforeEach(() => {
    useAppStore.getState().timelineActions.convertParamToAutomation(CLIP_ID, 'intensity', 0);
  });

  it('clicking sets expandedAutomationClipId to clip.id', () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /edit on timeline/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBe(CLIP_ID);
  });

  it('button text flips to "Hide automation" when open', () => {
    useAppStore.getState().setExpandedAutomationClipId(CLIP_ID);
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /hide automation/i })).toBeDefined();
  });

  it('clicking again clears expandedAutomationClipId', () => {
    useAppStore.getState().setExpandedAutomationClipId(CLIP_ID);
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: /hide automation/i }));
    expect(useAppStore.getState().ui.expandedAutomationClipId).toBeNull();
  });
});
