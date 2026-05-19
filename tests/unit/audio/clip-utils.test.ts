import { describe, it, expect } from 'vitest';
import { lastFiredBeatGuard } from '@/lib/audio/clip-utils';

describe('lastFiredBeatGuard', () => {
  it('fires the first time a beat enters the window', () => {
    const r = lastFiredBeatGuard(4, null);
    expect(r.shouldFire).toBe(true);
    expect(r.nextLastFired).toBe(4);
  });

  it('does NOT fire again on the same beat within the window', () => {
    const r = lastFiredBeatGuard(4, 4);
    expect(r.shouldFire).toBe(false);
    expect(r.nextLastFired).toBe(4);
  });

  it('fires on the next beat after leaving the window', () => {
    const r = lastFiredBeatGuard(5, 4);
    expect(r.shouldFire).toBe(true);
    expect(r.nextLastFired).toBe(5);
  });

  it('fires when nearestBeat resets to 0 after rewind/seek', () => {
    const r = lastFiredBeatGuard(0, 4);
    expect(r.shouldFire).toBe(true);
    expect(r.nextLastFired).toBe(0);
  });
});
