/**
 * Plan 9d Task 7 — RangeOverlay: orange band aligned to beat/pixel space
 *
 * TDD: Tests written BEFORE implementation.
 *
 * Test 28a: overlay renders band ONLY when exportRange !== null.
 * Test 28b: band left/width match beat→pixel math for a known range.
 * Test 28c: band left/width correct when offsetMs != 0.
 * Test 28d: pointer-events: none is set on the band.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { RangeOverlay } from '@/components/Workspace/Timeline/RangeOverlay';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import { BEAT_PX_BASE, TRACK_LABEL_WIDTH } from '@/components/Workspace/Timeline/timeline-layout';

// ---------------------------------------------------------------------------
// Store seed helper
// ---------------------------------------------------------------------------
function seedStore(overrides: {
  bpm?: number;
  offsetMs?: number;
  zoom?: number;
  exportRange?: { start: number; end: number } | null;
} = {}) {
  const {
    bpm = 120,
    offsetMs = 0,
    zoom = 1,
    exportRange = null,
  } = overrides;

  useAppStore.setState({
    ui: {
      zoom,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: '1' as never,
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange,
      metronomeEnabled: false,
      seekNonce: 0
    },
    audio: {
      grid: { bpm, offsetMs, source: 'manual', beatsPerBar: 4 },
    },
    timeline: {
      tracks: [],
      clips: [],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat',
    },
  });
}

// ---------------------------------------------------------------------------
// Beat→pixel helper (mirrors Playhead.tsx formula)
// ---------------------------------------------------------------------------
function secToPixel(sec: number, bpm: number, offsetMs: number, zoom: number): number {
  const beats = Math.max(0, (sec - offsetMs / 1000) * bpm / 60);
  return TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RangeOverlay — Plan 9d Task 7', () => {
  beforeEach(() => {
    seedStore();
  });

  // -------------------------------------------------------------------------
  // Test 28a: renders nothing when exportRange is null
  // -------------------------------------------------------------------------
  it('28a: renders nothing when exportRange is null', () => {
    seedStore({ exportRange: null });
    const { container } = render(<RangeOverlay />);
    // No band div should be in the DOM
    const band = container.querySelector('[data-testid="range-overlay-band"]');
    expect(band).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 28a (cont): renders band when exportRange is set
  // -------------------------------------------------------------------------
  it('28a: renders the band element when exportRange is set', () => {
    seedStore({ exportRange: { start: 1, end: 2 } });
    const { container } = render(<RangeOverlay />);
    const band = container.querySelector('[data-testid="range-overlay-band"]');
    expect(band).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 28b: left and width match beat→pixel math
  //
  // bpm=120, zoom=1, offsetMs=0
  //   start=1s → beat=2 → px = 80 + 2*40*1 = 160
  //   end=2s   → beat=4 → px = 80 + 4*40*1 = 240
  //   width = 240 - 160 = 80
  // -------------------------------------------------------------------------
  it('28b: band left and width match beat→pixel math (bpm=120, zoom=1, no offset)', () => {
    const bpm = 120;
    const zoom = 1;
    const offsetMs = 0;
    const start = 1; // seconds
    const end = 2;   // seconds

    seedStore({ bpm, zoom, offsetMs, exportRange: { start, end } });

    const { container } = render(<RangeOverlay />);
    const band = container.querySelector('[data-testid="range-overlay-band"]') as HTMLElement | null;
    expect(band).not.toBeNull();

    const expectedLeft = secToPixel(start, bpm, offsetMs, zoom);
    const expectedRight = secToPixel(end, bpm, offsetMs, zoom);
    const expectedWidth = expectedRight - expectedLeft;

    // Inline styles are the source of truth (numeric or px string)
    const left = parseFloat(band!.style.left);
    const width = parseFloat(band!.style.width);

    expect(left).toBeCloseTo(expectedLeft, 3);   // 160 px
    expect(width).toBeCloseTo(expectedWidth, 3); // 80 px
  });

  // -------------------------------------------------------------------------
  // Test 28b (zoom): zoom=2 doubles pixel values
  //
  // bpm=120, zoom=2, offsetMs=0
  //   start=1s → beat=2 → px = 80 + 2*40*2 = 240
  //   end=2s   → beat=4 → px = 80 + 4*40*2 = 400
  //   width = 400 - 240 = 160
  // -------------------------------------------------------------------------
  it('28b: band left and width scale with zoom', () => {
    const bpm = 120;
    const zoom = 2;
    const offsetMs = 0;
    const start = 1;
    const end = 2;

    seedStore({ bpm, zoom, offsetMs, exportRange: { start, end } });

    const { container } = render(<RangeOverlay />);
    const band = container.querySelector('[data-testid="range-overlay-band"]') as HTMLElement | null;
    expect(band).not.toBeNull();

    const expectedLeft = secToPixel(start, bpm, offsetMs, zoom);
    const expectedRight = secToPixel(end, bpm, offsetMs, zoom);
    const expectedWidth = expectedRight - expectedLeft;

    const left = parseFloat(band!.style.left);
    const width = parseFloat(band!.style.width);

    expect(left).toBeCloseTo(expectedLeft, 3);   // 240 px
    expect(width).toBeCloseTo(expectedWidth, 3); // 160 px
  });

  // -------------------------------------------------------------------------
  // Test 28c: offsetMs shifts left/width correctly
  //
  // bpm=120, zoom=1, offsetMs=1000 (1 s)
  //   start=2s → beat = (2 - 1)*120/60 = 2 → px = 80 + 2*40 = 160
  //   end=3s   → beat = (3 - 1)*120/60 = 4 → px = 80 + 4*40 = 240
  //   width = 80
  // -------------------------------------------------------------------------
  it('28c: offsetMs is factored into the beat→pixel conversion', () => {
    const bpm = 120;
    const zoom = 1;
    const offsetMs = 1000; // 1 second offset
    const start = 2; // beat (2-1)*2=2 → same visual as no-offset start=1
    const end = 3;

    seedStore({ bpm, zoom, offsetMs, exportRange: { start, end } });

    const { container } = render(<RangeOverlay />);
    const band = container.querySelector('[data-testid="range-overlay-band"]') as HTMLElement | null;
    expect(band).not.toBeNull();

    const expectedLeft = secToPixel(start, bpm, offsetMs, zoom);
    const expectedRight = secToPixel(end, bpm, offsetMs, zoom);
    const expectedWidth = expectedRight - expectedLeft;

    const left = parseFloat(band!.style.left);
    const width = parseFloat(band!.style.width);

    expect(left).toBeCloseTo(expectedLeft, 3);
    expect(width).toBeCloseTo(expectedWidth, 3);

    // Sanity: with 1s offset, start=2s → same visual as no-offset start=1s
    const noOffsetEquiv = secToPixel(1, bpm, 0, zoom); // 160
    expect(left).toBeCloseTo(noOffsetEquiv, 3);
  });

  // -------------------------------------------------------------------------
  // Test 28d: pointer-events: none on the band
  // -------------------------------------------------------------------------
  it('28d: band has pointer-events: none so ctrl-drag on ruler still works', () => {
    seedStore({ exportRange: { start: 0.5, end: 1.5 } });
    const { container } = render(<RangeOverlay />);
    const band = container.querySelector('[data-testid="range-overlay-band"]') as HTMLElement | null;
    expect(band).not.toBeNull();

    // Tailwind class or inline style — accept either
    const hasClass = band!.classList.contains('pointer-events-none');
    const hasStyle = band!.style.pointerEvents === 'none';
    expect(hasClass || hasStyle).toBe(true);
  });
});
