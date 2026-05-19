import { describe, it, expect } from 'vitest';
import { buildR2Key } from '@/lib/storage/r2-key';

describe('buildR2Key', () => {
  it('produces the v0.1 anonymous/default shape', () => {
    const key = buildR2Key({
      userId: 'anonymous',
      projectId: 'default',
      kind: 'image',
      id: '11111111-2222-3333-4444-555555555555',
      ext: 'png'
    });
    expect(key).toBe('anonymous/default/image/11111111-2222-3333-4444-555555555555.png');
  });

  it('embeds audio kind', () => {
    const key = buildR2Key({
      userId: 'u1',
      projectId: 'p1',
      kind: 'audio',
      id: 'aaaa',
      ext: 'mp3'
    });
    expect(key).toBe('u1/p1/audio/aaaa.mp3');
  });

  it('throws on empty id', () => {
    expect(() =>
      buildR2Key({ userId: 'u', projectId: 'p', kind: 'image', id: '', ext: 'jpg' })
    ).toThrow(/id/);
  });

  it('throws on empty ext', () => {
    expect(() =>
      buildR2Key({ userId: 'u', projectId: 'p', kind: 'image', id: 'x', ext: '' })
    ).toThrow(/ext/);
  });

  it('rejects path-traversal segments', () => {
    expect(() =>
      buildR2Key({ userId: '../etc', projectId: 'p', kind: 'image', id: 'x', ext: 'jpg' })
    ).toThrow(/segment/);
  });
});
