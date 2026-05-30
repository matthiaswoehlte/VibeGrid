/**
 * Plan 9c.2 Task 4 — Metronome scheduler tests (TDD, written first).
 *
 * The metronome is a self-contained look-ahead oscillator click scheduler.
 * It schedules synthetic OscillatorNode clicks on AudioContext time, one beat
 * ahead of playback, correcting for the currentTime→AudioContext-time offset.
 *
 * Beat-boundary formula (inverted from loop.ts:309):
 *   T_beat(n) = n * 60/bpm + offsetMs/1000   (playback-seconds)
 *   when(n)   = T_beat(n) + ctxOffset         (AudioContext-seconds)
 *   ctxOffset = getContextTime() - getCurrentTime()  (sampled each tick)
 *
 * Mock strategy:
 *  - AudioContext mock with createOscillator / createGain spy nodes.
 *  - Injected setIntervalFn / clearIntervalFn for synchronous control.
 *  - Controllable getContextTime / getCurrentTime / getGrid.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMetronome } from '@/lib/audio/metronome';
import type { MetronomeDeps } from '@/lib/audio/metronome';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a spy OscillatorNode with the minimal interface the metronome uses. */
function makeOscNode() {
  const node = {
    frequency: { value: 440, setValueAtTime: vi.fn() },
    gain: undefined as unknown as ReturnType<typeof makeGainNode>, // unused on osc
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    /** Set by the metronome via osc.onended = ...; tests can call it to simulate end. */
    onended: null as (() => void) | null,
  };
  return node;
}

/** Build a spy GainNode with the minimal interface the metronome uses. */
function makeGainNode() {
  const node = {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return node;
}

/** Minimal AudioContext mock. Captures created osc/gain nodes per creation order. */
function makeAudioContextMock() {
  const oscNodes: ReturnType<typeof makeOscNode>[] = [];
  const gainNodes: ReturnType<typeof makeGainNode>[] = [];

  const ctx = {
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createOscillator: vi.fn(() => {
      const n = makeOscNode();
      oscNodes.push(n);
      return n;
    }),
    createGain: vi.fn(() => {
      const n = makeGainNode();
      gainNodes.push(n);
      return n;
    }),
  };

  return { ctx, oscNodes, gainNodes };
}

/**
 * Build a MetronomeDeps object with controllable state and injected interval fns.
 * Returns deps + helpers to fire scheduler ticks and inspect created nodes.
 */
function buildDeps(overrides: Partial<{
  contextTime: number;
  currentTime: number;
  bpm: number;
  beatsPerBar: number;
  offsetMs: number;
  schedulerIntervalMs: number;
  lookaheadSec: number;
}> = {}) {
  const state = {
    contextTime: overrides.contextTime ?? 0,
    currentTime: overrides.currentTime ?? 0,
    bpm: overrides.bpm ?? 120,
    beatsPerBar: overrides.beatsPerBar ?? 4,
    offsetMs: overrides.offsetMs ?? 0,
  };

  const { ctx, oscNodes, gainNodes } = makeAudioContextMock();

  // Injected interval infra — synchronous, fully controllable.
  let schedulerCb: (() => void) | null = null;
  const setIntervalFn = vi.fn((cb: () => void, _ms: number) => {
    schedulerCb = cb;
    return 1 as unknown as ReturnType<typeof setInterval>; // fake timer ID
  });
  const clearIntervalFn = vi.fn();

  const deps: MetronomeDeps = {
    audioContext: ctx as unknown as AudioContext,
    getContextTime: () => state.contextTime,
    getCurrentTime: () => state.currentTime,
    getGrid: () => ({
      bpm: state.bpm,
      beatsPerBar: state.beatsPerBar,
      offsetMs: state.offsetMs,
    }),
    schedulerIntervalMs: overrides.schedulerIntervalMs ?? 25,
    lookaheadSec: overrides.lookaheadSec ?? 0.1,
    setIntervalFn,
    clearIntervalFn,
  };

  /** Fire the injected scheduler callback (simulates one interval tick). */
  function tick() {
    if (!schedulerCb) throw new Error('Scheduler not started — call metronome.start() first');
    schedulerCb();
  }

  return { deps, state, ctx, oscNodes, gainNodes, tick, setIntervalFn, clearIntervalFn };
}

/**
 * Compute the expected AudioContext time for beat index `n`.
 * Mirrors the inverse of loop.ts:309:
 *   beats = (time - offsetMs/1000) * bpm/60
 *   => T_beat(n) = n * 60/bpm + offsetMs/1000
 *   => when(n)   = T_beat(n) + ctxOffset
 *                = T_beat(n) + (contextTime - currentTime)
 */
function expectedWhen(
  n: number,
  { bpm, offsetMs, contextTime, currentTime }: {
    bpm: number; offsetMs: number; contextTime: number; currentTime: number;
  }
): number {
  const tBeat = n * (60 / bpm) + offsetMs / 1000;
  const ctxOffset = contextTime - currentTime;
  return tBeat + ctxOffset;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Metronome scheduler (Plan 9c.2 T4)', () => {

  // ── Test 13: start/stop and click scheduling ─────────────────────────────
  describe('Test 13: start() triggers look-ahead scheduling; stop() halts it', () => {
    it('schedules oscillator clicks at correct beat-boundary AudioContext times', () => {
      // BPM=120 → beat period = 0.5s. lookahead=0.5s so we expect multiple beats.
      const { deps, state, oscNodes, tick, clearIntervalFn } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.5,
      });

      const metro = createMetronome(deps);
      metro.start();

      // First tick: schedule beats in [contextTime, contextTime + 0.5]
      // Beat 0 @ 0.0s, beat 1 @ 0.5s — beat 1 is AT the lookahead boundary.
      tick();

      // At least beats 0 and 1 should be scheduled (both ≤ 0.5).
      // Beat period = 0.5, lookahead = 0.5 → beats 0, 1 both fall inside window.
      expect(oscNodes.length).toBeGreaterThanOrEqual(2);

      // Each osc.start(when) must be called with the correct AudioContext time.
      // ctxOffset = 0 - 0 = 0, so when(n) = n * 0.5 + 0 = n * 0.5
      const beat0When = expectedWhen(0, { bpm: 120, offsetMs: 0, contextTime: 0, currentTime: 0 });
      const beat1When = expectedWhen(1, { bpm: 120, offsetMs: 0, contextTime: 0, currentTime: 0 });

      expect(oscNodes[0].start).toHaveBeenCalledWith(expect.closeTo(beat0When, 4));
      expect(oscNodes[1].start).toHaveBeenCalledWith(expect.closeTo(beat1When, 4));

      // stop() clears the interval and schedules no more clicks
      metro.stop();
      expect(clearIntervalFn).toHaveBeenCalledWith(1);

      const countBefore = oscNodes.length;
      // Further tick is ignored (interval cleared — scheduler won't fire again
      // in real usage; simulate it manually just to prove idempotence if it did).
      // The clearIntervalFn was called, so the scheduler is logically stopped.
      expect(oscNodes.length).toBe(countBefore); // no new nodes from stop() itself
    });

    it('stop() is idempotent — calling it twice does not throw', () => {
      const { deps } = buildDeps();
      const metro = createMetronome(deps);
      metro.start();
      expect(() => { metro.stop(); metro.stop(); }).not.toThrow();
    });

    it('start() is idempotent — calling it twice does not double-register the interval', () => {
      const { deps, setIntervalFn } = buildDeps();
      const metro = createMetronome(deps);
      metro.start();
      metro.start(); // second call must be a no-op
      expect(setIntervalFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Test 14: look-ahead offset mapping ───────────────────────────────────
  describe('Test 14: clicks use AudioContext look-ahead (not "now") + offset applied', () => {
    it('schedules osc.start(when) with computed AudioContext time, not contextTime', () => {
      // Non-zero offset: AudioContext is 5 seconds ahead of playback position.
      // currentTime (playback) = 0.0, contextTime = 5.0 → ctxOffset = 5.
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 60,           // 1 beat/sec → T_beat(0)=0s, T_beat(1)=1s
        offsetMs: 0,
        contextTime: 5.0,  // AudioContext time
        currentTime: 0.0,  // playback time
        lookaheadSec: 1.5, // see beats 0 and 1 (at 0s and 1s playback)
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // Expected: when(0) = 0 + 5 = 5.0, when(1) = 1 + 5 = 6.0
      expect(oscNodes.length).toBeGreaterThanOrEqual(2);
      expect(oscNodes[0].start).toHaveBeenCalledWith(expect.closeTo(5.0, 4));
      expect(oscNodes[1].start).toHaveBeenCalledWith(expect.closeTo(6.0, 4));

      metro.stop();
    });

    it('offsetMs shifts the beat boundary time correctly', () => {
      // offsetMs=500 → beat 0 is at 0.5s playback, beat 1 at 1.5s.
      // ctxOffset = 0 (contextTime == currentTime == 0).
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 60,
        offsetMs: 500,     // 0.5s grid offset
        contextTime: 0.0,
        currentTime: 0.0,
        lookaheadSec: 2.0, // see beats 0 and 1
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // T_beat(0) = 0*1 + 0.5 = 0.5, T_beat(1) = 1*1 + 0.5 = 1.5
      // ctxOffset = 0, so when(n) = T_beat(n)
      expect(oscNodes.length).toBeGreaterThanOrEqual(2);
      expect(oscNodes[0].start).toHaveBeenCalledWith(expect.closeTo(0.5, 4));
      expect(oscNodes[1].start).toHaveBeenCalledWith(expect.closeTo(1.5, 4));

      metro.stop();
    });

    it('negative offsetMs shifts beats earlier', () => {
      // offsetMs=-500 → beat 0 at -0.5s (past, must be skipped), beat 1 at 0.5s.
      // ctxOffset=0, contextTime=0, getCurrentTime=0
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 60,
        offsetMs: -500,    // -0.5s offset → beat 0 is in the past
        contextTime: 0.0,
        currentTime: 0.0,
        lookaheadSec: 1.0,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // Beat 0 at when=-0.5 < contextTime=0 → skipped.
      // Beat 1 at when=0.5 → scheduled.
      // All scheduled beats must have when >= contextTime (0).
      for (const osc of oscNodes) {
        const when = (osc.start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        expect(when).toBeGreaterThanOrEqual(0);
      }

      metro.stop();
    });

    it('live-sampled ctxOffset: if contextTime drifts between ticks, scheduling adjusts', () => {
      const { deps, state, oscNodes, tick } = buildDeps({
        bpm: 60,         // 1 beat/sec
        offsetMs: 0,
        contextTime: 10, // initial context time
        currentTime: 5,  // playback at 5s → ctxOffset = 5
        lookaheadSec: 1.5,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick(); // tick 1: schedules beats visible from currentTime=5

      // Advance playback and context time by 2 seconds for next tick.
      state.currentTime = 7;
      state.contextTime = 12; // ctxOffset still = 5

      tick(); // tick 2: schedules next beats (no double-schedule)

      // All scheduled beats must reflect the offset at time of scheduling.
      for (const osc of oscNodes) {
        const when = (osc.start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        expect(when).toBeGreaterThanOrEqual(10); // min: contextTime at start
      }

      metro.stop();
    });
  });

  // ── Test 15: bar-1 accent ────────────────────────────────────────────────
  describe('Test 15: bar-1 accent — beat 0 mod beatsPerBar gets accented params', () => {
    it('beatsPerBar=4: beats 0 and 4 have higher frequency than beats 1,2,3', () => {
      // Lookahead large enough to see 5 beats (0..4) in one tick.
      // BPM=120 → 0.5s/beat; 5 beats = 2.5s. lookahead=3s.
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        beatsPerBar: 4,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 3.0,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // Expect at least 5 beats (0,1,2,3,4) to be scheduled.
      expect(oscNodes.length).toBeGreaterThanOrEqual(5);

      // Extract the frequency set on each osc node.
      // The metronome sets osc.frequency.value directly or via setValueAtTime.
      // We check frequency.value (set synchronously at node construction).
      const freq = (n: (typeof oscNodes)[number]) => n.frequency.value;

      const accentFreq = freq(oscNodes[0]); // beat 0 (bar-1 accent)
      const normalFreq = freq(oscNodes[1]); // beat 1 (normal)

      // Accent frequency must be strictly higher than normal.
      expect(accentFreq).toBeGreaterThan(normalFreq);

      // Beats 1, 2, 3 must be normal.
      expect(freq(oscNodes[1])).toBe(normalFreq);
      expect(freq(oscNodes[2])).toBe(normalFreq);
      expect(freq(oscNodes[3])).toBe(normalFreq);

      // Beat 4 (n=4, 4%4=0) must be accented again.
      expect(freq(oscNodes[4])).toBe(accentFreq);

      metro.stop();
    });

    it('beatsPerBar=3: accent on beats 0, 3, 6 (not hardcoded 4)', () => {
      // BPM=120 → 0.5s/beat; 7 beats = 3.5s. lookahead=4s.
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        beatsPerBar: 3,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 4.0,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // Expect beats 0..6 (7 beats, each 0.5s → 3.0s < 4.0s lookahead).
      expect(oscNodes.length).toBeGreaterThanOrEqual(7);

      const freq = (n: (typeof oscNodes)[number]) => n.frequency.value;
      const accentFreq = freq(oscNodes[0]); // beat 0 (0%3=0, accented)
      const normalFreq  = freq(oscNodes[1]); // beat 1 (1%3≠0, normal)

      expect(accentFreq).toBeGreaterThan(normalFreq);

      // beats 1,2 normal; beat 3 (3%3=0) accented; beats 4,5 normal; beat 6 accented
      expect(freq(oscNodes[1])).toBe(normalFreq);
      expect(freq(oscNodes[2])).toBe(normalFreq);
      expect(freq(oscNodes[3])).toBe(accentFreq);
      expect(freq(oscNodes[4])).toBe(normalFreq);
      expect(freq(oscNodes[5])).toBe(normalFreq);
      expect(freq(oscNodes[6])).toBe(accentFreq);

      metro.stop();
    });

    it('beatsPerBar=1: every beat is accented (no normal beats)', () => {
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        beatsPerBar: 1,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 2.0, // 4 beats of 0.5s
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(oscNodes.length).toBeGreaterThanOrEqual(4);

      const accentFreq = oscNodes[0].frequency.value;
      // All beats must have the accent frequency (n%1 === 0 always).
      for (const osc of oscNodes) {
        expect(osc.frequency.value).toBe(accentFreq);
      }

      metro.stop();
    });

    it('accent gain is higher than normal gain', () => {
      // Confirm the GainNode peak level is also higher for accented beats.
      const { deps, gainNodes, tick } = buildDeps({
        bpm: 120,
        beatsPerBar: 4,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 1.5, // beats 0 (accent), 1 (normal), 2 (normal)
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(gainNodes.length).toBeGreaterThanOrEqual(3);

      // Inspect the peak gain set on each GainNode.
      // The metronome calls gain.setValueAtTime(peakValue, when) for the attack.
      const peakGain = (gn: (typeof gainNodes)[number]) => {
        const calls = gn.gain.setValueAtTime.mock.calls;
        // First call is the peak (attack); find the max value set.
        if (calls.length === 0) return gn.gain.value; // fallback
        return Math.max(...calls.map((c: unknown[]) => c[0] as number));
      };

      const accentPeak = peakGain(gainNodes[0]);
      const normalPeak = peakGain(gainNodes[1]);

      expect(accentPeak).toBeGreaterThan(normalPeak);
    });
  });

  // ── No-double-schedule ────────────────────────────────────────────────────
  describe('No-double-schedule: re-ticking without advancing time does not re-schedule', () => {
    it('same beats are not scheduled twice on consecutive ticks with same times', () => {
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.5,
      });

      const metro = createMetronome(deps);
      metro.start();

      tick(); // first tick — schedules beats in window
      const countAfterFirst = oscNodes.length;

      tick(); // second tick — same window (no time advanced) → NO new beats
      expect(oscNodes.length).toBe(countAfterFirst);

      tick(); // third tick — still same window → NO new beats
      expect(oscNodes.length).toBe(countAfterFirst);

      metro.stop();
    });

    it('new beats are scheduled only after time advances past the window', () => {
      // BPM=60 → 1s/beat. lookahead=0.6s. Start at time=0.
      // Tick 1: contextTime=0, currentTime=0 → see beat 0 (at 0s) only.
      // Advance to contextTime=1.0, currentTime=1.0 → see beat 1 (at 1.0s).
      const { deps, state, oscNodes, tick } = buildDeps({
        bpm: 60,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.6,
      });

      const metro = createMetronome(deps);
      metro.start();

      tick();
      const countAfterTick1 = oscNodes.length; // beat 0 scheduled

      // Tick again without advancing — no change.
      tick();
      expect(oscNodes.length).toBe(countAfterTick1);

      // Advance 1 second — beat 1 is now in the window.
      state.contextTime = 1.0;
      state.currentTime = 1.0;

      tick();
      expect(oscNodes.length).toBe(countAfterTick1 + 1); // exactly one new beat

      metro.stop();
    });
  });

  // ── Graph / wiring ────────────────────────────────────────────────────────
  describe('Web Audio graph wiring', () => {
    it('each click: osc connected to gain, gain connected to destination', () => {
      const { deps, ctx, oscNodes, gainNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(oscNodes.length).toBeGreaterThanOrEqual(1);
      expect(gainNodes.length).toBe(oscNodes.length);

      // Osc must connect to the corresponding gain node.
      expect(oscNodes[0].connect).toHaveBeenCalledWith(gainNodes[0]);
      // Gain must connect to the destination.
      expect(gainNodes[0].connect).toHaveBeenCalledWith(ctx.destination);

      metro.stop();
    });

    it('osc.stop() is scheduled at when + click duration (not immediate)', () => {
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(oscNodes.length).toBeGreaterThanOrEqual(1);

      const startWhen = (oscNodes[0].start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
      const stopWhen = (oscNodes[0].stop as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;

      // stop time must be strictly after start time (click has non-zero duration).
      expect(stopWhen).toBeGreaterThan(startWhen);
      // click duration must be reasonable (≥ 20ms, ≤ 200ms).
      expect(stopWhen - startWhen).toBeGreaterThanOrEqual(0.020);
      expect(stopWhen - startWhen).toBeLessThanOrEqual(0.200);
    });
  });

  // ── Gain envelope ─────────────────────────────────────────────────────────
  describe('Gain envelope', () => {
    it('peak gain is in the dezent range [0.1, 0.5]', () => {
      const { deps, gainNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(gainNodes.length).toBeGreaterThanOrEqual(1);

      const calls = gainNodes[0].gain.setValueAtTime.mock.calls;
      const maxGain = Math.max(...calls.map((c: unknown[]) => c[0] as number));
      expect(maxGain).toBeGreaterThanOrEqual(0.1);
      expect(maxGain).toBeLessThanOrEqual(0.5);
    });
  });

  // ── start() initializes from current position (no flood of past beats) ────
  describe('start() seeds the beat tracker from current position', () => {
    it('when currentTime is mid-song, only future beats are scheduled (not past ones)', () => {
      // BPM=60 → 1s/beat. We start playback at 10s. Lookahead=1.5s.
      // Only beats 10, 11 should be scheduled (not 0..9).
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 60,
        offsetMs: 0,
        contextTime: 10, // AudioContext at 10s
        currentTime: 10, // playback also at 10s → ctxOffset=0
        lookaheadSec: 1.5,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      // Should schedule beats 10 and 11 (when=10.0 and 11.0).
      // Must NOT schedule beats 0..9 (all in the past).
      expect(oscNodes.length).toBeGreaterThanOrEqual(2);

      for (const osc of oscNodes) {
        const when = (osc.start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        // All scheduled times must be >= contextTime.
        expect(when).toBeGreaterThanOrEqual(10);
      }
    });

    it('does not flood if currentTime is large (many past beats skipped)', () => {
      // 3600s / (60/120) = 432000 past beats. Must not loop through them all.
      const { deps, oscNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 3600, // 1 hour into playback
        currentTime: 3600,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();

      const before = Date.now();
      tick();
      const elapsed = Date.now() - before;

      // Must complete in well under 50ms (no O(n) loop over past beats).
      expect(elapsed).toBeLessThan(50);

      // Only future beats scheduled (none in the past).
      for (const osc of oscNodes) {
        const when = (osc.start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        expect(when).toBeGreaterThanOrEqual(3600);
      }
    });
  });

  // ── Seek re-seed guard ────────────────────────────────────────────────────
  describe('Seek re-seed guard: metronome self-heals after a seek without stop/start', () => {
    it('forward seek: tick stays bounded (O(lookahead)) and schedules at the new position', () => {
      // BPM=120, lookahead=0.1s → ~0.2 beats per lookahead window.
      // Run a few ticks at position 0, then jump getCurrentTime far forward (30s = 60 beats).
      // The re-seed guard must kick in and bound the loop to ≤ ~3 new oscillators per tick
      // (not 60+ stale beats). New clicks must have `when` >= the new AudioContext time.
      const { deps, state, oscNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();

      // Tick at position 0 — seeds lastScheduledBeat near beat 0.
      tick();
      const countAfterSeed = oscNodes.length;

      // Simulate a forward seek of 30 seconds (60 beats at 120 BPM).
      state.currentTime = 30;
      state.contextTime = 30; // ctxOffset stays 0

      const before = Date.now();
      tick(); // must NOT iterate 60 beats — re-seed guard kicks in
      const elapsed = Date.now() - before;

      // Must complete quickly (re-seed limits loop to O(lookahead) beats).
      expect(elapsed).toBeLessThan(50);

      // Total new oscillators from this tick must be small (bounded by lookahead window).
      // At 120 BPM with 0.1s lookahead we expect at most ~2-3 beats per tick.
      const newOscs = oscNodes.length - countAfterSeed;
      expect(newOscs).toBeLessThanOrEqual(5);

      // All new clicks must be at or after the new AudioContext time (30s).
      for (let i = countAfterSeed; i < oscNodes.length; i++) {
        const when = (oscNodes[i].start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        expect(when).toBeGreaterThanOrEqual(30);
      }

      metro.stop();
    });

    it('backward seek: metronome resumes scheduling at the earlier position (not silent)', () => {
      // BPM=60, lookahead=0.6s. Advance a few beats, then jump back to near 0.
      // Without the re-seed guard, lastScheduledBeat=N > currentBeat → loop never enters
      // → metronome goes silent.
      const { deps, state, oscNodes, tick } = buildDeps({
        bpm: 60,
        offsetMs: 0,
        contextTime: 5,
        currentTime: 5, // ctxOffset=0; beats at 5.0, 6.0, ...
        lookaheadSec: 0.6,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick(); // schedules beat 5 (when=5.0 < 5.6)
      const countAfterForward = oscNodes.length;
      expect(countAfterForward).toBeGreaterThanOrEqual(1);

      // Simulate a backward seek back to 0 (lastScheduledBeat is now far ahead).
      state.currentTime = 0;
      state.contextTime = 0;

      tick(); // re-seed guard must reset lastScheduledBeat; beat 0 must schedule
      const countAfterBackward = oscNodes.length;

      // Must have scheduled at least one new click at/after the new position.
      expect(countAfterBackward).toBeGreaterThan(countAfterForward);

      // New clicks must be at or after the rewound AudioContext time (0s).
      for (let i = countAfterForward; i < oscNodes.length; i++) {
        const when = (oscNodes[i].start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        expect(when).toBeGreaterThanOrEqual(0);
      }

      metro.stop();
    });
  });

  // ── GainNode disconnect via onended ──────────────────────────────────────
  describe('GainNode disconnect: gain.disconnect() is called when osc.onended fires', () => {
    it('each scheduled click: gain.disconnect() is called after osc.onended fires', () => {
      // Schedule one click, then simulate the oscillator finishing (fire onended).
      // The GainNode's disconnect spy must be called exactly once per click.
      const { deps, oscNodes, gainNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.1,
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(oscNodes.length).toBeGreaterThanOrEqual(1);
      expect(gainNodes.length).toBe(oscNodes.length);

      // Before onended fires, gain.disconnect must NOT have been called.
      expect(gainNodes[0].disconnect).not.toHaveBeenCalled();

      // Simulate the oscillator finishing by firing osc.onended.
      expect(oscNodes[0].onended).not.toBeNull();
      oscNodes[0].onended!();

      // Now gain.disconnect must have been called exactly once.
      expect(gainNodes[0].disconnect).toHaveBeenCalledTimes(1);

      metro.stop();
    });

    it('each click gets its own independent onended → disconnect pair', () => {
      // Schedule multiple clicks; firing onended for click N must only disconnect gain N.
      const { deps, oscNodes, gainNodes, tick } = buildDeps({
        bpm: 120,
        offsetMs: 0,
        contextTime: 0,
        currentTime: 0,
        lookaheadSec: 0.5, // multiple beats
      });

      const metro = createMetronome(deps);
      metro.start();
      tick();

      expect(oscNodes.length).toBeGreaterThanOrEqual(2);

      // Fire onended only for the second oscillator.
      oscNodes[1].onended!();

      // Only gain[1] should be disconnected; gain[0] must still be connected.
      expect(gainNodes[0].disconnect).not.toHaveBeenCalled();
      expect(gainNodes[1].disconnect).toHaveBeenCalledTimes(1);

      metro.stop();
    });
  });
});
