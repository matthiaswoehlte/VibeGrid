import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { listPlugins } from '@/lib/renderer/registry';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { makeRenderContext } from './_helpers';
import {
  _overrideCapabilities,
  _resetCapabilities
} from '@/lib/renderer/webgl/capabilities';

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
  'LetterboxSqueeze',
  // Plan 8f.1 — WebGL2 FX.
  'ColorGradeShift',
  // Plan 8f.2 — second WebGL2 FX.
  'RetroVHS',
  // Plan 8f.3 — third WebGL2 FX.
  'EdgeGlow',
  // Plan 8f.4 — fourth WebGL2 FX.
  'ContourGL'
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
  'letterbox-squeeze',
  // Plan 8f.1 — WebGL2 FX.
  'color-grade-shift',
  // Plan 8f.2 — second WebGL2 FX.
  'retro-vhs',
  // Plan 8f.3 — third WebGL2 FX.
  'edge-glow',
  // Plan 8f.4 — fourth WebGL2 FX.
  'contour-gl'
];

describe('FxPlugin contract', () => {
  // Plan 8f.1 — render-without-throw test invokes WebGL FX plugins
  // (ColorGradeShift). The stub OffscreenCanvas above only handles 2D
  // context; the WebGL2 detection path would call gl.getParameter and
  // crash. Pin capabilities to webgl2=false so WebGL FX skip silently.
  beforeAll(() => {
    _overrideCapabilities({
      webgl2: false,
      maxTextureSize: 0,
      highPrecision: false,
      isMobile: false,
      tier: 'low',
      maxParticles: 0,
      maxRaySteps: 0
    });
  });
  afterAll(() => {
    _resetCapabilities();
  });

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

  it('registers exactly 21 plugins (v0.1 + Plan 5.8a + Plan 8e + Plan 8f.1 + Plan 8f.2 + Plan 8f.3 + Plan 8f.4)', () => {
    expect(listPlugins().length).toBe(21);
    expect(
      listPlugins()
        .map((p) => p.id)
        .sort()
    ).toEqual([...ALL_PLUGIN_IDS].sort());
  });
});
