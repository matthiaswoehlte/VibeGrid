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
  it('TRACK_FX_KINDS contains exactly the 8 lowercase FX kinds', () => {
    expect([...TRACK_FX_KINDS].sort()).toEqual([
      'contour',
      'dissolve',
      'particles',
      'pulse',
      'sunray',
      'sweep',
      'text',
      'zoom-pulse'
    ]);
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
