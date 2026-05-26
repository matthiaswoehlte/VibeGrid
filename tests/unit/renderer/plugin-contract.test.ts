import { describe, it, expect, vi } from 'vitest';
import { listPlugins } from '@/lib/renderer/registry';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { makeRenderContext } from './_helpers';

// Plan 8e — install a complete OffscreenCanvas stub for jsdom BEFORE
// registering plugins. FilmGrainBurst calls createImageData/putImageData
// on the offscreen context; GlitchSlice + RGBSplit need drawImage +
// clearRect. Other test files may install their own thinner stubs in
// arbitrary order — we forcefully replace with a comprehensive one here.
class CompleteStubOffscreen {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): CanvasRenderingContext2D {
    const self = this;
    return {
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '#000',
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      createImageData: (w: number, h: number) =>
        ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h
        }) as ImageData,
      putImageData: vi.fn(),
      getImageData: () =>
        ({
          data: new Uint8ClampedArray(self.width * self.height * 4),
          width: self.width,
          height: self.height
        }) as ImageData
    } as unknown as CanvasRenderingContext2D;
  }
}
// @ts-expect-error — install for jsdom
globalThis.OffscreenCanvas = CompleteStubOffscreen;

// Register at module load — it.each() below evaluates before beforeAll() would run.
_resetBuiltInPluginsForTests();
registerBuiltInPlugins();

const ALL_PLUGIN_KINDS = [
  // v0.1.
  'Contour',
  'Pulse',
  'Sweep',
  'Particle',
  'ZoomPulse',
  // Plan 5.8a.
  'Text',
  'Dissolve',
  'Sunray',
  // Plan 8e — 9 new beat-sync FX.
  'BeatFlash',
  'RGBSplit',
  'ZoomPunch',
  'ScreenShake',
  'VignetteBreathe',
  'LensFlareBurst',
  'FilmGrainBurst',
  'GlitchSlice',
  'LetterboxSqueeze'
] as const;

const ALL_PLUGIN_IDS = [
  'contour',
  'dissolve',
  'particles',
  'pulse',
  'sunray',
  'sweep',
  'text',
  'zoom-pulse',
  // Plan 8e — 9 new beat-sync FX (kebab-case IDs).
  'beat-flash',
  'rgb-split',
  'zoom-punch',
  'screen-shake',
  'vignette-breathe',
  'lens-flare-burst',
  'film-grain-burst',
  'glitch-slice',
  'letterbox-squeeze'
];

describe('FxPlugin contract', () => {
  it.each(listPlugins().map((p) => [p.id, p] as const))(
    'plugin %s conforms to the FxPlugin contract',
    (_id, plugin) => {
      expect(typeof plugin.id).toBe('string');
      expect(plugin.id.length).toBeGreaterThan(0);
      expect(typeof plugin.name).toBe('string');
      expect(ALL_PLUGIN_KINDS as readonly string[]).toContain(plugin.kind);
      expect(['half-bar', 'beat', 'bar', 'two-bar']).toContain(plugin.defaultTrigger);
      expect(typeof plugin.paramSchema).toBe('object');
      expect(typeof plugin.getDefaultParams).toBe('function');
      expect(typeof plugin.preload).toBe('function');
      expect(typeof plugin.render).toBe('function');
      const defaults = plugin.getDefaultParams() as Record<string, unknown>;
      const schemaKeys = Object.keys(plugin.paramSchema).sort();
      const defaultKeys = Object.keys(defaults).sort();
      expect(defaultKeys).toEqual(schemaKeys);
    }
  );

  it('all plugins can be rendered without throwing on a fresh context', () => {
    for (const plugin of listPlugins()) {
      const rc = makeRenderContext({
        isOnBeat: true,
        beatIndex: 1,
        beatPhase: 0
      });
      expect(() => plugin.render(rc, plugin.getDefaultParams())).not.toThrow();
    }
  });

  it('registers exactly 17 plugins (v0.1 + Plan 5.8a + Plan 8e)', () => {
    expect(listPlugins().length).toBe(17);
    expect(
      listPlugins()
        .map((p) => p.id)
        .sort()
    ).toEqual([...ALL_PLUGIN_IDS].sort());
  });
});
