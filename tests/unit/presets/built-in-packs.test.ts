import { describe, it, expect } from 'vitest';
import { BUILT_IN_PACKS } from '@/lib/presets/built-in-packs';
import { PLUGIN_KIND_TO_TRACK_KIND } from '@/lib/timeline/plugin-mapping';

describe('built-in preset packs', () => {
  it('contains exactly 7 packs', () => {
    expect(BUILT_IN_PACKS.length).toBe(7);
  });

  it('every fxKind resolves to a valid TrackFxKind via PLUGIN_KIND_TO_TRACK_KIND', () => {
    for (const pack of BUILT_IN_PACKS) {
      for (const entry of pack.fx) {
        const trackKind = PLUGIN_KIND_TO_TRACK_KIND[entry.fxKind];
        expect(trackKind).toBeTruthy();
      }
    }
  });

  it('automation points have beat >= 0 and value in [0, 1]', () => {
    for (const pack of BUILT_IN_PACKS) {
      for (const entry of pack.fx) {
        for (const [paramName, points] of Object.entries(entry.automationCurves)) {
          for (const p of points) {
            expect(p.beat).toBeGreaterThanOrEqual(0);
            expect(p.value).toBeGreaterThanOrEqual(0);
            // Some packs intentionally cap at >1 for "out of range" but
            // VibeGrid renderer clamps; we still want sanity 0–1.
            expect(p.value).toBeLessThanOrEqual(1.0001);
          }
        }
      }
    }
  });

  it('no pack uses bpmReference: 0 (Outro = "any" instead)', () => {
    for (const pack of BUILT_IN_PACKS) {
      expect(pack.bpmReference).not.toBe(0);
    }
    const outro = BUILT_IN_PACKS.find((p) => p.id === 'outro-fade');
    expect(outro?.bpmReference).toBe('any');
  });

  it('every pack has at least one enabled FX', () => {
    for (const pack of BUILT_IN_PACKS) {
      const enabled = pack.fx.filter((f) => f.enabled);
      expect(enabled.length).toBeGreaterThan(0);
    }
  });

  it('pack ids are unique', () => {
    const ids = BUILT_IN_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every pack has a recommendedBars > 0', () => {
    for (const pack of BUILT_IN_PACKS) {
      expect(pack.recommendedBars).toBeGreaterThan(0);
    }
  });
});
