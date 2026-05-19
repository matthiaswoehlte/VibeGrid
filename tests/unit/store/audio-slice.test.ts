import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialAudioGrid } from '@/lib/store/audio-slice';

describe('audio store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ audio: { grid: initialAudioGrid } });
  });

  it('exposes initialAudioGrid (120 BPM, manual)', () => {
    expect(useAppStore.getState().audio.grid).toEqual(initialAudioGrid);
  });

  it('setBPM clamps to [60, 200] and sets source=manual', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setBPM(45);
    expect(useAppStore.getState().audio.grid.bpm).toBe(60);
    audioActions.setBPM(250);
    expect(useAppStore.getState().audio.grid.bpm).toBe(200);
    audioActions.setBPM(140);
    expect(useAppStore.getState().audio.grid.bpm).toBe(140);
    expect(useAppStore.getState().audio.grid.source).toBe('manual');
  });

  it('setDetectedGrid stores detected beats and marks source=detected', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setDetectedGrid({
      bpm: 128,
      source: 'manual',
      beatsPerBar: 4,
      offsetMs: 0,
      detectedBeats: [0.5, 1.0, 1.5, 2.0]
    });
    const g = useAppStore.getState().audio.grid;
    expect(g.bpm).toBe(128);
    expect(g.source).toBe('detected');
    expect(g.detectedBeats).toHaveLength(4);
  });

  it('resetGrid returns to defaults', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setBPM(140);
    audioActions.resetGrid();
    expect(useAppStore.getState().audio.grid).toEqual(initialAudioGrid);
  });
});
