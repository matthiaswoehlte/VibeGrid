import { vi } from 'vitest';
import type { RenderContext } from '@/lib/renderer/types';
import type { BeatGrid } from '@/lib/audio/types';

/** Build a mock CanvasRenderingContext2D that records every call. */
export function makeMockCtx(): CanvasRenderingContext2D & {
  __calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method: name, args });
    });
  const ctx = {
    __calls: calls,
    canvas: { width: 800, height: 450 } as HTMLCanvasElement,
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    lineWidth: 1,
    lineDashOffset: 0,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    measureText: vi.fn((s: string) => ({ width: s.length * 6 } as TextMetrics)),
    fillText: stub('fillText'),
    strokeText: stub('strokeText'),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn()
    })),
    clearRect: stub('clearRect'),
    fillRect: stub('fillRect'),
    beginPath: stub('beginPath'),
    closePath: stub('closePath'),
    moveTo: stub('moveTo'),
    lineTo: stub('lineTo'),
    arc: stub('arc'),
    stroke: stub('stroke'),
    fill: stub('fill'),
    drawImage: stub('drawImage'),
    save: stub('save'),
    restore: stub('restore'),
    scale: stub('scale'),
    translate: stub('translate'),
    rotate: stub('rotate'),
    setLineDash: stub('setLineDash'),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn()
    })),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4 * 100 * 100),
      width: 100,
      height: 100
    })),
    // Identity DOMMatrix — `lib/renderer/loop.ts` calls `getTransform().a`
    // to detect whether DPR setTransform is applied. jsdom canvas has
    // no native context; production code reads the X-scale factor and
    // expects 1 for identity (= no DPR), >1 for live-canvas DPR-scaled.
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix)
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

export function makeMockImageBitmap(width = 100, height = 100): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn()
  } as unknown as ImageBitmap;
}

export function makeRenderContext(overrides: Partial<RenderContext> = {}): RenderContext {
  const beatPhase = overrides.beatPhase ?? 0;
  return {
    ctx: makeMockCtx(),
    width: 800,
    height: 450,
    time: 0,
    beatPhase,
    beatIndex: 0,
    isOnBeat: false,
    trigger: 'beat',
    // Default subdivision='1×' → subdividedBeatPhase mirrors beatPhase.
    // Tests that exercise subdivision behavior override both.
    subdividedBeatPhase: beatPhase,
    subdivision: '1×',
    clipId: 'test-clip',
    clipStartSec: 0,
    clipDurationSec: 4,
    flowMode: false,
    imageBitmap: makeMockImageBitmap(),
    ...overrides
  };
}

export const grid120: BeatGrid = {
  bpm: 120,
  source: 'manual',
  beatsPerBar: 4,
  offsetMs: 0
};
