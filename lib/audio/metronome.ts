/**
 * Plan 9c.2 Task 4 — Look-ahead oscillator metronome scheduler.
 *
 * Schedules synthetic OscillatorNode "clicks" ahead on AudioContext time using
 * the "two clocks" Web Audio pattern.  The scheduler interval fires every
 * ~25 ms and books all beat boundaries that fall within the lookahead window
 * and haven't been booked yet.
 *
 * Beat-boundary formula (inverse of loop.ts:309):
 *   T_beat(n) = n * 60/bpm + offsetMs/1000      (playback seconds)
 *   ctxOffset = getContextTime() - getCurrentTime()  (sampled each tick)
 *   when(n)   = T_beat(n) + ctxOffset            (AudioContext seconds)
 *
 * Bar-1 accent: when n % beatsPerBar === 0 → higher frequency + louder.
 * Fixed dezent levels — not user-adjustable (out of scope for this task).
 *
 * start() is idempotent; stop() is idempotent.
 * Pending already-scheduled oscillators ring out after stop().
 * Note: OscillatorNode (SourceNode) is auto-GC'd by the browser after stop(),
 * but the connected GainNode must be explicitly disconnected from the graph.
 * This is done via osc.onended so each GainNode is released once its
 * oscillator finishes — preventing accumulation of orphaned GainNodes.
 */

// ─── public types ─────────────────────────────────────────────────────────────

export interface MetronomeDeps {
  /** The live AudioContext whose `.destination` receives clicks. */
  audioContext: AudioContext;
  /** Returns the current AudioContext time (= audioContext.currentTime). */
  getContextTime: () => number;
  /** Returns the current playback position in seconds (engine.state.currentTime). */
  getCurrentTime: () => number;
  /** Returns the current beat-grid parameters. Read fresh on every scheduler tick. */
  getGrid: () => { bpm: number; beatsPerBar: number; offsetMs: number };
  /** Override scheduler interval in ms.  Default: 25 ms. */
  schedulerIntervalMs?: number;
  /** Override look-ahead window in seconds.  Default: 0.1 s. */
  lookaheadSec?: number;
  /** Injectable setInterval for testing.  Default: globalThis.setInterval. */
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Injectable clearInterval for testing.  Default: globalThis.clearInterval. */
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
}

export interface Metronome {
  /** Begin the look-ahead scheduler loop (idempotent). */
  start(): void;
  /** Clear the scheduler interval (idempotent).  Already-scheduled oscillators ring out. */
  stop(): void;
}

// ─── click constants ──────────────────────────────────────────────────────────

/** Peak gain for a normal (non-accent) beat click. */
const NORMAL_GAIN = 0.2;
/** Peak gain for the bar-1 accent click (slightly louder). */
const ACCENT_GAIN = 0.35;

/** Oscillator frequency (Hz) for a normal beat. */
const NORMAL_FREQ_HZ = 1000;
/** Oscillator frequency (Hz) for the bar-1 accent (higher pitch). */
const ACCENT_FREQ_HZ = 1500;

/** Duration of the oscillator burst in seconds (attack + decay envelope). */
const CLICK_DURATION_SEC = 0.05;

/**
 * Maximum allowed drift (in beats) between the last-scheduled beat and the
 * current playback position before the re-seed guard kicks in.
 *
 * Normal between-tick advance at 120 BPM with a 25 ms interval is
 * ~0.05 beats. The lookahead window adds another ~0.2 beats (0.1s × 2 beats/s).
 * So legitimate forward advance between ticks is well under 1 beat.
 *
 * A seek of even 1 second at 120 BPM moves 2 beats, which exceeds this margin
 * and triggers the re-seed. We use lookahead-in-beats (≈0.2) plus 2 beats of
 * headroom = ~2.2; rounding up to 4 ensures we never trip on normal advance
 * while still catching any real seek.
 */
const MAX_SCHEDULE_DRIFT_BEATS = 4;

// ─── factory ──────────────────────────────────────────────────────────────────

export function createMetronome(deps: MetronomeDeps): Metronome {
  const {
    audioContext,
    getContextTime,
    getCurrentTime,
    getGrid,
    schedulerIntervalMs = 25,
    lookaheadSec = 0.1,
    setIntervalFn = (cb, ms) => globalThis.setInterval(cb, ms),
    clearIntervalFn = (id) => globalThis.clearInterval(id),
  } = deps;

  /** The last beat index that has been scheduled (exclusive). -1 = nothing scheduled. */
  let lastScheduledBeat = -1;
  /** The native timer handle returned by setIntervalFn. null = not running. */
  let timerId: ReturnType<typeof setInterval> | null = null;

  // ── click synthesis ────────────────────────────────────────────────────────

  function scheduleClick(beatIndex: number, when: number, beatsPerBar: number): void {
    const isAccent = beatIndex % beatsPerBar === 0;
    const freq = isAccent ? ACCENT_FREQ_HZ : NORMAL_FREQ_HZ;
    const peakGain = isAccent ? ACCENT_GAIN : NORMAL_GAIN;

    // Both OscillatorNode and GainNode are one-shot: create fresh per click.
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    // Set oscillator frequency.
    osc.frequency.value = freq;

    // Set gain envelope: instant attack at `when`, then exponential decay to near-zero.
    // Using setValueAtTime for the attack anchor first (required by Web Audio spec
    // before any ramp), then a short exponential decay.
    gain.gain.setValueAtTime(peakGain, when);
    // Decay to near-silence over the click duration.
    // Use setTargetAtTime for a smooth exponential tail (time constant = 1/3 of duration).
    gain.gain.setTargetAtTime(0.001, when, CLICK_DURATION_SEC / 3);

    // Wire up: osc → gain → destination.
    osc.connect(gain);
    gain.connect(audioContext.destination);

    // Schedule the burst.
    osc.start(when);
    osc.stop(when + CLICK_DURATION_SEC);

    // Disconnect the GainNode once the oscillator has finished.
    // OscillatorNode is auto-released by the browser after stop(), but GainNode
    // remains connected to the graph until explicitly disconnected. Without this,
    // 3600+ orphaned GainNodes accumulate over a 30-minute session at 120 BPM.
    osc.onended = () => { gain.disconnect(); };
  }

  // ── scheduler tick ─────────────────────────────────────────────────────────

  function tick(): void {
    const ctxNow = getContextTime();
    const playNow = getCurrentTime();
    // Single getGrid() call per tick — consistent snapshot for bpm, beatsPerBar, offsetMs.
    const { bpm, beatsPerBar, offsetMs } = getGrid();

    // Sample the offset fresh each tick to handle clock drift and mode switches.
    const ctxOffset = ctxNow - playNow;

    // The look-ahead window: schedule all beats whose AudioContext time falls in
    // [ctxNow, ctxNow + lookaheadSec].
    const windowEnd = ctxNow + lookaheadSec;

    // Compute the beat index at which to start scheduling.
    // Beats before lastScheduledBeat have already been handled (no double-schedule).
    // For the very first tick (lastScheduledBeat === -1) seed from current position
    // so we skip all past beats in O(1) rather than iterating from beat 0.
    let n: number;
    if (lastScheduledBeat < 0) {
      // Seed: compute the first beat index whose AudioContext time >= ctxNow.
      // T_beat(n) + ctxOffset >= ctxNow
      // n * 60/bpm + offsetMs/1000 >= ctxNow - ctxOffset = playNow
      // n >= (playNow - offsetMs/1000) * bpm/60
      const rawN = (playNow - offsetMs / 1000) * bpm / 60;
      n = Math.floor(rawN);
      // n may land before the window; advance to the first visible beat.
      // (The loop below will skip any beats whose `when` < ctxNow anyway,
      //  so this is just a starting point — keep n >= 0.)
      if (n < 0) n = 0;
    } else {
      // Seek / drift re-seed guard:
      // On a forward seek, lastScheduledBeat could be far behind the new playhead,
      // causing O(seek-distance) iterations (hundreds of thousands of beats, blocking
      // the main thread). On a backward seek, lastScheduledBeat is far ahead of the
      // playhead so nothing schedules → metronome goes silent.
      // Solution: compute currentBeat from live playNow; if lastScheduledBeat has
      // drifted more than MAX_SCHEDULE_DRIFT_BEATS, re-seed from currentBeat.
      const currentBeat = Math.max(0, Math.floor((playNow - offsetMs / 1000) * bpm / 60));
      const drift = Math.abs(lastScheduledBeat - currentBeat);
      if (drift > MAX_SCHEDULE_DRIFT_BEATS) {
        // Re-seed: start from just before currentBeat so the next upcoming beat
        // schedules cleanly. Works for both forward and backward seeks.
        lastScheduledBeat = currentBeat - 1;
      }
      n = lastScheduledBeat + 1;
    }

    // Schedule all beats whose projected AudioContext time falls within the window.
    while (true) {
      const tBeat = n * (60 / bpm) + offsetMs / 1000; // playback-seconds
      const when = tBeat + ctxOffset;                  // AudioContext-seconds

      if (when > windowEnd) break; // past the lookahead window — stop

      // Only schedule beats that are in the future (not already in the past).
      if (when >= ctxNow) {
        scheduleClick(n, when, beatsPerBar);
      }

      lastScheduledBeat = n;
      n++;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  return {
    start(): void {
      if (timerId !== null) return; // idempotent
      // Reset the beat tracker so the first tick seeds from current position.
      lastScheduledBeat = -1;
      timerId = setIntervalFn(tick, schedulerIntervalMs);
    },

    stop(): void {
      if (timerId === null) return; // idempotent
      clearIntervalFn(timerId);
      timerId = null;
      // Do NOT reset lastScheduledBeat here: if start() is called again it will
      // re-seed from the new currentTime, which is the correct behaviour.
    },
  };
}
