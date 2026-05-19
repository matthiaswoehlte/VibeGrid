import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Clip } from '@/components/Workspace/Timeline/Clip';
import { DndContext } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';

describe('Clip', () => {
  beforeEach(() => {
    useAppStore.setState({
      ui: { zoom: 1, selectedClipId: null },
      timeline: {
        tracks: [{ id: 't1', kind: 'pulse', name: 'P', muted: false, order: 0 }],
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            kind: 'pulse',
            startBeat: 2,
            lengthBeats: 4,
            label: 'Pulse',
            fxId: 'pulse'
          }
        ],
        playhead: { beats: 0, playing: false },
        zoom: 1,
        snap: 'beat'
      }
    });
  });

  it('renders the label', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    expect(screen.getByText('Pulse')).toBeInTheDocument();
  });

  it('click sets selectedClipId in the store', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    fireEvent.click(screen.getByText('Pulse'));
    expect(useAppStore.getState().ui.selectedClipId).toBe('c1');
  });

  it('right-edge pointer-drag triggers resizeClip', () => {
    render(
      <DndContext>
        <Clip clip={useAppStore.getState().timeline.clips[0]} />
      </DndContext>
    );
    const handle = screen.getByLabelText('Resize clip');

    // jsdom's PointerEvent doesn't carry clientX through fireEvent.pointerDown —
    // dispatch native MouseEvents (jsdom-reliable) but with the pointer* type
    // names the handler listens for.
    const down = new MouseEvent('pointerdown', { clientX: 100, bubbles: true });
    handle.dispatchEvent(down);
    const move = new MouseEvent('pointermove', { clientX: 180, bubbles: true });
    window.dispatchEvent(move);
    const up = new MouseEvent('pointerup', { bubbles: true });
    window.dispatchEvent(up);

    expect(useAppStore.getState().timeline.clips[0].lengthBeats).toBeGreaterThan(4);
  });
});
