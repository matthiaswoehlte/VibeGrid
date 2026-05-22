import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { InspectorSheet } from '@/components/Mobile/InspectorSheet';
import { useAppStore } from '@/lib/store';
import * as breakpoints from '@/lib/utils/breakpoints';
import {
  registerBuiltInPlugins,
  _resetBuiltInPluginsForTests
} from '@/lib/fx';
import type { Clip, Track } from '@/lib/timeline/types';

// useDndMonitor (used inside useInspectorSheet) must be called inside a
// DndContext — wrap every render so the hook subscribes successfully.
function renderInContext(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

function makeFxTrack(): Track {
  return { id: 'fx-1', kind: 'fx', name: 'FX', muted: false };
}

function makeClip(): Clip {
  return {
    id: 'clip-1',
    trackId: 'fx-1',
    kind: 'pulse',
    fxId: 'pulse',
    startBeat: 0,
    lengthBeats: 4,
    label: 'Pulse'
  };
}

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, tracks: [makeFxTrack()], clips: [makeClip()] }
  }));
  useAppStore.getState().setSelectedClipId(null);
  vi.restoreAllMocks();
});

describe('InspectorSheet (Plan 5.10)', () => {
  // Note: assertions check for the sheet's own region rather than
  // container emptiness — DndContext renders its own a11y helpers
  // (DndDescribedBy, DndLiveRegion) into the container regardless.

  it('renders no sheet when no clip is selected', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    renderInContext(<InspectorSheet />);
    expect(
      screen.queryByRole('region', { name: 'Clip inspector' })
    ).not.toBeInTheDocument();
  });

  it('renders no sheet on desktop even when a clip is selected', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(false);
    useAppStore.getState().setSelectedClipId('clip-1');
    renderInContext(<InspectorSheet />);
    expect(
      screen.queryByRole('region', { name: 'Clip inspector' })
    ).not.toBeInTheDocument();
  });

  it('opens on Mobile when a clip is selected', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    useAppStore.getState().setSelectedClipId('clip-1');
    renderInContext(<InspectorSheet />);
    expect(
      screen.getByRole('region', { name: 'Clip inspector' })
    ).toBeInTheDocument();
  });

  it('closes when backdrop is tapped (setSelectedClipId(null))', () => {
    vi.spyOn(breakpoints, 'useIsMobile').mockReturnValue(true);
    useAppStore.getState().setSelectedClipId('clip-1');
    renderInContext(<InspectorSheet />);
    const backdrop = screen.getByLabelText('Close inspector');
    backdrop.click();
    expect(useAppStore.getState().ui.selectedClipId).toBe(null);
  });
});
