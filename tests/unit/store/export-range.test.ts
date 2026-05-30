/**
 * Plan 9d Task 1 — exportRange ephemeral state
 *
 * TDD: these tests are written BEFORE the implementation. They verify:
 *   1. setExportRange / clearExportRange basic set + clear
 *   2. Backwards range (start > end) → stored swapped
 *   3. Zero-length (start === end) → stored as null
 *   4. Clamp to [0, projectDuration]
 *   5. Undo/redo leaves exportRange unchanged
 *   6. exportRange is NOT in the persisted shape AND not in the undo snapshot
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { toPersistedShape } from '@/lib/store/persist-shape';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import { computeTotalBeats } from '@/lib/timeline/total-beats';
import type { Clip } from '@/lib/timeline/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClip(
  id: string,
  trackId: string,
  startBeat: number,
  lengthBeats: number
): Clip {
  return {
    id,
    trackId,
    kind: 'pulse',
    fxId: 'pulse',
    startBeat,
    lengthBeats,
    label: id
  };
}

/** Reset the store to a clean baseline with the given clips. */
function seedStore(clips: Clip[] = [], bpm = 120): void {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [{ id: 'fx1', kind: 'fx' as const, name: 'FX', muted: false }],
      clips
    },
    audio: {
      grid: { bpm, offsetMs: 0, source: 'manual' as const }
    },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off' as const,
      clipSnap: '1' as const,
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null
    },
    history: { past: [], future: [] }
  }));
}

/**
 * Compute the expected projectDuration in seconds.
 * Mirrors the clamp logic the store mutator uses:
 *   computeTotalBeats(clips) * 60 / bpm
 *
 * computeTotalBeats = max(64, ceil(max end beat)) + 32 (DROP_HEADROOM)
 */
function expectedProjectDuration(clips: Clip[], bpm: number): number {
  return (computeTotalBeats(clips) * 60) / bpm;
}

// ---------------------------------------------------------------------------
// Suite 1: basic set + clear
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: basic set + clear', () => {
  beforeEach(() => seedStore());

  it('setExportRange stores {start, end} when start < end', () => {
    useAppStore.getState().setExportRange(1, 5);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 1, end: 5 });
  });

  it('clearExportRange sets exportRange to null', () => {
    useAppStore.getState().setExportRange(1, 5);
    useAppStore.getState().clearExportRange();
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });

  it('initial exportRange is null', () => {
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: normalization — backwards range
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: backwards range normalization', () => {
  beforeEach(() => seedStore());

  it('swaps start and end when start > end', () => {
    useAppStore.getState().setExportRange(10, 2);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 2, end: 10 });
  });

  it('stores correctly when start < end (no swap needed)', () => {
    useAppStore.getState().setExportRange(3, 7);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 3, end: 7 });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: normalization — zero-length
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: zero-length collapses to null', () => {
  beforeEach(() => seedStore());

  it('stores null when start === end', () => {
    useAppStore.getState().setExportRange(5, 5);
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });

  it('stores null when both are 0', () => {
    useAppStore.getState().setExportRange(0, 0);
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: clamping to [0, projectDuration]
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: clamping to [0, projectDuration]', () => {
  it('clamps negative start to 0', () => {
    seedStore([], 120);
    useAppStore.getState().setExportRange(-5, 10);
    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBe(10);
  });

  it('clamps end beyond projectDuration to projectDuration', () => {
    // One clip ending at beat 16 → computeTotalBeats = max(64,16)+32 = 96 beats
    // projectDuration = 96 * 60 / 120 = 48 s
    const clips = [makeClip('a', 'fx1', 0, 16)];
    seedStore(clips, 120);
    const dur = expectedProjectDuration(clips, 120);
    // dur should be 48 s
    useAppStore.getState().setExportRange(0, dur + 100);
    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    expect(range!.end).toBe(dur);
  });

  it('clamps both start and end when both are out of range', () => {
    const clips = [makeClip('a', 'fx1', 0, 16)];
    seedStore(clips, 120);
    const dur = expectedProjectDuration(clips, 120);
    useAppStore.getState().setExportRange(-10, dur + 50);
    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBe(dur);
  });

  it('after swapping a backwards range, clamp applies to the normalized order', () => {
    // start=dur+10, end=-5 → swap → start=-5, end=dur+10 → clamp → [0, dur]
    const clips = [makeClip('a', 'fx1', 0, 16)];
    seedStore(clips, 120);
    const dur = expectedProjectDuration(clips, 120);
    useAppStore.getState().setExportRange(dur + 10, -5);
    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBe(dur);
  });

  it('collapses to null when after clamping start === end', () => {
    // If both start and end are beyond projectDuration → both clamp to dur → equal → null
    const clips = [makeClip('a', 'fx1', 0, 16)];
    seedStore(clips, 120);
    const dur = expectedProjectDuration(clips, 120);
    useAppStore.getState().setExportRange(dur + 5, dur + 10);
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: undo/redo must not touch exportRange
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: untouched by undo/redo', () => {
  beforeEach(() => {
    seedStore();
  });

  it('exportRange is unchanged after undo of a timeline mutation', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    // Set a range first.
    useAppStore.getState().setExportRange(1, 5);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 1, end: 5 });

    // Perform a recorded (non-skip) timeline mutation.
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'test'
    });
    expect(useAppStore.getState().history.past).toHaveLength(1);

    // Undo → timeline reverts, exportRange stays.
    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 1, end: 5 });
  });

  it('exportRange is unchanged after redo', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().setExportRange(2, 8);

    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'test'
    });
    useAppStore.getState().undo();
    useAppStore.getState().redo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
    expect(useAppStore.getState().ui.exportRange).toEqual({ start: 2, end: 8 });
  });

  it('clearing exportRange in the middle of undo/redo cycle does not affect history', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'test'
    });
    // history.past has 1 entry now
    useAppStore.getState().setExportRange(1, 5);
    useAppStore.getState().clearExportRange();
    // skip:true — history stack unchanged
    expect(useAppStore.getState().history.past).toHaveLength(1);
    useAppStore.getState().undo();
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: not in persisted shape + not in undo snapshot
// ---------------------------------------------------------------------------
describe('Plan 9d — exportRange: excluded from persisted shape', () => {
  it('toPersistedShape().ui has no exportRange field', () => {
    useAppStore.getState().setExportRange(1, 5);
    const state = useAppStore.getState();
    // Construct the persisted shape using the real function.
    const persisted = toPersistedShape(state as never);
    expect(Object.keys(persisted.ui)).not.toContain('exportRange');
    // Only zoom should be present.
    expect(Object.keys(persisted.ui)).toEqual(['zoom']);
  });

  it('undo snapshot does not contain exportRange (ui is excluded from snapshots)', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    seedStore();
    useAppStore.getState().setExportRange(3, 9);
    // Trigger a recorded action so a snapshot is captured.
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'snap-test'
    });
    const snapshot = useAppStore.getState().history.past[0];
    // HistoryEntry has only `timeline`, `audio`, `label`, `timestamp`.
    // ui is NOT in the snapshot type — verifying the runtime object too.
    expect(snapshot).not.toHaveProperty('ui');
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining(['timeline', 'audio', 'label', 'timestamp'])
    );
    expect(Object.keys(snapshot)).not.toContain('ui');
  });
});
