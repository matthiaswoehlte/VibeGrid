import { describe, it, expect } from 'vitest';
import { makeFilename } from '@/lib/export/filename';

describe('makeFilename', () => {
  it('formats vibegrid_export_<timestamp>.webm', () => {
    const f = makeFilename(new Date('2026-05-20T14:30:00Z'));
    expect(f).toBe('vibegrid_export_2026-05-20T14-30-00.webm');
  });

  it('replaces colons and dots in the ISO with dashes', () => {
    const f = makeFilename(new Date('2026-05-20T14:30:45.123Z'));
    expect(f.endsWith('.webm')).toBe(true);
    // The .webm extension is the only dot left.
    const beforeExt = f.slice(0, -'.webm'.length);
    expect(beforeExt).not.toContain(':');
    expect(beforeExt).not.toContain('.');
  });

  it('never contains "undefined" (regression guard for AC-13)', () => {
    expect(makeFilename(new Date())).not.toContain('undefined');
  });

  it("respects the extension argument — 'mp4' produces a .mp4 filename", () => {
    const f = makeFilename(new Date('2026-05-20T14:30:00Z'), 'mp4');
    expect(f).toBe('vibegrid_export_2026-05-20T14-30-00.mp4');
  });
});
