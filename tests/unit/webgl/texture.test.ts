import { describe, it, expect, beforeEach } from 'vitest';
import { uploadImageBitmap } from '@/lib/renderer/webgl/texture';
import { createMockGL, type MockGL } from '../../setup/webgl-mock';

function makeBitmap(w: number, h: number): ImageBitmap {
  return { width: w, height: h, close: () => {} } as unknown as ImageBitmap;
}

describe('uploadImageBitmap', () => {
  let gl: MockGL;
  beforeEach(() => {
    gl = createMockGL();
  });

  it('first upload allocates via texImage2D + binds + sets parameters', () => {
    uploadImageBitmap(gl, makeBitmap(800, 450));
    const methods = gl.__calls.map((c) => c.method);
    expect(methods).toContain('createTexture');
    expect(methods).toContain('texImage2D');
    expect(methods).toContain('texParameteri');
    expect(methods).toContain('texSubImage2D');
  });

  it('second upload at same size reuses texture — no second texImage2D alloc', () => {
    uploadImageBitmap(gl, makeBitmap(800, 450));
    const firstAllocs = gl.__calls.filter(
      (c) => c.method === 'texImage2D'
    ).length;
    uploadImageBitmap(gl, makeBitmap(800, 450));
    const secondAllocs = gl.__calls.filter(
      (c) => c.method === 'texImage2D'
    ).length;
    expect(secondAllocs).toBe(firstAllocs); // no new alloc, only texSubImage2D
  });

  it('resize triggers a re-allocation via texImage2D', () => {
    uploadImageBitmap(gl, makeBitmap(800, 450));
    const before = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    uploadImageBitmap(gl, makeBitmap(1920, 1080));
    const after = gl.__calls.filter((c) => c.method === 'texImage2D').length;
    expect(after).toBe(before + 1);
  });

  it('pins UNPACK_FLIP_Y_WEBGL to false (quad provides the y-flip)', () => {
    uploadImageBitmap(gl, makeBitmap(100, 100));
    const flipCall = gl.__calls.find((c) => c.method === 'pixelStorei');
    expect(flipCall).toBeDefined();
    expect(flipCall?.args[1]).toBe(false);
  });
});
