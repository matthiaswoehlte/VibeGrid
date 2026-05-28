import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockGL, type MockGL } from '../../setup/webgl-mock';

describe('uploadTextureSource', () => {
  let gl: MockGL;
  beforeEach(() => {
    gl = createMockGL();
  });
  afterEach(() => {
    // Mock GL is per-test; nothing global.
  });

  it('uploads an ImageBitmap-shaped source (back-compat)', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const bm = { width: 100, height: 50 } as unknown as ImageBitmap;
    uploadTextureSource(gl, bm, bm.width, bm.height);
    const calls = gl.__calls.map((c) => c.method);
    expect(calls).toContain('texImage2D');
    expect(calls).toContain('texSubImage2D');
  });

  it('uploads a Canvas-shaped source (HTMLCanvasElement / OffscreenCanvas)', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement;
    uploadTextureSource(gl, canvas, canvas.width, canvas.height);
    const calls = gl.__calls.map((c) => c.method);
    expect(calls).toContain('texSubImage2D');
  });

  it('reuses texture when dimensions match across calls', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const bm = { width: 100, height: 50 } as unknown as ImageBitmap;
    uploadTextureSource(gl, bm, bm.width, bm.height);
    uploadTextureSource(gl, bm, bm.width, bm.height);
    const allocs = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    // 1 alloc at first call, 0 at second (dimensions unchanged).
    expect(allocs).toBe(1);
  });

  it('reallocates texture when dimensions change', async () => {
    const { uploadTextureSource } = await import('@/lib/renderer/webgl/texture');
    const a = { width: 100, height: 50 } as unknown as ImageBitmap;
    const b = { width: 200, height: 100 } as unknown as ImageBitmap;
    uploadTextureSource(gl, a, a.width, a.height);
    uploadTextureSource(gl, b, b.width, b.height);
    const allocs = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    expect(allocs).toBe(2);
  });
});
