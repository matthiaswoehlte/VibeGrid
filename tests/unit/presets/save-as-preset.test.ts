import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureTimelineAsPreset,
  getUserPresets,
  removeUserPreset,
  saveUserPreset
} from '@/lib/presets/save-as-preset';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, clips: [] }
  }));
});

describe('captureTimelineAsPreset', () => {
  it('returns pack with only FX clips (media clips skipped)', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'a',
            trackId: 'track-audio',
            kind: 'audio',
            startBeat: 0,
            lengthBeats: 16,
            label: 'A',
            params: {}
          },
          {
            id: 'b',
            trackId: 'track-fx-1',
            kind: 'zoom-punch',
            startBeat: 0,
            lengthBeats: 8,
            label: 'ZP',
            params: { strength: 1.1 }
          }
        ]
      }
    }));
    const pack = captureTimelineAsPreset(120, 'My Preset', 'Drop');
    expect(pack.fx.length).toBe(1);
    expect(pack.fx[0].fxKind).toBe('ZoomPunch'); // PascalCase back
    expect(pack.fx[0].params.strength).toBe(1.1);
  });

  it('marks pack source as user', () => {
    const pack = captureTimelineAsPreset(120, 'Empty Pack', 'Drop');
    expect(pack.source).toBe('user');
    expect(pack.id).toMatch(/^user-/);
  });

  it('defensively copies clip params (mutation does not leak into store)', () => {
    useAppStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        clips: [
          {
            id: 'x',
            trackId: 'track-fx-1',
            kind: 'zoom-punch',
            startBeat: 0,
            lengthBeats: 8,
            label: 'ZP',
            params: { strength: 1.5 }
          }
        ]
      }
    }));
    const pack = captureTimelineAsPreset(120, 'X', 'Drop');
    pack.fx[0].params.strength = 99;
    const storedStrength = useAppStore.getState().timeline.clips[0].params!.strength;
    expect(storedStrength).toBe(1.5);
  });
});

describe('user-preset localStorage round-trip', () => {
  it('saveUserPreset then getUserPresets returns the saved pack', () => {
    const pack = captureTimelineAsPreset(120, 'Lo-Fi Test', 'Verse');
    saveUserPreset(pack);
    const reloaded = getUserPresets();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0].name).toBe('Lo-Fi Test');
    expect(reloaded[0].id).toBe(pack.id);
  });

  it('empty localStorage returns []', () => {
    expect(getUserPresets()).toEqual([]);
  });

  it('corrupted JSON returns [] (no throw)', () => {
    localStorage.setItem('vg_user_presets', '{not valid json');
    expect(getUserPresets()).toEqual([]);
  });

  it('removeUserPreset deletes by id', () => {
    const a = captureTimelineAsPreset(120, 'A', 'Drop');
    const b = captureTimelineAsPreset(120, 'B', 'Drop');
    saveUserPreset(a);
    saveUserPreset(b);
    removeUserPreset(a.id);
    const remaining = getUserPresets();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(b.id);
  });
});
