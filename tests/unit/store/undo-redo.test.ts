import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { MAX_HISTORY } from '@/lib/store/history-types';

/**
 * Plan 10 — Undo / Redo behaviour suite.
 *
 * Covers the architect's must-test list:
 *  - basic record on a single action
 *  - past/future stack movement
 *  - new mutation invalidates the future stack
 *  - playhead is NOT restored by undo (DAW-standard, D3/L4)
 *  - skip:true mutations don't show up in history
 *  - coalesce only triggers on label match (W8)
 *  - MAX_HISTORY cap drops the oldest entry
 *  - clearHistory empties both stacks
 */
describe('Plan 10 — recordingSet + undo + redo', () => {
  beforeEach(() => {
    useAppStore.setState({
      timeline: { ...initialTimelineState },
      history: { past: [], future: [] }
    });
  });

  it('records a snapshot when a non-skip recordingSet runs', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    const hist = useAppStore.getState().history;
    expect(hist.past).toHaveLength(1);
    // addClip uses `Add ${clip.kind}` so the Undo tooltip names the FX.
    expect(hist.past[0].label).toBe('Add contour');
    expect(hist.future).toHaveLength(0);
  });

  it('undo restores the pre-action state and pushes onto future', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);

    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(1);
  });

  it('redo re-applies the change and pops back from future', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    useAppStore.getState().undo();
    useAppStore.getState().redo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
    expect(useAppStore.getState().history.past).toHaveLength(1);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it('a new mutation after undo invalidates the future stack', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    useAppStore.getState().undo();
    expect(useAppStore.getState().history.future).toHaveLength(1);

    useAppStore.getState().timelineActions.addClip({
      id: 'c2',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 8,
      lengthBeats: 4,
      label: 'two'
    });
    expect(useAppStore.getState().history.future).toHaveLength(0);
    expect(useAppStore.getState().history.past).toHaveLength(1);
  });

  it('skip:true does NOT push a history entry', () => {
    // setPlayhead is `skip:true` (60×/s firing — would bloat the stack).
    useAppStore.getState().timelineActions.setPlayhead(42);
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(42);
  });

  it('undo preserves the current playhead instead of restoring it', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    // At t=0, add a clip (records past[0] with playhead.beats=0).
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    // User scrubs to 100 (skip:true, no history).
    useAppStore.getState().timelineActions.setPlayhead(100);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(100);

    // Undo the addClip — playhead should STAY at 100.
    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    expect(useAppStore.getState().timeline.playhead.beats).toBe(100);
  });

  it('coalesce with label match folds into the previous entry', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    // pre-drag snapshot exists in past[0]; moveClip uses coalesce:true.
    useAppStore.getState().timelineActions.moveClip('c1', 8);
    useAppStore.getState().timelineActions.moveClip('c1', 16);
    useAppStore.getState().timelineActions.moveClip('c1', 24);
    // 1 (addClip) + 1 (first moveClip's fresh snapshot) — coalesce
    // means the 2nd + 3rd move don't push new entries.
    expect(useAppStore.getState().history.past).toHaveLength(2);
    // Undo should jump back to the pre-drag startBeat=0, NOT the
    // intermediate 8 or 16.
    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips[0].startBeat).toBe(0);
  });

  it('coalesce with DIFFERENT label still pushes a new entry (W8)', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    useAppStore.getState().timelineActions.moveClip('c1', 8); // 'Move Clip'
    useAppStore.getState().timelineActions.resizeClip('c1', 16); // 'Resize Clip' — different label
    // addClip + moveClip + resizeClip = 3 distinct past entries.
    expect(useAppStore.getState().history.past).toHaveLength(3);
  });

  it('MAX_HISTORY caps the past stack by dropping the oldest entry', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    // Add MAX_HISTORY + 5 clips. Each addClip records a fresh entry.
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      useAppStore.getState().timelineActions.addClip({
        id: `c${i}`,
        trackId: fxTrack.id,
        kind: 'contour',
        startBeat: i * 4,
        lengthBeats: 4,
        label: `clip ${i}`
      });
    }
    const past = useAppStore.getState().history.past;
    expect(past.length).toBe(MAX_HISTORY);
    // The oldest 5 entries should have been shifted off — the first
    // entry now corresponds to clip #5 (counting from 0).
    expect(past[0].timeline.clips.length).toBe(5);
  });

  it('clearHistory empties both stacks', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    useAppStore.getState().undo();
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(1);

    useAppStore.getState().clearHistory();
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it('undo on empty past stack is a no-op', () => {
    useAppStore.getState().undo();
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it('redo on empty future stack is a no-op', () => {
    useAppStore.getState().redo();
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it('audio.setBPM is recorded (label "Change BPM")', () => {
    useAppStore.getState().audioActions.setBPM(140);
    expect(useAppStore.getState().history.past).toHaveLength(1);
    expect(useAppStore.getState().history.past[0].label).toBe('Change BPM');
    useAppStore.getState().undo();
    expect(useAppStore.getState().audio.grid.bpm).not.toBe(140);
  });

  it('media actions skip history (R2-bound — undo would orphan blobs)', () => {
    useAppStore.getState().mediaActions.addMediaRef({
      id: 'm1',
      kind: 'image',
      url: 'https://r2.dev/m1.jpg',
      filename: 'm1.jpg',
      uploadedAt: new Date().toISOString()
    });
    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().media.mediaRefs).toHaveLength(1);
  });

  it('mobile UI tab switch skips history', () => {
    useAppStore.getState().mobileUIActions.setMobileTab('media');
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it('app-mode switch skips history (top-level workspace mode)', () => {
    useAppStore.getState().setAppMode('sceneflow');
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it('the snapshotted entry is decoupled from the live state (deep clone)', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    const snapshotClipsBefore = useAppStore
      .getState()
      .history.past[0].timeline.clips.length;
    // Live mutation: add another clip.
    useAppStore.getState().timelineActions.addClip({
      id: 'c2',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 8,
      lengthBeats: 4,
      label: 'two'
    });
    // The OLD snapshot must not have grown — past[0] reflects the
    // state BEFORE addClip('c1') ran (so 0 clips), past[1] reflects
    // the state BEFORE addClip('c2') (so 1 clip).
    expect(useAppStore.getState().history.past[0].timeline.clips.length).toBe(
      snapshotClipsBefore
    );
    expect(useAppStore.getState().history.past[1].timeline.clips.length).toBe(1);
  });

  it('multiple undo/redo round-trips stay consistent', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'a',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'a'
    });
    useAppStore.getState().timelineActions.addClip({
      id: 'b',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 8,
      lengthBeats: 4,
      label: 'b'
    });
    useAppStore.getState().timelineActions.addClip({
      id: 'c',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 16,
      lengthBeats: 4,
      label: 'c'
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(3);

    useAppStore.getState().undo();
    useAppStore.getState().undo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);

    useAppStore.getState().redo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(2);

    useAppStore.getState().redo();
    expect(useAppStore.getState().timeline.clips).toHaveLength(3);
  });

  it('persist does NOT serialize the history field', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    useAppStore.getState().timelineActions.addClip({
      id: 'c1',
      trackId: fxTrack.id,
      kind: 'contour',
      startBeat: 0,
      lengthBeats: 4,
      label: 'one'
    });
    // Read whatever the persist middleware wrote to localStorage.
    const raw = localStorage.getItem('vibegrid-store');
    expect(raw).not.toBeNull();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed.state.history).toBeUndefined();
  });
});
