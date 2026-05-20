import { describe, it, expect, vi } from 'vitest';
import { pickCodec } from '@/lib/export/codec';

describe('pickCodec', () => {
  it('picks vp9+opus when supported', () => {
    const supports = vi.fn(() => true);
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.label).toContain('VP9');
  });

  it('falls through to vp8+opus when vp9 is unsupported', () => {
    const supports = vi.fn((t: string) => !t.includes('vp9'));
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp8,opus');
    expect(r.label).toContain('VP8');
  });

  it('falls through to default video/webm when no codec-suffixed type is supported', () => {
    const supports = vi.fn((t: string) => t === 'video/webm');
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm');
  });

  it('returns a non-empty human label for every path', () => {
    expect(pickCodec(() => true).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => !t.includes('vp9')).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => t === 'video/webm').label.length).toBeGreaterThan(0);
  });
});
