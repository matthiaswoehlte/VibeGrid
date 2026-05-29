import { describe, it, expect } from 'vitest';
import {
  soundDisplayLabel,
  _VISUAL_PREFIXES_FOR_TESTS
} from '@/lib/sounds/display';

describe('soundDisplayLabel — prefix-stripping for user-facing list', () => {
  it('strips VG_AMB - prefix', () => {
    expect(soundDisplayLabel('VG_AMB - BLIZZARD 2 - A')).toBe('BLIZZARD 2 - A');
  });

  it('strips VG_DRUM LOOP - prefix (multi-word category)', () => {
    expect(soundDisplayLabel('VG_DRUM LOOP - CLOCK BROKEN')).toBe('CLOCK BROKEN');
  });

  it('strips VG_BOOM - prefix', () => {
    expect(soundDisplayLabel('VG_BOOM - CUNNING (KP)')).toBe('CUNNING (KP)');
  });

  it('strips VG_HIT - prefix', () => {
    expect(soundDisplayLabel('VG_HIT - PUNCH')).toBe('PUNCH');
  });

  it('strips VG_MID PERC - prefix', () => {
    expect(soundDisplayLabel('VG_MID PERC - TICK')).toBe('TICK');
  });

  it('strips VG_ATMOS - prefix', () => {
    expect(soundDisplayLabel('VG_ATMOS - DEEP NIGHT')).toBe('DEEP NIGHT');
  });

  it('strips VG_RISER - prefix', () => {
    expect(soundDisplayLabel('VG_RISER - TENSION 01')).toBe('TENSION 01');
  });

  it('strips VG_SIG - prefix', () => {
    expect(soundDisplayLabel('VG_SIG - LOGO STAMP')).toBe('LOGO STAMP');
  });

  it('strips VG_CYMBAL - prefix', () => {
    expect(soundDisplayLabel('VG_CYMBAL - CRASH 1')).toBe('CRASH 1');
  });

  it('strips VG_DOWNER - prefix', () => {
    expect(soundDisplayLabel('VG_DOWNER - CLEAN DROP 1')).toBe('CLEAN DROP 1');
  });

  it('strips VG_WHOOSH - prefix (with hyphen)', () => {
    expect(soundDisplayLabel('VG_WHOOSH - BACK STREET')).toBe('BACK STREET');
  });

  it('strips VG_WHOOSH prefix on multi-word HIT / LIGHT / ROLL variants', () => {
    expect(soundDisplayLabel('VG_WHOOSH HIT - BLACKWOOD')).toBe('HIT - BLACKWOOD');
    expect(soundDisplayLabel('VG_WHOOSH LIGHT - ARKANGEL')).toBe(
      'LIGHT - ARKANGEL'
    );
    expect(soundDisplayLabel('VG_WHOOSH ROLL - WEBAD DEEP')).toBe(
      'ROLL - WEBAD DEEP'
    );
  });

  it('VG_WHOOSH - (with hyphen) takes precedence over VG_WHOOSH (space) — no leading dash', () => {
    // Order matters in the prefix table — the longer hyphen variant
    // must match first or the result is `- BACK STREET`.
    expect(soundDisplayLabel('VG_WHOOSH - BACK STREET').startsWith('-')).toBe(
      false
    );
  });

  it('label without a known prefix is returned untouched', () => {
    expect(soundDisplayLabel('Heavy Custom Sound')).toBe('Heavy Custom Sound');
  });

  it('label that becomes empty after stripping falls back to the original', () => {
    // Defensive — an `VG_AMB - ` entry with nothing after would render
    // as an invisible row. Keep the original so the user still sees
    // something.
    expect(soundDisplayLabel('VG_AMB - ')).toBe('VG_AMB - ');
  });

  it('the prefix table contains every entry requested by the user', () => {
    const expected = [
      'VG_AMB - ',
      'VG_DRUM LOOP - ',
      'VG_BOOM - ',
      'VG_HIT - ',
      'VG_MID PERC - ',
      'VG_ATMOS - ',
      'VG_RISER - ',
      'VG_SIG - ',
      'VG_CYMBAL - ',
      'VG_DOWNER - ',
      'VG_WHOOSH - ',
      'VG_WHOOSH '
    ];
    for (const p of expected) {
      expect(_VISUAL_PREFIXES_FOR_TESTS).toContain(p);
    }
  });
});
