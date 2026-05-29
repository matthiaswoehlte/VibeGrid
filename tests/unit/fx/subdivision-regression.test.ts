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
 * Helper — Canvas2D-plugin envelope-shape regression (Plan 9c.1 semantic).
 *
 * Both render calls use beatPhase=0.3 (past the first sub=4× boundary at
 * 0.25). With decay=0.1:
 *  - sub='1×': subdividedBeatPhase = 0.3 → env = 1 - 0.3/0.1 = -2 → 0 → SKIP
 *  - sub='4×': subdividedBeatPhase = 0.3 % 0.25 = 0.05 → env = 0.5 → DRAW
 *
 * Asserted: atOne=0 (no draw) vs atFour>0 (draw). Demonstrates that
 * sub=4× produces ADDITIONAL pulses past the first beat-boundary that
 * sub=1× has already missed.
 */

function renderTwice<T>(
  plugin: { render(rc: ReturnType<typeof makeRenderContext>, p: T): void },
  params: T,
  drawProbe: (rc: ReturnType<typeof makeRenderContext>) => number
): { atOne: number; atFour: number } {
  const rcOne = makeRenderContext({
    beatPhase: 0.3,
    subdividedBeatPhase: 0.3,
    subdivision: '1×',
    isOnBeat: true
  });
  plugin.render(rcOne, params);
  const atOne = drawProbe(rcOne);

  const rcFour = makeRenderContext({
    beatPhase: 0.3,
    subdividedBeatPhase: 0.05,
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

describe('Plan 9c.1 — Canvas2D subdivision envelope shape regression', () => {
  // At beatPhase=0.3 the 1× envelope has long decayed (decay=0.1, env<0).
  // Under the new beats-since-boundary semantic, sub=4× wraps at 0.25 so
  // subdividedBeatPhase = 0.05 — env is back at 0.5 and the FX fires. This
  // is exactly the "extra pulse" behaviour the user expected to see.

  it('BeatFlash: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
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
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('ScreenShake: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
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
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('ZoomPunch: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
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
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('LensFlareBurst: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = renderTwice(
      lensFlareBurstPlugin,
      {
        ...lensFlareBurstPlugin.getDefaultParams(),
        decay: 0.1,
        beatSync: true
      },
      countOf('stroke')
    );
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('Pulse: hardcoded *4 envelope renders identical shape per subdivision', () => {
    // Pulse: `decay = max(0, 1 - subdividedBeatPhase * 4)`. Under the
    // new semantic this stays beat-relative: at beatPhase=0.05,
    // subdividedBeatPhase=0.05 for both sub=1× and sub=4× (no wrap
    // yet). decay=0.8 in both cases. fillRect fires in both cases.
    // The visible difference only emerges past the first sub-boundary.
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
      subdividedBeatPhase: 0.05,
      subdivision: '4×',
      isOnBeat: true
    });
    pulsePlugin.render(rcFour, { color: '#ffffff', intensity: 0.6 });
    expect(countOf('fillRect')(rcFour)).toBeGreaterThan(0);
  });

  it('FilmGrainBurst: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    // FilmGrain has env-skip threshold 0.02 and decay=0.1 here.
    // At beatPhase=0.3, sub=1× has env=0 (decayed); sub=4× wraps to
    // subdividedBeatPhase=0.05, env=0.5 → fires.
    const { atOne, atFour } = renderTwice(
      filmGrainBurstPlugin,
      {
        ...filmGrainBurstPlugin.getDefaultParams(),
        decay: 0.1,
        beatSync: true
      },
      countOf('drawImage')
    );
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  // GlitchSlice moved to the WebGL group below (Plan 11b).
});

describe('Plan 9c.1 — WebGL subdivision envelope shape regression', () => {
  // Same logic as the Canvas2D group: at beatPhase=0.3 with decay=0.1,
  // sub=1× has fully decayed → skip; sub=4× wraps to subdividedBeatPhase
  // 0.05 → env=0.5 → renderGlFx fires. The fix gives "more pulses" instead
  // of "shorter pulses".
  function callRenderGlFxTwice<T>(
    plugin: { render(rc: ReturnType<typeof makeRenderContext>, p: T): void },
    params: T
  ): { atOne: number; atFour: number } {
    mockedRenderGlFx.mockReset();
    plugin.render(
      makeRenderContext({
        beatPhase: 0.3,
        subdividedBeatPhase: 0.3,
        subdivision: '1×',
        isOnBeat: true
      }),
      params
    );
    const atOne = mockedRenderGlFx.mock.calls.length;
    mockedRenderGlFx.mockReset();
    plugin.render(
      makeRenderContext({
        beatPhase: 0.3,
        subdividedBeatPhase: 0.05,
        subdivision: '4×',
        isOnBeat: true
      }),
      params
    );
    const atFour = mockedRenderGlFx.mock.calls.length;
    return { atOne, atFour };
  }

  it('RGBSplit: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(rgbSplitPlugin, {
      ...rgbSplitPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('GlitchSlice: 4× wraps past 0.25 → extra pulse (Plan 11b WebGL)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(glitchSlicePlugin, {
      ...glitchSlicePlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('ColorGradeShift: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(colorGradeShiftPlugin, {
      ...colorGradeShiftPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('RetroVHS: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(retroVhsPlugin, {
      ...retroVhsPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('EdgeGlow: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(edgeGlowPlugin, {
      ...edgeGlowPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });

  it('ContourGL: 4× wraps past 0.25 → extra pulse vs 1× (which is decayed)', () => {
    const { atOne, atFour } = callRenderGlFxTwice(contourGlPlugin, {
      ...contourGlPlugin.getDefaultParams(),
      decay: 0.1,
      beatSync: true
    });
    expect(atOne).toBe(0);
    expect(atFour).toBeGreaterThan(0);
  });
});
