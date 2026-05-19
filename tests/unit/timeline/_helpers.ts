import type { Clip, TimelineState, Track } from '@/lib/timeline/types';

export function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'kind'>): Track {
  return {
    name: overrides.name ?? `${overrides.kind}-track`,
    muted: false,
    order: 0,
    ...overrides
  };
}

export function makeClip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip {
  return {
    startBeat: 0,
    lengthBeats: 4,
    label: overrides.id,
    ...overrides
  };
}

export function makeState(overrides?: Partial<TimelineState>): TimelineState {
  return {
    tracks: [],
    clips: [],
    playhead: { beats: 0, playing: false },
    zoom: 1,
    snap: 'beat',
    ...overrides
  };
}

/**
 * Deep-freeze a TimelineState so accidental mutation throws under strict mode.
 * Works on arrays too: Object.keys on an array returns string indices ('0', '1', …),
 * which is intentional — every element is visited and frozen recursively.
 */
export function freezeState<T extends object>(value: T): T {
  Object.freeze(value);
  for (const key of Object.keys(value) as (keyof T)[]) {
    const v = value[key];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) freezeState(v as object);
  }
  return value;
}
