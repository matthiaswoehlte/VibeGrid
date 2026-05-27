import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import type { Clip } from '@/lib/timeline/types';

function makeClip(
  id: string,
  trackId: string,
  startBeat: number,
  lengthBeats: number,
  kind: Clip['kind'] = 'pulse',
  fxId: string | undefined = 'pulse'
): Clip {
  return {
    id,
    trackId,
    kind,
    fxId,
    startBeat,
    lengthBeats,
    label: id
  };
}

function seed(clips: Clip[]): void {
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [
        { id: 't1', kind: 'fx', name: 'A', muted: false },
        { id: 't2', kind: 'fx', name: 'B', muted: false }
      ],
      clips
    },
    ui: {
      zoom: 1,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1',
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false
    }
  }));
}

describe('Plan 9b — selection actions', () => {
  beforeEach(() => {
    seed([]);
  });

  it('selectClips replaces the current selection', () => {
    seed([makeClip('a', 't1', 0, 4), makeClip('b', 't1', 5, 4)]);
    useAppStore.getState().selectClips(['a']);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual(['a']);
    useAppStore.getState().selectClips(['b']);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual(['b']);
  });

  it('selectClips dedups and syncs the singular compat field', () => {
    useAppStore.getState().selectClips(['a', 'a', 'b']);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual(['a', 'b']);
    expect(useAppStore.getState().ui.selectedClipId).toBeNull();
    useAppStore.getState().selectClips(['a']);
    expect(useAppStore.getState().ui.selectedClipId).toBe('a');
  });

  it('addToSelection merges without duplicating', () => {
    useAppStore.getState().selectClips(['a']);
    useAppStore.getState().addToSelection(['a', 'b']);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual(['a', 'b']);
  });

  it('clearSelection empties the array and clears compat fields', () => {
    useAppStore.getState().selectClips(['a', 'b']);
    useAppStore.getState().clearSelection();
    expect(useAppStore.getState().ui.selectedClipIds).toEqual([]);
    expect(useAppStore.getState().ui.selectedClipId).toBeNull();
    expect(useAppStore.getState().ui.automationEditorClipId).toBeNull();
  });

  it('setSelectedClipId compat-shim keeps selectedClipIds in lockstep', () => {
    useAppStore.getState().setSelectedClipId('x');
    expect(useAppStore.getState().ui.selectedClipIds).toEqual(['x']);
    expect(useAppStore.getState().ui.selectedClipId).toBe('x');
    useAppStore.getState().setSelectedClipId(null);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual([]);
  });
});

describe('Plan 9b — moveSelectedClips', () => {
  it('shifts every selected clip by deltaBeats in one mutation', () => {
    seed([
      makeClip('a', 't1', 4, 4),
      makeClip('b', 't1', 10, 4),
      makeClip('c', 't1', 20, 4) // not selected
    ]);
    useAppStore.getState().selectClips(['a', 'b']);
    useAppStore.getState().moveSelectedClips(2);
    const clips = useAppStore.getState().timeline.clips;
    expect(clips.find((c) => c.id === 'a')?.startBeat).toBe(6);
    expect(clips.find((c) => c.id === 'b')?.startBeat).toBe(12);
    expect(clips.find((c) => c.id === 'c')?.startBeat).toBe(20);
  });

  it('clamps negative delta so no clip lands below startBeat 0', () => {
    seed([makeClip('a', 't1', 2, 4), makeClip('b', 't1', 8, 4)]);
    useAppStore.getState().selectClips(['a', 'b']);
    useAppStore.getState().moveSelectedClips(-5);
    const clips = useAppStore.getState().timeline.clips;
    // a was at 2, would go to -3 → clamp to allow only -2 delta.
    expect(clips.find((c) => c.id === 'a')?.startBeat).toBe(0);
    expect(clips.find((c) => c.id === 'b')?.startBeat).toBe(6);
  });

  it('is a no-op with empty selection', () => {
    seed([makeClip('a', 't1', 4, 4)]);
    useAppStore.getState().moveSelectedClips(10);
    expect(useAppStore.getState().timeline.clips[0].startBeat).toBe(4);
  });
});

describe('Plan 9b — resizeSelectedClips', () => {
  it('grows every selected clip on the "end" edge', () => {
    seed([makeClip('a', 't1', 0, 4), makeClip('b', 't1', 10, 8)]);
    useAppStore.getState().selectClips(['a', 'b']);
    useAppStore.getState().resizeSelectedClips(2, 'end');
    const clips = useAppStore.getState().timeline.clips;
    expect(clips.find((c) => c.id === 'a')?.lengthBeats).toBe(6);
    expect(clips.find((c) => c.id === 'b')?.lengthBeats).toBe(10);
  });

  it('clamps each clip independently to 0.5 min (architect L4)', () => {
    seed([makeClip('a', 't1', 0, 4), makeClip('b', 't1', 10, 1)]);
    useAppStore.getState().selectClips(['a', 'b']);
    // delta -5 would make a=−1 and b=−4; clamp to 0.5 individually.
    useAppStore.getState().resizeSelectedClips(-5, 'end');
    const clips = useAppStore.getState().timeline.clips;
    expect(clips.find((c) => c.id === 'a')?.lengthBeats).toBe(0.5);
    expect(clips.find((c) => c.id === 'b')?.lengthBeats).toBe(0.5);
  });
});

describe('Plan 9b — duplicateSelectedClips', () => {
  it('creates new clips at +offsetBeats with fresh ids', () => {
    seed([makeClip('a', 't1', 0, 4), makeClip('b', 't1', 5, 3)]);
    useAppStore.getState().selectClips(['a', 'b']);
    const added = useAppStore.getState().duplicateSelectedClips(10);
    expect(added).toBe(2);
    const clips = useAppStore.getState().timeline.clips;
    expect(clips).toHaveLength(4);
    const dups = clips.filter((c) => c.id !== 'a' && c.id !== 'b');
    expect(dups.map((c) => c.startBeat).sort((x, y) => x - y)).toEqual([10, 15]);
  });

  it('selects the new clips and de-selects the originals', () => {
    seed([makeClip('a', 't1', 0, 4)]);
    useAppStore.getState().selectClips(['a']);
    useAppStore.getState().duplicateSelectedClips(8);
    const selected = useAppStore.getState().ui.selectedClipIds;
    expect(selected).not.toContain('a');
    expect(selected).toHaveLength(1);
  });

  it('skips duplicates that would land at the same (trackId, startBeat) as an existing clip', () => {
    seed([
      makeClip('a', 't1', 0, 4),
      makeClip('b', 't1', 4, 4) // would collide with a's duplicate at startBeat 4
    ]);
    useAppStore.getState().selectClips(['a']);
    const added = useAppStore.getState().duplicateSelectedClips(4);
    expect(added).toBe(0);
    expect(useAppStore.getState().timeline.clips).toHaveLength(2);
  });

  it('deep-clones AutomationCurves with beat-offset (W5)', () => {
    const curveClip: Clip = {
      ...makeClip('a', 't1', 0, 4),
      params: {
        intensity: {
          kind: 'auto',
          points: [
            { beat: 0, value: 0 },
            { beat: 2, value: 1 }
          ]
        }
      } as never
    };
    seed([curveClip]);
    useAppStore.getState().selectClips(['a']);
    useAppStore.getState().duplicateSelectedClips(10);
    const clips = useAppStore.getState().timeline.clips;
    const dup = clips.find((c) => c.id !== 'a')!;
    const dupCurve = (dup.params as Record<string, unknown>).intensity as {
      points: { beat: number; value: number }[];
    };
    expect(dupCurve.points.map((p) => p.beat)).toEqual([10, 12]);
    // Mutation safety: the original's points array must not share refs.
    const origCurve = (curveClip.params as Record<string, unknown>)
      .intensity as { points: { beat: number; value: number }[] };
    expect(origCurve.points[0].beat).toBe(0);
    expect(dupCurve.points).not.toBe(origCurve.points);
  });
});

describe('Plan 9b — deleteSelectedClips', () => {
  it('removes every selected clip and clears the selection', () => {
    seed([
      makeClip('a', 't1', 0, 4),
      makeClip('b', 't1', 5, 4),
      makeClip('c', 't2', 0, 4)
    ]);
    useAppStore.getState().selectClips(['a', 'c']);
    useAppStore.getState().deleteSelectedClips();
    const clips = useAppStore.getState().timeline.clips;
    expect(clips.map((c) => c.id)).toEqual(['b']);
    expect(useAppStore.getState().ui.selectedClipIds).toEqual([]);
  });
});
