/**
 * Test 19 — metronomeEnabled store + persist + undo invariance.
 *
 * Covers:
 *  - defaults to false
 *  - toggleMetronome() flips it
 *  - appears in toPersistedShape(state).ui
 *  - undo + redo leaves metronomeEnabled UNCHANGED (ui slice is not in
 *    the HistoryEntry snapshot, so undo/redo must not reset it)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { toPersistedShape } from '@/lib/store/persist-shape';
import { initialTimelineState } from '@/lib/store/timeline-slice';

beforeEach(() => {
  useAppStore.setState({
    timeline: { ...initialTimelineState },
    history: { past: [], future: [] },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: {} as never,
      flowMode: false,
      exportRange: null,
      metronomeEnabled: false
    }
  });
});

describe('metronomeEnabled — store', () => {
  it('defaults to false', () => {
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(false);
  });

  it('toggleMetronome() flips false → true', () => {
    useAppStore.getState().toggleMetronome();
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);
  });

  it('toggleMetronome() flips true → false', () => {
    useAppStore.getState().toggleMetronome();
    useAppStore.getState().toggleMetronome();
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(false);
  });
});

describe('metronomeEnabled — persist shape', () => {
  it('appears in toPersistedShape(state).ui', () => {
    useAppStore.getState().toggleMetronome(); // set to true
    const shape = toPersistedShape(useAppStore.getState());
    expect(shape.ui.metronomeEnabled).toBe(true);
  });

  it('persists false when not toggled', () => {
    const shape = toPersistedShape(useAppStore.getState());
    expect(shape.ui.metronomeEnabled).toBe(false);
  });
});

describe('metronomeEnabled — undo/redo invariance', () => {
  it('undo followed by redo leaves metronomeEnabled unchanged', () => {
    // 1. Enable the metronome
    useAppStore.getState().toggleMetronome();
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);

    // 2. Do a recorded timeline mutation (creates a history entry)
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'test'
    });
    expect(useAppStore.getState().history.past).toHaveLength(1);
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);

    // 3. Undo — metronomeEnabled must still be true
    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);

    // 4. Redo — metronomeEnabled must still be true
    useAppStore.getState().redo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
    expect(useAppStore.getState().ui.metronomeEnabled).toBe(true);
  });
});
