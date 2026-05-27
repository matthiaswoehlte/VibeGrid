import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { UndoRedoButtons } from '@/components/Workspace/UndoRedoButtons';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';

/**
 * Plan 10 — disabled-state derives from history.past / future lengths;
 * tooltip surfaces the label of the next undo target so the user knows
 * what's about to revert.
 */
describe('UndoRedoButtons', () => {
  beforeEach(() => {
    useAppStore.setState({
      timeline: { ...initialTimelineState },
      history: { past: [], future: [] }
    });
  });

  it('both buttons start disabled when history is empty', () => {
    render(<UndoRedoButtons />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it('Undo button enables after a recorded mutation', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    render(<UndoRedoButtons />);
    act(() => {
      useAppStore.getState().timelineActions.addClip({
        id: 'c1',
        trackId: fxTrack.id,
        kind: 'contour',
        startBeat: 0,
        lengthBeats: 4,
        label: 'one'
      });
    });
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).not.toBeDisabled();
    // tooltip surfaces the label of the next undo target.
    expect(undo.getAttribute('title')).toBe('Undo: Add contour');
  });

  it('clicking Undo reverts the change AND enables Redo', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    render(<UndoRedoButtons />);
    act(() => {
      useAppStore.getState().timelineActions.addClip({
        id: 'c1',
        trackId: fxTrack.id,
        kind: 'contour',
        startBeat: 0,
        lengthBeats: 4,
        label: 'one'
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(redo).not.toBeDisabled();
    expect(redo.getAttribute('title')).toBe('Redo: Add contour');
  });

  it('clicking Redo re-applies the change', () => {
    const fxTrack = initialTimelineState.tracks.find((t) => t.kind === 'fx')!;
    render(<UndoRedoButtons />);
    act(() => {
      useAppStore.getState().timelineActions.addClip({
        id: 'c1',
        trackId: fxTrack.id,
        kind: 'contour',
        startBeat: 0,
        lengthBeats: 4,
        label: 'one'
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useAppStore.getState().timeline.clips).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
  });
});
