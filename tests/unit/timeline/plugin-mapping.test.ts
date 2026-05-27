import { describe, it, expect } from 'vitest';
import {
  TRACK_FX_KINDS,
  RENDER_ORDER_TRACK_KIND,
  fxSortIndex,
  PLUGIN_KIND_TO_TRACK_KIND,
  TRACK_KIND_TO_PLUGIN_KIND,
  FX_DISPLAY_NAME
} from '@/lib/timeline/plugin-mapping';

describe('plugin-mapping — FX kind constants & helpers', () => {
  it('TRACK_FX_KINDS contains every lowercase FX kind (Plan 8f.2: 19 kinds)', () => {
    expect([...TRACK_FX_KINDS].sort()).toEqual([
      'beat-flash',
      'color-grade-shift',
      'contour',
      'dissolve',
      'film-grain-burst',
      'glitch-slice',
      'lens-flare-burst',
      'letterbox-squeeze',
      'particles',
      'pulse',
      'retro-vhs',
      'rgb-split',
      'screen-shake',
      'sunray',
      'sweep',
      'text',
      'vignette-breathe',
      'zoom-pulse',
      'zoom-punch'
    ].sort());
  });

  it('Plan 8e — all 9 new FX kinds are present', () => {
    const plan8e = [
      'beat-flash',
      'rgb-split',
      'zoom-punch',
      'screen-shake',
      'vignette-breathe',
      'lens-flare-burst',
      'film-grain-burst',
      'glitch-slice',
      'letterbox-squeeze'
    ] as const;
    for (const k of plan8e) {
      expect((TRACK_FX_KINDS as readonly string[]).includes(k)).toBe(true);
      expect(RENDER_ORDER_TRACK_KIND.indexOf(k as never)).toBeGreaterThanOrEqual(0);
      expect(FX_DISPLAY_NAME[k as never]).toBeTruthy();
      expect(TRACK_KIND_TO_PLUGIN_KIND[k as never]).toBeTruthy();
    }
  });

  it('Plan 8e — letterbox-squeeze is the LAST entry in RENDER_ORDER (paints over all)', () => {
    expect(RENDER_ORDER_TRACK_KIND[RENDER_ORDER_TRACK_KIND.length - 1]).toBe('letterbox-squeeze');
  });

  it('Plan 8f.1 — color-grade-shift is in RENDER_ORDER + maps roundtrip', () => {
    expect((TRACK_FX_KINDS as readonly string[]).includes('color-grade-shift')).toBe(true);
    expect(RENDER_ORDER_TRACK_KIND.indexOf('color-grade-shift' as never)).toBeGreaterThanOrEqual(0);
    expect(FX_DISPLAY_NAME['color-grade-shift']).toBe('Color Grade');
    expect(TRACK_KIND_TO_PLUGIN_KIND['color-grade-shift']).toBe('ColorGradeShift');
    expect(PLUGIN_KIND_TO_TRACK_KIND.ColorGradeShift).toBe('color-grade-shift');
  });

  it('Plan 8f.2 — retro-vhs is in RENDER_ORDER + maps roundtrip', () => {
    expect((TRACK_FX_KINDS as readonly string[]).includes('retro-vhs')).toBe(true);
    expect(RENDER_ORDER_TRACK_KIND.indexOf('retro-vhs' as never)).toBeGreaterThanOrEqual(0);
    expect(FX_DISPLAY_NAME['retro-vhs']).toBe('Retro VHS');
    expect(TRACK_KIND_TO_PLUGIN_KIND['retro-vhs']).toBe('RetroVHS');
    expect(PLUGIN_KIND_TO_TRACK_KIND.RetroVHS).toBe('retro-vhs');
  });

  it('RENDER_ORDER_TRACK_KIND covers every FX kind exactly once', () => {
    const set = new Set(RENDER_ORDER_TRACK_KIND);
    expect(set.size).toBe(RENDER_ORDER_TRACK_KIND.length);
    for (const k of TRACK_FX_KINDS) expect(set.has(k)).toBe(true);
  });

  it('fxSortIndex returns the array position for known kinds', () => {
    expect(fxSortIndex('dissolve')).toBe(RENDER_ORDER_TRACK_KIND.indexOf('dissolve'));
    expect(fxSortIndex('text')).toBe(RENDER_ORDER_TRACK_KIND.indexOf('text'));
  });

  it('fxSortIndex returns length for unknown kinds (sorts last)', () => {
    expect(fxSortIndex('unknown-fx')).toBe(RENDER_ORDER_TRACK_KIND.length);
  });

  it('PLUGIN_KIND_TO_TRACK_KIND and TRACK_KIND_TO_PLUGIN_KIND are mutual inverses', () => {
    for (const plugin of Object.keys(PLUGIN_KIND_TO_TRACK_KIND)) {
      const track = PLUGIN_KIND_TO_TRACK_KIND[plugin as keyof typeof PLUGIN_KIND_TO_TRACK_KIND];
      expect(TRACK_KIND_TO_PLUGIN_KIND[track]).toBe(plugin);
    }
  });

  it('FX_DISPLAY_NAME has a non-empty label for every FX kind', () => {
    for (const k of TRACK_FX_KINDS) {
      expect(typeof FX_DISPLAY_NAME[k]).toBe('string');
      expect(FX_DISPLAY_NAME[k].length).toBeGreaterThan(0);
    }
  });
});
