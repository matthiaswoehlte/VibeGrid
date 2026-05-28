import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderContext } from '../renderer/_helpers';

vi.mock('@/lib/renderer/webgl/pipeline', () => ({
  renderGlFx: vi.fn()
}));

import { colorGradeShiftPlugin } from '@/lib/fx/color-grade-shift';
import { renderGlFx } from '@/lib/renderer/webgl/pipeline';

const mockedRenderGlFx = vi.mocked(renderGlFx);

describe('colorGradeShiftPlugin', () => {
  beforeEach(() => {
    mockedRenderGlFx.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips renderGlFx when env < 0.01 (beatPhase past decay)', () => {
    const rc = makeRenderContext({ beatPhase: 0.99 });
    colorGradeShiftPlugin.render(rc, {
      saturation: 2,
      contrast: 1.3,
      brightness: 1.1,
      hueShift: 0,
      decay: 0.25, // env = 1 - 0.99/0.25 = -2.96 → clamped to 0
      beatSync: 1,
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('skips renderGlFx when flowMode=true (no beat-pulse in Flow)', () => {
    const rc = makeRenderContext({ beatPhase: 0, flowMode: true });
    colorGradeShiftPlugin.render(rc, {
      saturation: 2,
      contrast: 1.3,
      brightness: 1.1,
      hueShift: 0,
      decay: 0.25,
      beatSync: 1,
    });
    expect(mockedRenderGlFx).not.toHaveBeenCalled();
  });

  it('calls renderGlFx with all 5 FX uniforms on beat (env > 0.01)', () => {
    const rc = makeRenderContext({ beatPhase: 0 }); // env = 1
    colorGradeShiftPlugin.render(rc, {
      saturation: 2.5,
      contrast: 1.4,
      brightness: 1.2,
      hueShift: 90,
      decay: 0.3,
      beatSync: 1,
    });
    expect(mockedRenderGlFx).toHaveBeenCalledTimes(1);
    const args = mockedRenderGlFx.mock.calls[0][0];
    expect(args.uniformNames).toEqual([
      'u_saturation',
      'u_contrast',
      'u_brightness',
      'u_hue_shift',
      'u_env'
    ]);
    expect(args.uniforms.u_saturation).toBe(2.5);
    expect(args.uniforms.u_contrast).toBe(1.4);
    expect(args.uniforms.u_brightness).toBe(1.2);
    expect(args.uniforms.u_hue_shift).toBe(90);
    expect(args.uniforms.u_env).toBe(1);
  });

  it('preload() sets preloadState=error when OffscreenCanvas returns no webgl2 ctx', async () => {
    // Other tests (plugin-contract.test.ts) install a stub OffscreenCanvas
    // globally. Locally override it so getContext('webgl2') returns null.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedOC = (globalThis as any).OffscreenCanvas;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext(_kind: string): unknown {
        return null;
      }
    };
    try {
      colorGradeShiftPlugin.preloadState = 'loading';
      await colorGradeShiftPlugin.preload(
        {} as ImageBitmap,
        new AbortController().signal
      );
      expect(colorGradeShiftPlugin.preloadState).toBe('error');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).OffscreenCanvas = savedOC;
    }
  });

  it('preload() sets preloadState=ready when webgl2 context is available', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedOC = (globalThis as any).OffscreenCanvas;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext(kind: string): unknown {
        return kind === 'webgl2' ? ({} as WebGL2RenderingContext) : null;
      }
    };
    try {
      colorGradeShiftPlugin.preloadState = 'loading';
      await colorGradeShiftPlugin.preload(
        {} as ImageBitmap,
        new AbortController().signal
      );
      expect(colorGradeShiftPlugin.preloadState).toBe('ready');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).OffscreenCanvas = savedOC;
    }
  });

  it('default params match the schema defaults', () => {
    const defaults = colorGradeShiftPlugin.getDefaultParams();
    expect(defaults).toEqual({
      saturation: 2.0,
      contrast: 1.3,
      brightness: 1.1,
      hueShift: 0,
      decay: 0.25,
      beatSync: 1,
    });
  });
});
