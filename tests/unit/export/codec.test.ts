import { describe, it, expect, vi } from 'vitest';
import { pickCodec } from '@/lib/export/codec';

describe('pickCodec', () => {
  it('picks MP4 (h264+aac) when supported (preferred over WebM)', () => {
    const supports = vi.fn(() => true);
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/mp4;codecs=h264,aac');
    expect(r.ext).toBe('mp4');
    expect(r.label).toContain('MP4');
  });

  it('falls through to WebM vp9+opus when MP4 is unsupported', () => {
    const supports = vi.fn((t: string) => !t.includes('mp4'));
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.ext).toBe('webm');
    expect(r.label).toContain('VP9');
  });

  it('falls through to vp8+opus when MP4 and vp9 are unsupported', () => {
    const supports = vi.fn((t: string) => !t.includes('mp4') && !t.includes('vp9'));
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm;codecs=vp8,opus');
    expect(r.ext).toBe('webm');
    expect(r.label).toContain('VP8');
  });

  it('falls through to default video/webm when no codec-suffixed type is supported', () => {
    const supports = vi.fn((t: string) => t === 'video/webm');
    const r = pickCodec(supports);
    expect(r.mimeType).toBe('video/webm');
    expect(r.ext).toBe('webm');
  });

  it('returns a non-empty human label for every path', () => {
    expect(pickCodec(() => true).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => !t.includes('mp4')).label.length).toBeGreaterThan(0);
    expect(pickCodec((t) => t === 'video/webm').label.length).toBeGreaterThan(0);
  });
});
