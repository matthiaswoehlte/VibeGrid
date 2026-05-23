import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { applySerializedProject } from '@/lib/project/deserialize';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

beforeEach(() => {
  // Reset to a known baseline before each test — otherwise residual
  // state from one applySerializedProject call leaks into the next.
  useAppStore.setState({
    ui: {
      zoom: 1,
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false
    },
    timeline: {
      tracks: [],
      clips: [],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    },
    audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual', beatsPerBar: 4 } },
    media: { mediaRefs: [], videoLoadProgress: {} }
  });
});

describe('applySerializedProject', () => {
  it('hydrates timeline from a fresh v6 payload', () => {
    applySerializedProject({
      store_version: 6,
      state: {
        ui: { zoom: 1.25 },
        timeline: {
          tracks: [],
          clips: [
            {
              id: 'c1',
              trackId: 't1',
              kind: 'pulse',
              fxId: 'pulse',
              startBeat: 0,
              lengthBeats: 4,
              label: 'P'
            } as never
          ],
          playhead: { beats: 0, playing: false },
          zoom: 1,
          snap: 'beat'
        },
        audio: { grid: { bpm: 124, offsetMs: 0, source: 'detected', beatsPerBar: 4 } },
        media: { mediaRefs: [] }
      }
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
    expect(useAppStore.getState().ui.zoom).toBe(1.25);
    expect(useAppStore.getState().audio.grid.bpm).toBe(124);
  });

  it('runs `migrate` for older store_versions (v4 snapshot upgrades to v6)', () => {
    applySerializedProject({
      store_version: 4,
      state: {
        ui: { zoom: 1 },
        timeline: {
          tracks: [
            { id: 't1', kind: 'contour' as never, name: 'C', muted: false }
          ],
          clips: [],
          playhead: { beats: 0, playing: false },
          zoom: 1,
          snap: 'beat'
        },
        audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual', beatsPerBar: 4 } },
        media: { mediaRefs: [] }
      }
    });
    // v5 → v6 migration collapses 'contour' track kind to 'fx'.
    expect(useAppStore.getState().timeline.tracks[0]?.kind).toBe('fx');
  });

  it('preserves transient ui fields not in payload', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, flowMode: true } }));
    applySerializedProject({
      store_version: 6,
      state: {
        ui: { zoom: 2 },
        timeline: {
          tracks: [],
          clips: [],
          playhead: { beats: 0, playing: false },
          zoom: 1,
          snap: 'beat'
        },
        audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual', beatsPerBar: 4 } },
        media: { mediaRefs: [] }
      }
    });
    expect(useAppStore.getState().ui.flowMode).toBe(true); // transient survived
    expect(useAppStore.getState().ui.zoom).toBe(2); // persisted applied
  });
});
