import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Inspector } from '@/components/Workspace/Inspector';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import {
  registerBuiltInPlugins,
  _resetBuiltInPluginsForTests
} from '@/lib/fx';
import type { Clip, Track } from '@/lib/timeline/types';

// Plan 5.8b — Inspector integration of `visibleWhen`. Verifies the
// filter at render-time and the store-value roundtrip when a gating
// param toggles off then back on.

const TEXT_CLIP_ID = 'text-1';

function makeFxTrack(): Track {
  return { id: 'fx-1', kind: 'fx', name: 'FX', muted: false };
}

function makeTextClip(params: Record<string, unknown>): Clip {
  return {
    id: TEXT_CLIP_ID,
    trackId: 'fx-1',
    kind: 'text',
    fxId: 'text',
    startBeat: 0,
    lengthBeats: 4,
    label: 'Text',
    params
  };
}

function setupStore(params: Record<string, unknown>): void {
  useAppStore.setState({
    ui: {
      zoom: 1,
      selectedClipIds: [TEXT_CLIP_ID],
      selectedClipId: TEXT_CLIP_ID,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false
    },
    timeline: {
      tracks: [makeFxTrack()],
      clips: [makeTextClip(params)],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    }
  });
}

beforeEach(() => {
  // Plugin registry contamination guard (see dev_runtime_gotchas #6).
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
});

describe('Inspector conditional params (Plan 5.8b)', () => {
  it('renders extrusionDepth slider when enable3d=true', () => {
    setupStore({ enable3d: true, blink: false });
    render(<Inspector />);
    // ParamControl renders <label> wrapping a control labelled with
    // the schema's `label` value. Query by the visible label text.
    expect(screen.getByText('Extrusion depth')).toBeInTheDocument();
  });

  it('omits extrusionDepth (+ direction + style) when enable3d=false', () => {
    setupStore({ enable3d: false, blink: false });
    render(<Inspector />);
    expect(screen.queryByText('Extrusion depth')).not.toBeInTheDocument();
    expect(screen.queryByText('Extrusion dir')).not.toBeInTheDocument();
    expect(screen.queryByText('Extrusion style')).not.toBeInTheDocument();
  });

  it('omits the AutomateButton ⚡ for hidden params', () => {
    // blinkDecay is a slider — slider params get AutomateButton in the
    // visible state. With blink=false, the whole row including the
    // button is dropped via the visibleWhen guard.
    setupStore({ enable3d: false, blink: false });
    render(<Inspector />);
    // The AutomateButton uses '⚡' as its visual glyph; presence/absence
    // is the right proxy for "row is rendered or not".
    expect(screen.queryByText('Blink decay')).not.toBeInTheDocument();
  });

  it('roundtrip — extrusionDepth value survives an enable3d toggle off+on', () => {
    setupStore({ enable3d: true, extrusionDepth: 16 });
    render(<Inspector />);
    expect(screen.getByText('Extrusion depth')).toBeInTheDocument();

    // Toggle enable3d off — row disappears, but the value must stay in
    // the store (visibleWhen is purely UI, no setClipParam side effect).
    useAppStore.getState().timelineActions.setClipParam(TEXT_CLIP_ID, 'enable3d', false);
    expect(useAppStore.getState().timeline.clips[0]?.params?.extrusionDepth).toBe(16);

    // Toggle back on — row reappears, value still 16.
    useAppStore.getState().timelineActions.setClipParam(TEXT_CLIP_ID, 'enable3d', true);
    expect(useAppStore.getState().timeline.clips[0]?.params?.extrusionDepth).toBe(16);
  });
});
