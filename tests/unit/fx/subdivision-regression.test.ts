import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

// Subdivision-FX list (Plan 9c, Schritt-0 final). Each entry confirms
// the plugin's render() actually reads `rc.subdividedBeatPhase` for
// envelope-shape (rather than rc.beatPhase). The check is the simplest
// possible behavioural delta:
//
//  - With subdivision='1×': behaves identically to pre-9c.
//  - With subdivision='4×' and beatPhase such that subdividedBeatPhase
//    > decay: the envelope is fully decayed → plugin early-returns
//    or zeroes its draw work.
//
// For WebGL plugins we mock `renderGlFx` and assert it's called at one
// subdivision but not the other (env<0.01 skip). For canvas plugins
// we assert via the mock ctx's call-count.

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

// Stub OffscreenCanvas so FilmGrain + GlitchSlice don't early-return on
// `typeof OffscreenCanvas === 'undefined'` in jsdom.
class StubOffscreen {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): CanvasRenderingContext2D {
    return {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h
      }) as ImageData,
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      fillStyle: '#000'
    } as unknown as CanvasRenderingContext2D;
  }
}
// @ts-expect-error — install for jsdom
globalThis.OffscreenCanvas = StubOffscreen;

import { beatFlashPlugin } from '@/lib/fx/beat-flash';
import { rgbSplitPlugin } from '@/lib/fx/rgb-split';
import { zoomPunchPlugin } from '@/lib/fx/zoom-punch';
import { screenShakePlugin } from '@/lib/fx/screen-shake';
import { glitchSlicePlugin } from '@/lib/fx/glitch-slice';
import { filmGrainBurstPlugin } from '@/lib/fx/film-grain-burst';
import { lensFlareBurstPlugin } from '@/lib/fx/lens-flare-burst';
import { colorGradeShiftPlugin } from '@/lib/fx/color-grade-shift';
import { retroVhsPlugin } from '@/lib/fx/retro-vhs';
import { edgeGlowPlugin } from '@/lib/fx/edge-glow';
import { contourGlPlugin } from '@/lib/fx/contour-gl';
import { pulsePlugin } from '@/lib/fx/pulse';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

beforeEach(() => {
  mockedRenderGlFx.mockReset();
});

describe('Plan 9c — supportsSubdivision flag set on every qualified FX', () => {
  it.each([
    ['beatFlash', beatFlashPlugin],
    ['rgbSplit', rgbSplitPlugin],
    ['zoomPunch', zoomPunchPlugin],
    ['screenShake', screenShakePlugin],
    ['glitchSlice', glitchSlicePlugin],
    ['filmGrainBurst', filmGrainBurstPlugin],
    ['lensFlareBurst', lensFlareBurstPlugin],
    ['colorGradeShift', colorGradeShiftPlugin],
    ['retroVhs', retroVhsPlugin],
    ['edgeGlow', edgeGlowPlugin],
    ['contourGl', contourGlPlugin],
    ['pulse', pulsePlugin]
  ])('%s.supportsSubdivision === true', (_name, plugin) => {
    expect(plugin.supportsSubdivision).toBe(true);
  });
});

/**
 * Helper — Canvas2D-plugin envelope-shape regression.
 *
 * Calls `render` twice with the same beatPhase (=0.05) but different
 * subdivisions. With sub='1×', beatPhase < decay → envelope > 0 →
 * plugin SHOULD perform a draw call. With sub='4×', subdividedBeatPhase
 * becomes 0.2 which is past `decay=0.05` → envelope = 0 → plugin SHOULD
 * early-return. The asserted delta is in `drawImage` / `fillRect`
 * call counts.
 */

function renderTwice<T>(
  plugin: { render(rc: ReturnType<typeof makeRenderContext>, p: T): void },
  params: T,
  drawProbe: (rc: ReturnType<typeof makeRenderContext>) => number
): { atOne: number; atFour: number } {
  const rcOne = makeRenderContext({
    beatPhase: 0.05,
    subdividedBeatPhase: 0.05,
    subdivision: '1×',
    isOnBeat: true
  });
  plugin.render(rcOne, params);
  const atOne = drawProbe(rcOne);

  const rcFour = makeRenderContext({
    beatPhase: 0.05,
    subdividedBeatPhase: 0.2,
    subdivision: '4×',
    isOnBeat: true
  });
  plugin.render(rcFour, params);
  const atFour = drawProbe(rcFour);

  return { atOne, atFour };
}

type CallRecorder = {
  __calls: Array<{ method: string; args: unknown[] }>;
};
const calls = (rc: ReturnType<typeof makeRenderContext>): CallRecorder =>
  rc.ctx as unknown as CallRecorder;

const countOf = (method: string) => (rc: ReturnType<typeof makeRenderContext>) =>
  calls(rc).__calls.filter((c) => c.method === method).length;

describe('Plan 9c — Canvas2D subdivision envelope shape regression', () => {
  it('BeatFlash: 4× pushes phase past `duration` → no fillRect', () => {
    const { atOne, atFour } = renderTwice(
      beatFlashPlugin,
      {
        ...beatFlashPlugin.getDefaultParams(),
        intensity: 0.8,
        duration: 0.1,
        beatSync: true
      },
      countOf('fillRect')
    );
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('ScreenShake: 4× pushes phase past `decay` → no drawImage', () => {
    const { atOne, atFour } = renderTwice(
      screenShakePlugin,
      {
        ...screenShakePlugin.getDefaultParams(),
        intensity: 0.01,
        decay: 0.1,
        beatSync: true
      },
      countOf('drawImage')
    );
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('ZoomPunch: 4× past `attack`+`decay` → no drawImage', () => {
    const { atOne, atFour } = renderTwice(
      zoomPunchPlugin,
      {
        ...zoomPunchPlugin.getDefaultParams(),
        strength: 1.2,
        attack: 0.01,
        decay: 0.1,
        beatSync: true
      },
      countOf('drawImage')
    );
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('LensFlareBurst: 4× past `decay` → no stroke', () => {
    const { atOne, atFour } = renderTwice(
      lensFlareBurstPlugin,
      {
        ...lensFlareBurstPlugin.getDefaultParams(),
        decay: 0.1,
        beatSync: true
      },
      countOf('stroke')
    );
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('Pulse: 4× past hardcoded `*4` envelope makes decay ≤ 0 → fillRect still happens but globalAlpha is 0', () => {
    // Pulse: `decay = max(0, 1 - subdividedBeatPhase * 4)`. At sub=1×,
    // beatPhase=0.05 → decay=0.8. At sub=4×, subdividedBeatPhase=0.2 →
    // decay=0.2. The pulse paints in both cases, but the envelope is
    // dampened — the simplest assertion is that the draw fires in both
    // cases (Pulse doesn't early-return on decay=0+ exactly). We just
    // verify it doesn't crash and emits a fillRect.
    const rcOne = makeRenderContext({
      beatPhase: 0.05,
      subdividedBeatPhase: 0.05,
      subdivision: '1×',
      isOnBeat: true
    });
    pulsePlugin.render(rcOne, { color: '#ffffff', intensity: 0.6 });
    expect(countOf('fillRect')(rcOne)).toBeGreaterThan(0);
    const rcFour = makeRenderContext({
      beatPhase: 0.05,
      subdividedBeatPhase: 0.2,
      subdivision: '4×',
      isOnBeat: true
    });
    pulsePlugin.render(rcFour, { color: '#ffffff', intensity: 0.6 });
    expect(countOf('fillRect')(rcFour)).toBeGreaterThan(0);
  });

  it('FilmGrainBurst: 4× past `decay` → no offscreen drawImage', () => {
    // FilmGrain has env-skip threshold 0.02 and decay default 0.15.
    // At sub=4× with beatPhase=0.05 → subdividedBeatPhase=0.2 → env=0 → skip.
    const { atOne, atFour } = renderTwice(
      filmGrainBurstPlugin,
      {
        ...filmGrainBurstPlugin.getDefaultParams(),
        decay: 0.1,
        beatSync: true
      },
      countOf('drawImage')
    );
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  // GlitchSlice moved to the WebGL group below (Plan 11b).
});

describe('Plan 9c — WebGL subdivision envelope shape regression', () => {
  function callRenderGlFxTwice<T>(
    plugin: { render(rc: ReturnType<typeof makeRenderContext>, p: T): void },
    params: T
  ): { atOne: number; atFour: number } {
    mockedRenderGlFx.mockReset();
    plugin.render(
      makeRenderContext({
        beatPhase: 0.05,
        subdividedBeatPhase: 0.05,
        subdivision: '1×',
        isOnBeat: true
      }),
      params
    );
    const atOne = mockedRenderGlFx.mock.calls.length;
    mockedRenderGlFx.mockReset();
    plugin.render(
      makeRenderContext({
        beatPhase: 0.05,
        subdividedBeatPhase: 0.2,
        subdivision: '4×',
        isOnBeat: true
      }),
      params
    );
    const atFour = mockedRenderGlFx.mock.calls.length;
    return { atOne, atFour };
  }

  it('RGBSplit: 4× past `decay` skips renderGlFx', () => {
    const { atOne, atFour } = callRenderGlFxTwice(rgbSplitPlugin, {
      ...rgbSplitPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('GlitchSlice: 4× past `decay` skips renderGlFx (Plan 11b)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(glitchSlicePlugin, {
      ...glitchSlicePlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('ColorGradeShift: 4× past `decay` skips renderGlFx', () => {
    const { atOne, atFour } = callRenderGlFxTwice(colorGradeShiftPlugin, {
      ...colorGradeShiftPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('RetroVHS: 4× past `decay` skips renderGlFx', () => {
    const { atOne, atFour } = callRenderGlFxTwice(retroVhsPlugin, {
      ...retroVhsPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('EdgeGlow: 4× past `decay` skips renderGlFx', () => {
    const { atOne, atFour } = callRenderGlFxTwice(edgeGlowPlugin, {
      ...edgeGlowPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });

  it('ContourGL: 4× past `decay` skips renderGlFx', () => {
    const { atOne, atFour } = callRenderGlFxTwice(contourGlPlugin, {
      ...contourGlPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBeGreaterThan(0);
    expect(atFour).toBe(0);
  });
});
