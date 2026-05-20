import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { AutomationCurveEditor } from '@/components/Workspace/Timeline/AutomationCurveEditor';
import type { AutomationCurve } from '@/lib/automation/types';

const CLIP_ID = 'clip-edit';

beforeEach(() => {
  _resetBuiltInPluginsForTests();
  registerBuiltInPlugins();
  useAppStore.setState((s) => ({
    timeline: {
      ...s.timeline,
      clips: [
        {
          id: CLIP_ID,
          trackId: 'track-pulse',
          kind: 'pulse',
          fxId: 'pulse',
          startBeat: 0,
          lengthBeats: 8,
          label: 'Edit',
          params: {
            intensity: {
              mode: 'automation',
              interpolation: 'linear',
              points: [
                { beat: 0, value: 0 },
                { beat: 4, value: 0.5 }
              ]
            } satisfies AutomationCurve<number>
          }
        }
      ]
    }
  }));
});

const renderEditor = () => {
  const clip = useAppStore.getState().timeline.clips[0];
  const curve = clip.params!.intensity as AutomationCurve<number>;
  render(
    <AutomationCurveEditor
      clipId={CLIP_ID}
      paramKey="intensity"
      paramLabel="Intensity"
      curve={curve}
      lengthBeats={8}
      valueMin={0}
      valueMax={1}
    />
  );
};

const openOverlayFor = (index: number) => {
  renderEditor();
  fireEvent.doubleClick(screen.getByLabelText(`Automation point ${index + 1}`));
};

describe('EditOverlay (inside AutomationCurveEditor)', () => {
  it('double-click opens the overlay with current beat + value', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i) as HTMLInputElement;
    const valueInput = screen.getByLabelText(/value/i) as HTMLInputElement;
    expect(beatInput.value).toBe('4');
    expect(valueInput.value).toBe('0.5');
  });

  it('Enter on the beat input commits the new beat', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i);
    fireEvent.change(beatInput, { target: { value: '5.5' } });
    fireEvent.keyDown(beatInput, { key: 'Enter' });
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(5.5);
  });

  it('blur on the value input commits the new value', () => {
    openOverlayFor(1);
    const valueInput = screen.getByLabelText(/value/i);
    fireEvent.change(valueInput, { target: { value: '0.9' } });
    fireEvent.blur(valueInput);
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].value).toBe(0.9);
  });

  it('Escape closes the overlay without committing pending input', () => {
    openOverlayFor(1);
    const beatInput = screen.getByLabelText(/beat/i);
    fireEvent.change(beatInput, { target: { value: '99' } });
    fireEvent.keyDown(beatInput, { key: 'Escape' });
    expect(screen.queryByLabelText(/beat/i)).toBeNull();
    const c = useAppStore.getState().timeline.clips[0].params!
      .intensity as AutomationCurve<number>;
    expect(c.points[1].beat).toBe(4);
  });
});
