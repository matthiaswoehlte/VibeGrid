/**
 * Plan 9d Task 6 — Ruler: Ctrl+Drag range select + plain-click clear + snap
 *
 * TDD: Tests written BEFORE implementation.
 *
 * Test 25: Ctrl+Drag (ctrlKey or metaKey) → setExportRange called with correct seconds.
 * Test 26: Plain click (no ctrl/meta) → clearExportRange called + seek still fires.
 * Test 27: Snap — clipSnap '1/4' snaps range edges to beat grid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { Ruler } from '@/components/Workspace/Timeline/Ruler';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';

// ---------------------------------------------------------------------------
// Constants mirroring Ruler.tsx internals
// ---------------------------------------------------------------------------
const BEAT_PX_BASE = 40; // from Ruler.tsx:7
const ZOOM = 1;
const PX_PER_BEAT = BEAT_PX_BASE * ZOOM; // 40 px per beat

// ruler content area starts at x=0 of the clickable div; the rect offset
// simulates the ruler area being positioned at clientX=0 in jsdom (no real
// layout), so localX = clientX - 0 = clientX.
// The sticky label column (TRACK_LABEL_WIDTH=80) is a sibling div, not part
// of the clickable area, so we pass clientX directly for the interactive div.

// ---------------------------------------------------------------------------
// Store seed helper
// ---------------------------------------------------------------------------
function seedStore(clipSnap: string = '1') {
  useAppStore.setState({
    ui: {
      zoom: ZOOM,
      selectedClipIds: [],
      selectedClipId: null,
      automationEditorClipId: null,
      automationSnap: 'off',
      clipSnap: clipSnap as never,
      exportState: EXPORT_INITIAL_STATE,
      flowMode: false,
      exportRange: null
    },
    audio: {
      grid: { bpm: 120, offsetMs: 0, source: 'manual', beatsPerBar: 4 }
    },
    timeline: {
      tracks: [{ id: 't1', kind: 'fx' as const, name: 'FX', muted: false, order: 0 }],
      clips: [],
      playhead: { beats: 0, playing: false },
      zoom: 1,
      snap: 'beat'
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers to dispatch native pointer events (jsdom-compatible pattern)
// ---------------------------------------------------------------------------
function firePointerDown(el: Element, clientX: number, opts: Partial<MouseEventInit> = {}) {
  const ev = new MouseEvent('pointerdown', { clientX, bubbles: true, ...opts });
  el.dispatchEvent(ev);
}

function firePointerMove(el: Element, clientX: number, opts: Partial<MouseEventInit> = {}) {
  const ev = new MouseEvent('pointermove', { clientX, bubbles: true, ...opts });
  el.dispatchEvent(ev);
}

function firePointerUp(el: Element, clientX?: number, opts: Partial<MouseEventInit> = {}) {
  const evOpts: MouseEventInit = { bubbles: true, ...opts };
  if (clientX !== undefined) evOpts.clientX = clientX;
  const ev = new MouseEvent('pointerup', evOpts);
  el.dispatchEvent(ev);
}

function firePointerCancel(el: Element, opts: Partial<MouseEventInit> = {}) {
  // pointercancel typically has clientX=0 (garbage/OS-cancelled)
  const ev = new MouseEvent('pointercancel', { clientX: 0, bubbles: true, ...opts });
  el.dispatchEvent(ev);
}

// ---------------------------------------------------------------------------
// Helper: compute expected seconds from beat (mirrors Ruler.tsx:29)
// ---------------------------------------------------------------------------
function beatToSec(beat: number, bpm = 120, offsetMs = 0): number {
  return (beat * 60) / bpm + offsetMs / 1000;
}

// ---------------------------------------------------------------------------
// Helper: compute snapped beat (mirrors snapBeat logic)
// ---------------------------------------------------------------------------
function snapBeat(beat: number, unit: string): number {
  if (unit === 'off') return Math.max(0, beat);
  const steps: Record<string, number> = {
    '1': 1,
    '1/2': 0.5,
    '1/4': 0.25,
    '1/8': 0.125,
    '1/16': 0.0625,
    '1/32': 0.03125
  };
  const step = steps[unit];
  return Math.max(0, Math.round(beat / step) * step);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ruler — Plan 9d Task 6', () => {
  const totalBeats = 32;
  const engine = null;

  beforeEach(() => {
    seedStore();
  });

  // -------------------------------------------------------------------------
  // Test 25a: ctrlKey drag → setExportRange called with correct seconds
  // -------------------------------------------------------------------------
  it('25a: Ctrl+Drag sets exportRange with correct start/end seconds', () => {
    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    // The clickable div is the one with role="slider"
    const slider = container.querySelector('[role="slider"]')!;

    // Simulate: slider getBoundingClientRect returns { left: 0 }
    // so localX = clientX directly.
    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    // clientX=80 → beat=80/40=2, clientX=200 → beat=200/40=5
    const xA = 80;  // beat 2
    const xB = 200; // beat 5

    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });
    firePointerUp(slider, xB, { ctrlKey: true });

    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();

    const beatA = snapBeat(xA / PX_PER_BEAT, '1'); // snap='1' default
    const beatB = snapBeat(xB / PX_PER_BEAT, '1');
    const expectedStart = beatToSec(Math.min(beatA, beatB));
    const expectedEnd = beatToSec(Math.max(beatA, beatB));

    expect(range!.start).toBeCloseTo(expectedStart, 5);
    expect(range!.end).toBeCloseTo(expectedEnd, 5);
  });

  // -------------------------------------------------------------------------
  // Test 25b: metaKey drag → setExportRange called (macOS Cmd key)
  // -------------------------------------------------------------------------
  it('25b: Cmd+Drag (metaKey) sets exportRange with correct start/end seconds', () => {
    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    const xA = 40;  // beat 1
    const xB = 160; // beat 4

    firePointerDown(slider, xA, { metaKey: true });
    firePointerMove(slider, xB, { metaKey: true });
    firePointerUp(slider, xB, { metaKey: true });

    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();

    const beatA = snapBeat(xA / PX_PER_BEAT, '1');
    const beatB = snapBeat(xB / PX_PER_BEAT, '1');
    const expectedStart = beatToSec(Math.min(beatA, beatB));
    const expectedEnd = beatToSec(Math.max(beatA, beatB));

    expect(range!.start).toBeCloseTo(expectedStart, 5);
    expect(range!.end).toBeCloseTo(expectedEnd, 5);
  });

  // -------------------------------------------------------------------------
  // Test 25c: right-to-left drag → range is still [min, max]
  // -------------------------------------------------------------------------
  it('25c: Ctrl+Drag right-to-left → range normalised (start < end)', () => {
    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    // drag from beat 6 → beat 2 (rightward to leftward)
    const xA = 240; // beat 6
    const xB = 80;  // beat 2

    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });
    firePointerUp(slider, xB, { ctrlKey: true });

    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    expect(range!.start).toBeLessThan(range!.end);
  });

  // -------------------------------------------------------------------------
  // Test 26: plain click → clearExportRange called + seek behavior preserved
  // -------------------------------------------------------------------------
  it('26: Plain click (no ctrl/meta) → clearExportRange called and seek still fires', () => {
    // First set a range so we can verify it gets cleared
    useAppStore.getState().setExportRange(1, 5);
    expect(useAppStore.getState().ui.exportRange).not.toBeNull();

    // Spy on store actions
    const setExportRangeSpy = vi.spyOn(useAppStore.getState(), 'setExportRange');
    const clearExportRangeSpy = vi.spyOn(useAppStore.getState(), 'clearExportRange');

    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    // Plain click at beat 3 (no ctrl, no meta)
    firePointerDown(slider, 120); // beat 3
    firePointerUp(slider, 120);

    // clearExportRange must have been called → exportRange is null
    expect(clearExportRangeSpy).toHaveBeenCalled();
    expect(useAppStore.getState().ui.exportRange).toBeNull();

    // Seek must still have updated the playhead
    const playhead = useAppStore.getState().timeline.playhead.beats;
    expect(playhead).toBeCloseTo(3, 5);

    setExportRangeSpy.mockRestore();
    clearExportRangeSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 27: snap — clipSnap '1/4' snaps range edges
  // -------------------------------------------------------------------------
  it('27: With clipSnap=1/4, range edges are snapped to quarter-beat grid', () => {
    // Use '1/4' snap
    seedStore('1/4');

    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    // clientX=85 → raw beat = 85/40 = 2.125 → snapped to 1/4 = 2.25 (nearest 0.25)
    // clientX=215 → raw beat = 215/40 = 5.375 → snapped to 1/4 = 5.25 or 5.5
    //   Math.round(5.375/0.25)*0.25 = Math.round(21.5)*0.25 = 22*0.25 = 5.5
    const xA = 85;  // raw 2.125 → snapped 2.25
    const xB = 215; // raw 5.375 → snapped 5.5

    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });
    firePointerUp(slider, xB, { ctrlKey: true });

    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();

    const rawBeatA = xA / PX_PER_BEAT; // 2.125
    const rawBeatB = xB / PX_PER_BEAT; // 5.375
    const snappedA = snapBeat(rawBeatA, '1/4'); // 2.25
    const snappedB = snapBeat(rawBeatB, '1/4'); // 5.5

    const expectedStart = beatToSec(Math.min(snappedA, snappedB));
    const expectedEnd = beatToSec(Math.max(snappedA, snappedB));

    expect(range!.start).toBeCloseTo(expectedStart, 5);
    expect(range!.end).toBeCloseTo(expectedEnd, 5);

    // Verify the values are actually on the snap grid (multiples of 0.25 beats)
    const bpm = 120;
    const startBeat = (range!.start * bpm) / 60;
    const endBeat = (range!.end * bpm) / 60;
    expect(startBeat % 0.25).toBeCloseTo(0, 8);
    expect(endBeat % 0.25).toBeCloseTo(0, 8);
  });

  // -------------------------------------------------------------------------
  // Test 27b: tiny drag that snaps to same beat → exportRange stays null
  // -------------------------------------------------------------------------
  it('27b: Tiny Ctrl+Drag that snaps both edges to same beat → exportRange null', () => {
    seedStore('1'); // 1-beat snap

    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    // Both xA and xB fall in the same beat → snap to beat 2 → same → null
    // beat 2 = 80px; drag from 75 to 85 (both round to beat 2 under 1-beat snap)
    const xA = 75; // raw beat 1.875 → snapped to 2
    const xB = 85; // raw beat 2.125 → snapped to 2

    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });
    firePointerUp(slider, xB, { ctrlKey: true });

    // setExportRange(2s, 2s) → store normalises to null
    expect(useAppStore.getState().ui.exportRange).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 28: pointercancel does NOT overwrite the live range (bug fix)
  // -------------------------------------------------------------------------
  it('28: pointercancel keeps last pointermove range — does not write 0/garbage', () => {
    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    const xA = 80;  // beat 2
    const xB = 200; // beat 5
    const beatA = snapBeat(xA / PX_PER_BEAT, '1'); // 2
    const beatB = snapBeat(xB / PX_PER_BEAT, '1'); // 5

    // Ctrl-drag: pointerdown at xA, pointermove to xB (live range set to [A,B])
    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });

    // Spy AFTER the live move so we can assert no further calls on cancel
    const spy = vi.spyOn(useAppStore.getState(), 'setExportRange');

    // Fire pointercancel (clientX=0, garbage)
    firePointerCancel(slider);

    // setExportRange must NOT have been called again (no commit with clientX=0)
    expect(spy).not.toHaveBeenCalled();

    // The range should still reflect the last pointermove (beat 2 → beat 5)
    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();
    const expectedStart = beatToSec(Math.min(beatA, beatB));
    const expectedEnd   = beatToSec(Math.max(beatA, beatB));
    expect(range!.start).toBeCloseTo(expectedStart, 5);
    expect(range!.end).toBeCloseTo(expectedEnd, 5);
    // Explicitly: start must NOT be 0 (which would indicate the cancel bug fired)
    expect(range!.start).not.toBeCloseTo(0, 5);

    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 29: offsetMs != 0 — committed seconds include absolute offset (R2)
  // -------------------------------------------------------------------------
  it('29: With offsetMs=350ms, committed range seconds include the offset', () => {
    // Seed store with offsetMs = 350, bpm = 120
    useAppStore.setState({
      audio: {
        grid: { bpm: 120, offsetMs: 350, source: 'manual', beatsPerBar: 4 }
      }
    });

    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    const xA = 80;  // beat 2 → 2*60/120 + 0.35 = 1.0 + 0.35 = 1.35 s
    const xB = 200; // beat 5 → 5*60/120 + 0.35 = 2.5 + 0.35 = 2.85 s

    const spy = vi.spyOn(useAppStore.getState(), 'setExportRange');

    firePointerDown(slider, xA, { ctrlKey: true });
    firePointerMove(slider, xB, { ctrlKey: true });
    firePointerUp(slider, xB, { ctrlKey: true });

    // setExportRange should have been called at least on move and on up
    expect(spy).toHaveBeenCalled();

    const range = useAppStore.getState().ui.exportRange;
    expect(range).not.toBeNull();

    const bpm = 120;
    const offsetSec = 350 / 1000;
    const beatA = snapBeat(xA / PX_PER_BEAT, '1'); // 2
    const beatB = snapBeat(xB / PX_PER_BEAT, '1'); // 5
    const expectedStart = (Math.min(beatA, beatB) * 60) / bpm + offsetSec; // 1.35
    const expectedEnd   = (Math.max(beatA, beatB) * 60) / bpm + offsetSec; // 2.85

    expect(range!.start).toBeCloseTo(expectedStart, 5); // 1.35
    expect(range!.end).toBeCloseTo(expectedEnd, 5);     // 2.85
    // Confirm offset is actually included (would be 1.0 and 2.5 without it)
    expect(range!.start).toBeGreaterThan(1.0);
    expect(range!.end).toBeGreaterThan(2.5);

    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test: ctrl+drag must NOT trigger seekFromClient (playhead stays put)
  // -------------------------------------------------------------------------
  it('Ctrl+Drag does NOT move the playhead (seek suppressed)', () => {
    const { container } = render(<Ruler totalBeats={totalBeats} engine={engine} />);
    const slider = container.querySelector('[role="slider"]')!;

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: totalBeats * PX_PER_BEAT, top: 0, bottom: 24, width: totalBeats * PX_PER_BEAT, height: 24 }),
      configurable: true
    });

    const initialPlayhead = useAppStore.getState().timeline.playhead.beats;

    firePointerDown(slider, 160, { ctrlKey: true }); // beat 4
    firePointerMove(slider, 200, { ctrlKey: true }); // beat 5
    firePointerUp(slider, 200, { ctrlKey: true });

    const afterPlayhead = useAppStore.getState().timeline.playhead.beats;
    expect(afterPlayhead).toBe(initialPlayhead); // unchanged
  });
});
