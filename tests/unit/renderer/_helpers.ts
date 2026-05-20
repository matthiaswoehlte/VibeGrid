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
    }))
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
  return {
    ctx: makeMockCtx(),
    width: 800,
    height: 450,
    time: 0,
    beatPhase: 0,
    beatIndex: 0,
    isOnBeat: false,
    trigger: 'beat',
    clipId: 'test-clip',
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
