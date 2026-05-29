import { describe, it, expect } from 'vitest';
import { migrate } from '@/lib/store';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const baseTimeline = {
  tracks: [
    { id: 't-fx', kind: 'fx', name: 'FX', muted: false }
  ],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

function snapshotWith(clips: unknown[]): unknown {
  return { timeline: { ...baseTimeline, clips } };
}

describe('Store migration v6 → v7 (Plan 9c — beatSync number → boolean)', () => {
  it('flips params.beatSync = 1 (number) → true on an FX clip', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-fx',
        kind: 'rgb-split',
        fxId: 'rgb-split',
        startBeat: 0,
        lengthBeats: 4,
        label: 'RGB',
        params: { beatSync: 1, decay: 0.15 }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: { beatSync: unknown } }[] } };
    expect(out.timeline.clips[0].params.beatSync).toBe(true);
  });

  it('flips params.beatSync = 0 (number) → false on an FX clip', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-fx',
        kind: 'rgb-split',
        fxId: 'rgb-split',
        startBeat: 0,
        lengthBeats: 4,
        label: 'RGB',
        params: { beatSync: 0 }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: { beatSync: unknown } }[] } };
    expect(out.timeline.clips[0].params.beatSync).toBe(false);
  });

  it('leaves an already-boolean beatSync unchanged (idempotent)', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-fx',
        kind: 'rgb-split',
        startBeat: 0,
        lengthBeats: 4,
        label: 'RGB',
        params: { beatSync: true }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: { beatSync: unknown } }[] } };
    expect(out.timeline.clips[0].params.beatSync).toBe(true);
  });

  it('leaves an FX clip without beatSync untouched', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-fx',
        kind: 'pulse',
        startBeat: 0,
        lengthBeats: 4,
        label: 'P',
        params: { intensity: 0.5 }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: { intensity: number; beatSync?: unknown } }[] } };
    expect(out.timeline.clips[0].params.beatSync).toBeUndefined();
    expect(out.timeline.clips[0].params.intensity).toBe(0.5);
  });

  it('leaves a non-FX clip with a params.beatSync key untouched (defensive)', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-aud',
        kind: 'audio',
        startBeat: 0,
        lengthBeats: 4,
        label: 'A',
        // pathological — audio clips don't actually carry beatSync, but the
        // migration must only touch FX clips so it never invents booleans
        // on a foreign param.
        params: { beatSync: 1, volume: 0.8 }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: { beatSync: unknown } }[] } };
    expect(out.timeline.clips[0].params.beatSync).toBe(1);
  });

  it('preserves siblings on the params object', () => {
    const snap = snapshotWith([
      {
        id: 'c1',
        trackId: 't-fx',
        kind: 'rgb-split',
        startBeat: 0,
        lengthBeats: 4,
        label: 'RGB',
        params: { beatSync: 1, decay: 0.15, intensity: 0.6 }
      }
    ]);
    const out = migrate(clone(snap), 6) as { timeline: { clips: { params: Record<string, unknown> }[] } };
    expect(out.timeline.clips[0].params).toEqual({
      beatSync: true,
      decay: 0.15,
      intensity: 0.6
    });
  });
});
