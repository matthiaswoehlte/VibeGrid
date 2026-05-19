import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useAppStore } from '@/lib/store';

describe('useAudioEngine', () => {
  beforeEach(() => {
    useAppStore.setState({
      audio: { grid: { bpm: 120, offsetMs: 0, beatsPerBar: 4, source: 'manual' } }
    });
  });

  it('lazy-inits the engine on first render', () => {
    const { result } = renderHook(() => useAudioEngine());
    expect(result.current.engine).toBeTruthy();
  });

  it('user-edited store BPM propagates to engine.setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      // audio-slice's setBPM forces source: 'manual' — passes the source-guard
      useAppStore.getState().audioActions.setBPM(140);
    });
    expect(setBpmSpy).toHaveBeenCalledWith(140);
  });

  it('engine-detected grid (source: detected) does NOT re-trigger engine.setBPM', () => {
    const { result } = renderHook(() => useAudioEngine());
    const setBpmSpy = vi.spyOn(result.current.engine!, 'setBPM');
    act(() => {
      // audio-slice's setDetectedGrid forces source: 'detected' — source-guard skips
      useAppStore.getState().audioActions.setDetectedGrid({
        bpm: 128,
        offsetMs: 12,
        beatsPerBar: 4,
        source: 'detected'
      });
    });
    expect(setBpmSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().audio.grid.bpm).toBe(128);
  });

  it('cleans up engine on unmount', () => {
    const { result, unmount } = renderHook(() => useAudioEngine());
    const destroySpy = vi.spyOn(result.current.engine!, 'destroy');
    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });
});
