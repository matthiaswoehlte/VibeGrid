import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRenderer } from '@/lib/renderer/loop';
import { _resetBuiltInPluginsForTests, registerBuiltInPlugins } from '@/lib/fx';
import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import type { TimelineState } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import { makeMockCtx } from './_helpers';

/**
 * Plan-5.8a Task 0 — verify that the RC handed to plugins contains
 * clipStartSec + clipDurationSec computed from clip.startBeat/lengthBeats
 * and the active beat grid (offsetMs only affects start, not duration).
 */
describe('RenderContext — clipStartSec + clipDurationSec (Plan 5.8a)', () => {
  beforeEach(() => {
    _resetBuiltInPluginsForTests();
    _resetRegistryForTests();
    registerBuiltInPlugins();
  });

  function captureRC({
    bpm,
    offsetMs,
    startBeat,
    lengthBeats
  }: {
    bpm: number;
    offsetMs: number;
    startBeat: number;
    lengthBeats: number;
  }): RenderContext | null {
    let captured: RenderContext | null = null;

    // Replace the Pulse plugin's render with a capture stub. We re-register
    // to avoid touching the global registry permanently.
    const capturePlugin: FxPlugin<Record<string, unknown>> = {
      id: 'capture',
      name: 'Capture',
      kind: 'Pulse',
      defaultTrigger: 'beat',
      preloadState: 'ready',
      paramSchema: {},
      getDefaultParams: () => ({}),
      async preload() {},
      render(rc) {
        captured = rc;
      }
    };

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const ctx = makeMockCtx();
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);

    const grid: BeatGrid = { bpm, source: 'manual', beatsPerBar: 4, offsetMs };
    const timeline: TimelineState = {
      tracks: [{ id: 'tp', kind: 'pulse', name: 'p', muted: false, order: 0 }],
      clips: [
        {
          id: 'p1',
          trackId: 'tp',
          kind: 'pulse',
          fxId: 'capture',
          startBeat,
          lengthBeats,
          label: 'p1'
        }
      ],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    };

    // Inject our capture plugin into the registry under id 'capture'.
    // The renderer's plugin lookup uses fxId first (clip.fxId = 'capture').
    register(capturePlugin);

    // Render at a time that's guaranteed to be inside the clip — otherwise
    // the clip is inactive and the capture plugin never fires.
    const expectedStartSec = (startBeat * 60) / bpm + offsetMs / 1000;
    const renderer = createRenderer({
      canvas,
      getCurrentTime: () => expectedStartSec + 0.01,
      getBeatGrid: () => grid,
      getTimelineState: () => timeline,
      getImageBitmap: () => undefined
    });
    renderer.tick();
    return captured;
  }

  it('clipStartSec = (startBeat × 60) / bpm + offsetMs/1000', () => {
    const rc = captureRC({ bpm: 120, offsetMs: 0, startBeat: 0, lengthBeats: 8 });
    expect(rc).not.toBeNull();
    expect(rc!.clipStartSec).toBeCloseTo(0, 6); // beat 0 at 120 BPM, no offset
  });

  it('clipStartSec includes offsetMs (timestamp semantics)', () => {
    const rc = captureRC({ bpm: 120, offsetMs: 200, startBeat: 0, lengthBeats: 8 });
    expect(rc).not.toBeNull();
    expect(rc!.clipStartSec).toBeCloseTo(0.2, 6); // offsetMs only
  });

  it('clipStartSec at beat 4 / 120 BPM = 2 seconds (+ offset)', () => {
    const rc = captureRC({ bpm: 120, offsetMs: 100, startBeat: 4, lengthBeats: 4 });
    expect(rc).not.toBeNull();
    expect(rc!.clipStartSec).toBeCloseTo(2.1, 6); // 2.0s + 0.1s offset
  });

  it('clipDurationSec = (lengthBeats × 60) / bpm — NO offsetMs', () => {
    const rc = captureRC({ bpm: 120, offsetMs: 500, startBeat: 0, lengthBeats: 8 });
    expect(rc).not.toBeNull();
    expect(rc!.clipDurationSec).toBeCloseTo(4, 6); // 8 beats at 120 BPM = 4s
  });

  it('clipDurationSec scales correctly with BPM', () => {
    const rc = captureRC({ bpm: 60, offsetMs: 0, startBeat: 0, lengthBeats: 4 });
    expect(rc).not.toBeNull();
    expect(rc!.clipDurationSec).toBeCloseTo(4, 6); // 4 beats at 60 BPM = 4s
  });
});
