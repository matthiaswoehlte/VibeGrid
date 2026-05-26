# VibeGrid Plan 2 — Audio Engine + Beat Detection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the audio subsystem — pure grid math, a pure energy-based beat detector, two Web Workers (beat detection with progress + waveform downsampling), an `AudioEngine` factory that owns the lazy-initialized `AudioContext` and wires `MediaElement → Analyser → MediaStreamDestination → speakers`, and a Zustand `audio` slice exposing `BeatGrid` to the rest of the app.

**Architecture:** Three layers, sharply separated. (1) `lib/audio/grid.ts` and `lib/audio/beat-detector.ts` are **pure functions** taking `{ data: Float32Array, sampleRate }` — no WebAudio, no DOM, fully unit-testable in jsdom. (2) `lib/audio/*.worker.ts` are thin wrappers around the pure detector that emit `progress` events 0–100. (3) `lib/audio/engine.ts` is a singleton class produced by `createAudioEngine()` that owns the WebAudio graph; `currentTime` comes from `audioElement.currentTime` (no RAF drift). The store gets a minimal `audio.grid: BeatGrid` slice (persisted) and `setBPM`/`setDetectedGrid` actions; transient engine state (status, currentTime) is exposed via `engine.onStateChange` and never persisted.

**Tech Stack:** TypeScript strict, Web Audio API, Web Workers (Vite `?worker` suffix), Vitest + jsdom (existing). No new runtime dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §5 (Audio Engine & Beat Detection), §6.1 (`isOnBeat` in selectors uses `beatPhase`), §10 (audioGrid persistence).

**Verification gate (must pass before Plan 3 starts):**

```
npm test -- audio            # ≥ 35 tests across grid + detector + engine, all green
npm test -- store            # existing store tests still pass, plus new audio-slice tests
npm run typecheck            # clean
npm run lint                 # clean
npm run build                # clean (catches worker-bundling errors)
```

**Dependencies on prior plans:** Plan 0 (scaffold, `isClient()`, vitest, Zustand store). Plan 1 (`lib/store/index.ts` already composes a `timeline` slice — this plan adds a parallel `audio` slice).

---

## File map

| File | Purpose |
|---|---|
| `lib/audio/types.ts` | `BeatGrid`, `AudioStatus`, `AudioEngineState`, `BeatDetectionResult`, `BeatPhaseResult` |
| `lib/audio/grid.ts` | Pure: `timeToBeats`, `beatPhase` (with 40 ms window), `BEAT_WINDOW_MS` constant |
| `lib/audio/beat-detector.ts` | Pure: `detectBeats(input: { data, sampleRate }, onProgress?)`. Returns `BeatDetectionResult { bpm, detectedBeats, confidence }`. Energy-based, octave-selected. |
| `lib/audio/clip-utils.ts` | Pure: `lastFiredBeatGuard(currentBeatIndex, lastFiredBeatIndex)` returning `{ shouldFire, nextLastFired }` |
| `lib/audio/beat-detector.worker.ts` | Worker wrapping `detectBeats`, posts `{type:'progress', value}` and `{type:'result', payload}` |
| `lib/audio/waveform-worker.ts` | Worker: downsample channel data to min/max peaks per pixel column |
| `lib/audio/worker-factory.ts` | `createBeatWorker()` + `createWaveformWorker()` — Next.js Webpack-compatible worker instantiation. Injectable into engine for tests. |
| `lib/audio/engine.ts` | `createAudioEngine()` factory + `getAudioEngine()` singleton. Owns AudioContext + audio element + cached decoded AudioBuffer. |
| `lib/store/audio-slice.ts` | Zustand slice exposing `audio.grid` + actions |
| `lib/store/types.ts` (modify) | Compose `AudioState` + `AudioActions` into `AppState` |
| `lib/store/index.ts` (modify) | Add slice; extend `partialize` with `audio.grid` |
| `tests/unit/audio/grid.test.ts` | Test `timeToBeats`, `beatPhase`, 40 ms window, double-fire guard |
| `tests/unit/audio/beat-detector.test.ts` | Test at 90 / 120 / 128 BPM synthetic click tracks (±2 BPM tolerance) |
| `tests/unit/audio/clip-utils.test.ts` | `lastFiredBeatGuard` |
| `tests/unit/audio/engine.test.ts` | Engine lifecycle: load → play (awaits `context.resume()`) → pause → seek → destroy. AudioContext mocked. |
| `tests/unit/store/audio-slice.test.ts` | Slice wiring + persistence-exclusion of status/currentTime |
| `tests/unit/audio/_helpers.ts` | `createSyntheticClickTrack(bpm, bars)` returning `{ data: Float32Array, sampleRate: 44100 }` |
| `vitest.setup.ts` (modify) | Add AudioContext mock used by engine.test.ts |

---

## Conventions

- **Pure functions take POJOs, never WebAudio types.** `detectBeats({ data: Float32Array, sampleRate })` — not `AudioBuffer`. The worker translates `AudioBuffer.getChannelData(0)` to `Float32Array` once at the boundary. This makes the pure code work in jsdom without AudioBuffer polyfills.
- **BPM clamp**: detection output clamped to `[60, 200]` (Spec §5.2). Outside that range the result is rejected (`confidence: 0`).
- **Octave selection**: after onset-interval histogram, pick the candidate BPM nearest the median; if a value <60 looks dominant, double it; if >200, halve. Documented inline in `beat-detector.ts`.
- **Beat tolerance in tests**: synthetic click tracks at 90/120/128 BPM. Spec §11.3 says ±2 BPM. Use `toBeCloseTo(expected, 0)` is wrong (that rounds); use `expect(Math.abs(bpm - expected)).toBeLessThanOrEqual(2)`.
- **Engine.play() contract**: `await audioContext.resume()` before `audioElement.play()`. If context stays `suspended` (autoplay blocked), set `status='error'` and reject. The test asserts the `resume()` call order via mock spies.

---

## Task 0: Test helpers — synthetic click track + AudioContext mock

**Files:**

- Create: `tests/unit/audio/_helpers.ts`
- Modify: `vitest.setup.ts`

> jsdom does not provide `AudioContext`, `AudioBuffer`, or `Worker`. The pure detector tests get a POJO `{ data, sampleRate }`. The engine tests need a mocked `AudioContext` with `resume()`, `createMediaElementSource()`, `createAnalyser()`, `createMediaStreamDestination()`, `destination`, `state`, `close()`. The mock lives in `vitest.setup.ts` so it's installed for every test, BUT engine tests override specific methods per test via `vi.spyOn`.

- [ ] **Step 1: Write the audio test helpers**

`tests/unit/audio/_helpers.ts`:

```ts
export interface AudioInput {
  data: Float32Array;
  sampleRate: number;
}

/**
 * Build a synthetic click track at a known BPM.
 * Each beat is a single-sample impulse (value = 1.0). Total length is `bars * 4` beats.
 * Matches the spec §11.3 helper but returns a POJO instead of an AudioBuffer.
 */
export function createSyntheticClickTrack(bpm: number, bars: number, sampleRate = 44100): AudioInput {
  const beatInterval = (60 / bpm) * sampleRate;
  const totalBeats = bars * 4;
  const totalSamples = Math.ceil(beatInterval * totalBeats);
  const data = new Float32Array(totalSamples);
  for (let beat = 0; beat < totalBeats; beat++) {
    const pos = Math.round(beat * beatInterval);
    if (pos < totalSamples) data[pos] = 1.0;
  }
  return { data, sampleRate };
}

/**
 * Add a short decay envelope around each impulse so the detector's
 * energy windowing has something to integrate. Useful for harder tests.
 */
export function createDecayingClickTrack(
  bpm: number,
  bars: number,
  decaySamples = 200,
  sampleRate = 44100
): AudioInput {
  const base = createSyntheticClickTrack(bpm, bars, sampleRate);
  const out = new Float32Array(base.data.length);
  for (let i = 0; i < base.data.length; i++) {
    if (base.data[i] > 0) {
      for (let d = 0; d < decaySamples && i + d < out.length; d++) {
        out[i + d] += Math.exp(-d / (decaySamples / 4));
      }
    }
  }
  return { data: out, sampleRate };
}
```

- [ ] **Step 2: Modify `vitest.setup.ts`** — install AudioContext mock

```ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Minimal AudioContext mock for engine tests. Real WebAudio is not available in jsdom.
 * Tests that need to assert specific behavior (e.g. resume order) override these
 * methods per-test via vi.spyOn(audioContext, 'resume').
 */
class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  destination = {} as AudioDestinationNode;
  currentTime = 0;

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createMediaElementSource(_el: HTMLMediaElement): { connect: () => void; disconnect: () => void } {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  createAnalyser(): {
    fftSize: number;
    smoothingTimeConstant: number;
    connect: () => void;
    disconnect: () => void;
    getByteFrequencyData: (a: Uint8Array) => void;
  } {
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
  }

  createMediaStreamDestination(): { stream: MediaStream; connect: () => void; disconnect: () => void } {
    return {
      stream: { id: 'mock-stream' } as MediaStream,
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }

  /**
   * Real WebAudio decodeAudioData accepts an ArrayBuffer. The mock returns a
   * minimal AudioBuffer-like object — tests that care about decoded content
   * override this via vi.spyOn(ctxProto, 'decodeAudioData').
   */
  async decodeAudioData(_buf: ArrayBuffer): Promise<AudioBuffer> {
    return {
      sampleRate: 44100,
      length: 0,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0)
    } as unknown as AudioBuffer;
  }
}

// @ts-expect-error — assigning to globalThis for the test environment only.
globalThis.AudioContext = MockAudioContext;
// @ts-expect-error — Webkit alias used by some libs; keep for parity.
globalThis.webkitAudioContext = MockAudioContext;
```

- [ ] **Step 3: Run existing tests — confirm nothing regressed**

```
npm test
```

Expected: all 58 prior tests still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/audio/_helpers.ts vitest.setup.ts
git commit -m "test(audio): synthetic click track helpers + AudioContext mock"
```

---

## Task 1: Audio types

**Files:**

- Create: `lib/audio/types.ts`

> Restate the spec §5 types verbatim, plus the detector result shape.

- [ ] **Step 1: Write `lib/audio/types.ts`**

```ts
export type BeatSource = 'manual' | 'detected';

export interface BeatGrid {
  bpm: number;
  source: BeatSource;
  beatsPerBar: number;
  offsetMs: number;
  detectedBeats?: number[]; // seconds
}

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

export interface AudioEngineState {
  status: AudioStatus;
  duration: number; // seconds
  currentTime: number; // seconds
  beatGrid: BeatGrid;
}

export interface BeatDetectionResult {
  bpm: number;
  detectedBeats: number[]; // seconds
  confidence: number; // 0..1 — 0 = rejected (out of [60, 200])
}

export interface BeatPhaseResult {
  beatIndex: number;
  phase: number; // 0..1 between consecutive beats
  isOnBeat: boolean; // within ±40 ms window
}

/** Sane defaults for a new project. */
export const DEFAULT_BEAT_GRID: BeatGrid = {
  bpm: 120,
  source: 'manual',
  beatsPerBar: 4,
  offsetMs: 0
};
```

- [ ] **Step 2: Verify typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/audio/types.ts
git commit -m "feat(audio): types (BeatGrid, AudioStatus, BeatDetectionResult, BeatPhaseResult)"
```

---

## Task 2: `timeToBeats` selector

**Files:**

- Create: `lib/audio/grid.ts`
- Create: `tests/unit/audio/grid.test.ts`

> Conversion: `beats = (seconds - offsetMs/1000) * bpm / 60`. Negative results allowed if seconds < offset (helps the Ruler render pre-roll).

- [ ] **Step 1: Write the failing test**

`tests/unit/audio/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { timeToBeats } from '@/lib/audio/grid';
import type { BeatGrid } from '@/lib/audio/types';

const grid120: BeatGrid = { bpm: 120, source: 'manual', beatsPerBar: 4, offsetMs: 0 };

describe('timeToBeats', () => {
  it('returns 0 beats at 0 seconds', () => {
    expect(timeToBeats(0, grid120)).toBe(0);
  });

  it('returns 2 beats at 1 second at 120 BPM', () => {
    expect(timeToBeats(1, grid120)).toBe(2);
  });

  it('honors offsetMs (shift origin)', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 500 };
    expect(timeToBeats(0.5, g)).toBe(0);
    expect(timeToBeats(1.5, g)).toBe(2);
  });

  it('scales with BPM', () => {
    const g60: BeatGrid = { ...grid120, bpm: 60 };
    expect(timeToBeats(2, g60)).toBe(2);
    const g180: BeatGrid = { ...grid120, bpm: 180 };
    expect(timeToBeats(1, g180)).toBe(3);
  });

  it('returns negative beats when seconds < offset (pre-roll)', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 1000 };
    expect(timeToBeats(0.5, g)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

- [ ] **Step 3: Implement**

`lib/audio/grid.ts`:

```ts
import type { BeatGrid } from './types';

export const BEAT_WINDOW_MS = 40; // ±2 frames at 60 fps

export function timeToBeats(seconds: number, grid: BeatGrid): number {
  return ((seconds - grid.offsetMs / 1000) * grid.bpm) / 60;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/audio/grid.ts tests/unit/audio/grid.test.ts
git commit -m "feat(audio): timeToBeats with offsetMs support"
```

---

## Task 3: `beatPhase` + 40 ms `isOnBeat` window

**Files:**

- Modify: `lib/audio/grid.ts`
- Modify: `tests/unit/audio/grid.test.ts`

> `beatPhase(seconds, grid)` returns:
> - `beatIndex` = `Math.floor(timeToBeats(seconds, grid))`
> - `phase` = fractional part of beats (always 0..1)
> - `isOnBeat` = within ±40 ms of the **nearest** beat (which may be `beatIndex` or `beatIndex + 1`)
>
> Crucially: `isOnBeat` here is the geometric check. The **double-fire guard** uses `lastFiredBeatIndex` and lives in `clip-utils.ts` (Task 4) — keeping `beatPhase` referentially transparent.

- [ ] **Step 1: Add failing tests**

```ts
import { beatPhase, BEAT_WINDOW_MS } from '@/lib/audio/grid';

describe('beatPhase', () => {
  it('returns beatIndex=0, phase=0, isOnBeat=true at exact origin', () => {
    expect(beatPhase(0, grid120)).toEqual({ beatIndex: 0, phase: 0, isOnBeat: true });
  });

  it('returns beatIndex=1, phase=0, isOnBeat=true at exact beat boundary', () => {
    // 120 BPM → 0.5 s per beat
    expect(beatPhase(0.5, grid120)).toEqual({ beatIndex: 1, phase: 0, isOnBeat: true });
  });

  it('returns phase ~0.5 mid-beat', () => {
    const r = beatPhase(0.75, grid120); // between beat 1 and beat 2
    expect(r.beatIndex).toBe(1);
    expect(r.phase).toBeCloseTo(0.5, 5);
    expect(r.isOnBeat).toBe(false);
  });

  it('isOnBeat=true within +40 ms of the nearest beat', () => {
    expect(beatPhase(0.500, grid120).isOnBeat).toBe(true);
    expect(beatPhase(0.520, grid120).isOnBeat).toBe(true); // +20 ms
    expect(beatPhase(0.539, grid120).isOnBeat).toBe(true); // +39 ms
    expect(beatPhase(0.541, grid120).isOnBeat).toBe(false); // +41 ms
  });

  it('isOnBeat=true within -40 ms of the nearest beat', () => {
    expect(beatPhase(0.480, grid120).isOnBeat).toBe(true); // -20 ms before beat 1
    expect(beatPhase(0.461, grid120).isOnBeat).toBe(true); // -39 ms
    expect(beatPhase(0.459, grid120).isOnBeat).toBe(false); // -41 ms
  });

  it('rounds toward nearest beat for isOnBeat (not floor)', () => {
    // 0.490s is 10 ms before beat 1 (0.5s) — closest is beat 1, NOT beat 0
    const r = beatPhase(0.49, grid120);
    expect(r.beatIndex).toBe(0); // floor
    expect(r.isOnBeat).toBe(true); // because nearest is beat 1, within 10 ms
  });

  it('honors offsetMs', () => {
    const g: BeatGrid = { ...grid120, offsetMs: 100 };
    // At time = 0.100 s with offset 100ms, this is "beat 0"
    expect(beatPhase(0.1, g).beatIndex).toBe(0);
    expect(beatPhase(0.1, g).isOnBeat).toBe(true);
  });

  it('exports BEAT_WINDOW_MS = 40', () => {
    expect(BEAT_WINDOW_MS).toBe(40);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Append to `lib/audio/grid.ts`:

```ts
import type { BeatPhaseResult } from './types';

export function beatPhase(seconds: number, grid: BeatGrid): BeatPhaseResult {
  const beats = timeToBeats(seconds, grid);
  const beatIndex = Math.floor(beats);
  const phase = beats - beatIndex; // always 0..1 since floor

  // Distance to nearest beat in ms. The nearest is either beatIndex or beatIndex + 1.
  const distToCurrent = phase * (60_000 / grid.bpm); // ms past current beat
  const distToNext = (1 - phase) * (60_000 / grid.bpm); // ms until next beat
  const distMs = Math.min(distToCurrent, distToNext);

  return {
    beatIndex,
    phase,
    isOnBeat: distMs <= BEAT_WINDOW_MS
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/audio/grid.ts tests/unit/audio/grid.test.ts
git commit -m "feat(audio): beatPhase with ±40ms isOnBeat window"
```

---

## Task 4: `lastFiredBeatGuard` (double-fire prevention)

**Files:**

- Create: `lib/audio/clip-utils.ts`
- Create: `tests/unit/audio/clip-utils.test.ts`

> The renderer calls `beatPhase` every frame. Without a guard, an FX would trigger on every frame inside the 40 ms window (~5 frames at 60 fps). The guard takes the current nearest-beat index and the last-fired index and returns `shouldFire: true` only on the first match.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`lib/audio/clip-utils.ts`:

```ts
export interface BeatFireDecision {
  shouldFire: boolean;
  nextLastFired: number;
}

/**
 * Combined with `beatPhase().isOnBeat`, this prevents an FX from firing on every
 * frame inside the 40 ms beat window. Pass `result.nextLastFired` back into the
 * renderer's state on every frame.
 *
 * **Deriving `nearestBeatIndex` (renderer responsibility):** `beatPhase()` returns
 * `beatIndex = Math.floor(beats)` — i.e. the beat the playhead has just passed.
 * The *nearest* beat is either `beatIndex` or `beatIndex + 1` depending on which
 * is closer in time. The renderer must compute it explicitly before calling this
 * guard:
 *
 * ```ts
 * const { beatIndex, phase, isOnBeat } = beatPhase(currentTime, grid);
 * if (!isOnBeat) continue;
 * const nearestBeatIndex = phase > 0.5 ? beatIndex + 1 : beatIndex;
 * const { shouldFire, nextLastFired } = lastFiredBeatGuard(nearestBeatIndex, lastFired);
 * ```
 *
 * Using `beatIndex` directly would mis-fire when the playhead approaches a beat
 * from below — Plan 3 will land this glue in `lib/renderer/loop.ts`.
 *
 * @param nearestBeatIndex   the beat index closest to `currentTime`
 *                           (= beatIndex or beatIndex+1 from beatPhase)
 * @param lastFiredBeatIndex the previously fired beat index, or null on first call
 */
export function lastFiredBeatGuard(
  nearestBeatIndex: number,
  lastFiredBeatIndex: number | null
): BeatFireDecision {
  if (nearestBeatIndex === lastFiredBeatIndex) {
    return { shouldFire: false, nextLastFired: lastFiredBeatIndex };
  }
  return { shouldFire: true, nextLastFired: nearestBeatIndex };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/audio/clip-utils.ts tests/unit/audio/clip-utils.test.ts
git commit -m "feat(audio): lastFiredBeatGuard for double-fire prevention"
```

---

## Task 5: Energy-based beat detector — pure function

**Files:**

- Create: `lib/audio/beat-detector.ts`
- Create: `tests/unit/audio/beat-detector.test.ts`

> Algorithm (energy-based, on-demand):
> 1. Slice `data` into ~10 ms frames (`frameSize = sampleRate * 0.01`).
> 2. Compute per-frame energy = sum of squared samples.
> 3. For each frame, compute local-average energy over a 1 s window.
> 4. Mark an **onset** when `energy > 1.3 × localAverage`.
> 5. Compute the median inter-onset interval (ms). BPM = `60_000 / median`.
> 6. **Octave selection**: if BPM < 60, double; if > 200, halve. Clamp final BPM to `[60, 200]`; otherwise return `confidence: 0`.
> 7. `confidence` = number-of-onsets / expected-onsets-at-this-BPM, clamped to `[0, 1]`.
>
> `onProgress(0..1)` is invoked roughly every 10% of frames processed.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectBeats } from '@/lib/audio/beat-detector';
import { createSyntheticClickTrack, createDecayingClickTrack } from './_helpers';

const TOL = 2; // ±2 BPM per spec §11.3

function bpmCloseTo(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
}

describe('detectBeats — synthetic click tracks', () => {
  it('detects 90 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(90, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 90);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects 120 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(120, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 120);
  });

  it('detects 128 BPM within ±2 BPM', () => {
    const input = createDecayingClickTrack(128, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 128);
  });

  it('emits progress 0..1 monotonically', () => {
    const input = createDecayingClickTrack(120, 16);
    const progress: number[] = [];
    detectBeats(input, (p) => progress.push(p));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(progress[progress.length - 1]).toBeCloseTo(1, 1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('returns confidence 0 on silence', () => {
    const data = new Float32Array(44100 * 5); // 5 s of zeros
    const r = detectBeats({ data, sampleRate: 44100 });
    expect(r.confidence).toBe(0);
  });

  it('rejects out-of-range detections with confidence 0', () => {
    // A very slow track (30 BPM ≈ below clamp; after octave-doubling it should land in range — exercise the doubling path)
    const input = createDecayingClickTrack(45, 16);
    const r = detectBeats(input);
    // 45 doubled = 90 → should land at 90 BPM with non-zero confidence
    bpmCloseTo(r.bpm, 90);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('halves a very fast detection (220 → 110)', () => {
    const input = createDecayingClickTrack(220, 16);
    const r = detectBeats(input);
    bpmCloseTo(r.bpm, 110);
    expect(r.confidence).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`lib/audio/beat-detector.ts`:

```ts
import type { BeatDetectionResult } from './types';

export interface DetectBeatsInput {
  data: Float32Array;
  sampleRate: number;
}

const FRAME_MS = 10;
const ENERGY_THRESHOLD = 1.3;
const LOCAL_WINDOW_S = 1;

/**
 * Energy-based beat detector. Pure function — no WebAudio, no DOM.
 *
 * Workflow:
 * 1. Slice samples into 10ms frames; compute energy per frame.
 * 2. Compute local-average energy over a 1s window per frame.
 * 3. Mark an onset where frame.energy > 1.3 * localAvg.
 * 4. Median inter-onset interval → BPM candidate.
 * 5. Octave-select into [60, 200]; clamp; confidence from onset density.
 */
export function detectBeats(
  input: DetectBeatsInput,
  onProgress?: (progress: number) => void
): BeatDetectionResult {
  const { data, sampleRate } = input;
  const frameSize = Math.round((sampleRate * FRAME_MS) / 1000);
  const localWindowFrames = Math.round((LOCAL_WINDOW_S * 1000) / FRAME_MS);
  const numFrames = Math.floor(data.length / frameSize);

  // Phase 1: per-frame energy.
  const energies = new Float32Array(numFrames);
  const progressStep = Math.max(1, Math.floor(numFrames / 10));
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const s = data[start + i];
      sum += s * s;
    }
    energies[f] = sum;
    if (onProgress && f % progressStep === 0) onProgress(f / numFrames);
  }

  // Phase 2: onset detection.
  const onsetFrames: number[] = [];
  for (let f = 0; f < numFrames; f++) {
    const winStart = Math.max(0, f - Math.floor(localWindowFrames / 2));
    const winEnd = Math.min(numFrames, winStart + localWindowFrames);
    let localSum = 0;
    for (let i = winStart; i < winEnd; i++) localSum += energies[i];
    const localAvg = localSum / (winEnd - winStart);
    if (localAvg > 0 && energies[f] > ENERGY_THRESHOLD * localAvg) {
      onsetFrames.push(f);
    }
  }

  if (onProgress) onProgress(1);

  if (onsetFrames.length < 2) {
    return { bpm: 120, detectedBeats: [], confidence: 0 };
  }

  // Phase 3: intervals → median → BPM.
  const intervalsMs: number[] = [];
  for (let i = 1; i < onsetFrames.length; i++) {
    intervalsMs.push((onsetFrames[i] - onsetFrames[i - 1]) * FRAME_MS);
  }
  intervalsMs.sort((a, b) => a - b);
  const medianMs = intervalsMs[Math.floor(intervalsMs.length / 2)];
  let bpm = 60_000 / medianMs;

  // Phase 4: octave selection.
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  bpm = Math.round(bpm);
  if (bpm < 60 || bpm > 200) {
    return { bpm, detectedBeats: [], confidence: 0 };
  }

  // Phase 5: confidence.
  const expectedOnsets = (data.length / sampleRate) * (bpm / 60);
  const confidence = Math.min(1, onsetFrames.length / expectedOnsets);

  // Detected beats in seconds.
  const detectedBeats = onsetFrames.map((f) => (f * frameSize) / sampleRate);

  return { bpm, detectedBeats, confidence };
}
```

- [ ] **Step 4: Run — expect PASS (the algorithm is heuristic; if a single test fails by a small amount, tune ENERGY_THRESHOLD or window size before changing the test expectations)**

- [ ] **Step 5: Commit**

```bash
git add lib/audio/beat-detector.ts tests/unit/audio/beat-detector.test.ts
git commit -m "feat(audio): energy-based beat detector (pure) with octave selection"
```

---

## Task 6: Beat detector worker

**Files:**

- Create: `lib/audio/beat-detector.worker.ts`

> The worker is a thin shell around `detectBeats`. It accepts a `Float32Array` + `sampleRate` via `postMessage`, runs detection, posts `progress` messages, and finally posts the result.

- [ ] **Step 1: Write the worker**

`lib/audio/beat-detector.worker.ts`:

```ts
/// <reference lib="webworker" />

import { detectBeats } from './beat-detector';
import type { BeatDetectionResult } from './types';

export type BeatWorkerInbound = {
  type: 'detect';
  data: Float32Array;
  sampleRate: number;
};

export type BeatWorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; payload: BeatDetectionResult }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<BeatWorkerInbound>) => {
  if (e.data.type !== 'detect') return;
  try {
    const { data, sampleRate } = e.data;
    const result = detectBeats({ data, sampleRate }, (p) => {
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'progress',
        value: p
      } satisfies BeatWorkerOutbound);
    });
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'result',
      payload: result
    } satisfies BeatWorkerOutbound);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    } satisfies BeatWorkerOutbound);
  }
};

// Make TS happy in a worker module — no exports otherwise required.
export {};
```

- [ ] **Step 2: Verify typecheck** (no test — the worker is exercised indirectly via the engine in Task 9 and the pure detector test in Task 5 already covers correctness)

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/audio/beat-detector.worker.ts
git commit -m "feat(audio): beat detector worker (progress + result + error)"
```

---

## Task 7: Waveform worker

**Files:**

- Create: `lib/audio/waveform-worker.ts`

> Downsample a single channel into `targetCols` (min, max) pairs for the Waveform SVG render. Pure number crunching — no WebAudio.

- [ ] **Step 1: Write the worker**

`lib/audio/waveform-worker.ts`:

```ts
/// <reference lib="webworker" />

export type WaveformWorkerInbound = {
  type: 'downsample';
  data: Float32Array;
  targetCols: number;
};

export type WaveformPeaks = Array<[min: number, max: number]>;

export type WaveformWorkerOutbound =
  | { type: 'peaks'; payload: WaveformPeaks }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WaveformWorkerInbound>) => {
  if (e.data.type !== 'downsample') return;
  try {
    const { data, targetCols } = e.data;
    const samplesPerCol = data.length / targetCols;
    const peaks: WaveformPeaks = [];
    for (let c = 0; c < targetCols; c++) {
      const start = Math.floor(c * samplesPerCol);
      const end = Math.min(data.length, Math.floor((c + 1) * samplesPerCol));
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const s = data[i];
        if (s < min) min = s;
        if (s > max) max = s;
      }
      peaks.push([min, max]);
    }
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'peaks',
      payload: peaks
    } satisfies WaveformWorkerOutbound);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    } satisfies WaveformWorkerOutbound);
  }
};

export {};
```

- [ ] **Step 2: Verify typecheck**

- [ ] **Step 3: Commit**

```bash
git add lib/audio/waveform-worker.ts
git commit -m "feat(audio): waveform downsampling worker (min/max peaks per column)"
```

---

## Task 8: Worker factory + AudioEngine + singleton

**Files:**

- Create: `lib/audio/worker-factory.ts`
- Create: `lib/audio/engine.ts`

> `createAudioEngine()` returns a fresh engine (used by tests). `getAudioEngine()` lazily produces one singleton for the app. The engine owns the AudioContext, an internal `HTMLAudioElement`, the WebAudio graph, AND a cached decoded `AudioBuffer` reused across `detectBPM` calls. State changes are published via `onStateChange`. **No React, no Zustand** — Plan 5 wires it up via a `useAudioEngine` hook.
>
> **Worker instantiation under Next.js 14 (Webpack, NOT Vite):** Workers are created via `new Worker(new URL('./x.worker.ts', import.meta.url))` **without** `{ type: 'module' }` — Next.js Webpack bundles workers as classic scripts. The two factory functions live in `worker-factory.ts` so:
> - The engine consumes them via dependency injection (`deps.createBeatWorker`), keeping the engine pure-TS and trivially mockable in tests.
> - The Webpack bundler sees a literal `new URL(...)` at the call site, which is what triggers worker-chunk emission.

- [ ] **Step 1: Write `lib/audio/worker-factory.ts`**

```ts
/**
 * Worker constructors isolated from the engine so:
 *   1. Engine code stays mockable (engine takes the constructors via deps).
 *   2. Next.js Webpack sees `new URL(...)` at the call site — required for
 *      worker chunk emission to fire.
 *
 * IMPORTANT: do NOT add `{ type: 'module' }` here. Next.js Webpack bundles
 * workers as classic scripts. The Vite-style `{ type: 'module' }` breaks the
 * build under Next.js's webpack worker loader.
 */
export function createBeatWorker(): Worker {
  return new Worker(new URL('./beat-detector.worker.ts', import.meta.url));
}

export function createWaveformWorker(): Worker {
  return new Worker(new URL('./waveform-worker.ts', import.meta.url));
}
```

- [ ] **Step 2: Write `lib/audio/engine.ts`**

```ts
import { isClient } from '@/lib/utils/is-client';
import type { AudioEngineState, AudioStatus, BeatGrid } from './types';
import { DEFAULT_BEAT_GRID } from './types';
import type { BeatWorkerOutbound } from './beat-detector.worker';
import { createBeatWorker as defaultCreateBeatWorker } from './worker-factory';

export interface AudioEngine {
  load(file: File | string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  detectBPM(signal: AbortSignal, onProgress?: (p: number) => void): Promise<BeatGrid>;
  setBPM(bpm: number): void;
  getAnalyser(): AnalyserNode | null;
  getState(): AudioEngineState;
  onStateChange(cb: (s: AudioEngineState) => void): () => void;
  destroy(): void;
}

const BPM_MIN = 60;
const BPM_MAX = 200;

interface EngineDeps {
  /** Override the worker constructor in tests. Defaults to the Webpack-compatible factory. */
  createBeatWorker?: () => Worker;
}

export function createAudioEngine(deps: EngineDeps = {}): AudioEngine {
  if (!isClient()) {
    throw new Error('AudioEngine cannot be created outside the browser');
  }

  const createBeatWorker = deps.createBeatWorker ?? defaultCreateBeatWorker;

  let audioContext: AudioContext | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaElementAudioSourceNode | null = null;
  let streamDest: MediaStreamAudioDestinationNode | null = null;

  /**
   * Cache of the decoded audio buffer from the most recent successful load.
   * Reused across detectBPM calls so we don't re-fetch + re-decode on every
   * "Detect BPM" click. Cleared in destroy().
   */
  let cachedDecodedBuffer: AudioBuffer | null = null;

  /**
   * AbortController for the currently running detectBPM call. The next call
   * aborts the previous one before starting — this avoids a DataCloneError
   * when the previous postMessage transferred the channelData ArrayBuffer
   * (which would otherwise stay detached on the main thread).
   */
  let activeDetectionAbort: AbortController | null = null;

  const listeners = new Set<(s: AudioEngineState) => void>();
  let state: AudioEngineState = {
    status: 'idle',
    duration: 0,
    currentTime: 0,
    beatGrid: { ...DEFAULT_BEAT_GRID }
  };

  function setState(patch: Partial<AudioEngineState>): void {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  }

  function setStatus(status: AudioStatus): void {
    setState({ status });
  }

  function ensureContext(): AudioContext {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    return audioContext;
  }

  function wireGraph(el: HTMLAudioElement): void {
    const ctx = ensureContext();
    sourceNode = ctx.createMediaElementSource(el);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    streamDest = ctx.createMediaStreamDestination();
    sourceNode.connect(analyser);
    analyser.connect(ctx.destination);
    analyser.connect(streamDest);
  }

  return {
    async load(file): Promise<void> {
      setStatus('loading');
      try {
        const url = typeof file === 'string' ? file : URL.createObjectURL(file);
        audioEl = new Audio();
        audioEl.crossOrigin = 'anonymous';
        audioEl.src = url;
        await new Promise<void>((resolve, reject) => {
          if (!audioEl) return reject(new Error('audio element gone'));
          audioEl.addEventListener('loadedmetadata', () => resolve(), { once: true });
          audioEl.addEventListener('error', () => reject(new Error('audio failed to load')), {
            once: true
          });
        });
        wireGraph(audioEl);
        audioEl.addEventListener('timeupdate', () => {
          if (audioEl) setState({ currentTime: audioEl.currentTime });
        });
        audioEl.addEventListener('ended', () => setStatus('ready'));

        // Decode once, cache for detectBPM. Re-fetching from the same URL is
        // either cached by the browser or a network round-trip — both wasteful
        // when the user clicks "Detect BPM" multiple times.
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const ctx = ensureContext();
        cachedDecodedBuffer = await ctx.decodeAudioData(arrayBuffer);

        setState({ duration: audioEl.duration, status: 'ready' });
      } catch (err) {
        cachedDecodedBuffer = null;
        setStatus('error');
        throw err;
      }
    },

    async play(): Promise<void> {
      if (!audioEl || !audioContext) {
        throw new Error('Audio not loaded');
      }
      // Spec §5.1: await context.resume() BEFORE audioElement.play()
      await audioContext.resume();
      if (audioContext.state !== 'running') {
        setStatus('error');
        throw new Error('AudioContext could not resume (autoplay blocked?)');
      }
      await audioEl.play();
      setStatus('playing');
    },

    pause(): void {
      audioEl?.pause();
      setStatus('ready');
    },

    seek(seconds): void {
      if (audioEl) {
        audioEl.currentTime = Math.max(0, seconds);
        setState({ currentTime: audioEl.currentTime });
      }
    },

    async detectBPM(signal, onProgress): Promise<BeatGrid> {
      if (!audioEl || !cachedDecodedBuffer) {
        throw new Error('Audio not loaded');
      }

      // Cancel any in-flight detection so we don't transfer a buffer twice.
      if (activeDetectionAbort) {
        activeDetectionAbort.abort();
      }
      const myAbort = new AbortController();
      activeDetectionAbort = myAbort;

      // Forward the external signal into our internal one — abort() bubbles either way.
      const onExternalAbort = () => myAbort.abort();
      if (signal.aborted) myAbort.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });

      // Always work on a fresh copy of the channel data — the ArrayBuffer is
      // transferred to the worker and would otherwise be detached on the main thread.
      const channelData = cachedDecodedBuffer.getChannelData(0).slice();
      const sampleRate = cachedDecodedBuffer.sampleRate;

      const worker = createBeatWorker();

      return new Promise<BeatGrid>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', onExternalAbort);
          if (activeDetectionAbort === myAbort) activeDetectionAbort = null;
          worker.terminate();
        };

        myAbort.signal.addEventListener(
          'abort',
          () => {
            cleanup();
            reject(new DOMException('Beat detection aborted', 'AbortError'));
          },
          { once: true }
        );

        worker.onmessage = (e: MessageEvent<BeatWorkerOutbound>) => {
          const msg = e.data;
          if (msg.type === 'progress') {
            onProgress?.(msg.value);
          } else if (msg.type === 'result') {
            cleanup();
            const bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, msg.payload.bpm));
            const grid: BeatGrid = {
              bpm,
              source: 'detected',
              beatsPerBar: 4,
              offsetMs: 0,
              detectedBeats: msg.payload.detectedBeats
            };
            setState({ beatGrid: grid });
            resolve(grid);
          } else if (msg.type === 'error') {
            cleanup();
            reject(new Error(msg.message));
          }
        };

        worker.postMessage(
          { type: 'detect', data: channelData, sampleRate },
          [channelData.buffer] // transferable
        );
      });
    },

    setBPM(bpm): void {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
      setState({
        beatGrid: { ...state.beatGrid, bpm: clamped, source: 'manual' }
      });
    },

    getAnalyser(): AnalyserNode | null {
      return analyser;
    },

    getState(): AudioEngineState {
      return state;
    },

    onStateChange(cb): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    destroy(): void {
      activeDetectionAbort?.abort();
      activeDetectionAbort = null;
      audioEl?.pause();
      audioEl?.removeAttribute('src');
      sourceNode?.disconnect();
      analyser?.disconnect();
      streamDest?.disconnect();
      audioContext?.close().catch(() => undefined);
      audioContext = null;
      audioEl = null;
      analyser = null;
      sourceNode = null;
      streamDest = null;
      cachedDecodedBuffer = null;
      listeners.clear();
      state = { status: 'idle', duration: 0, currentTime: 0, beatGrid: { ...DEFAULT_BEAT_GRID } };
    }
  };
}

// Singleton accessor for the app. Created lazily on first call.
let singleton: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!singleton) singleton = createAudioEngine();
  return singleton;
}

/** Reset the singleton — for tests only. */
export function _resetAudioEngineForTests(): void {
  singleton?.destroy();
  singleton = null;
}
```

- [ ] **Step 3: Verify typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Verify build (catches Webpack worker-bundling errors)**

```
npm run build
```

Expected: PASS. Output should list `beat-detector.worker.*.js` and `waveform-worker.*.js` as separate chunks. **If the build fails on worker resolution**: the `import.meta.url` literal in `worker-factory.ts` may need a `/* webpackChunkName: "beat-detector-worker" */` magic comment — surface to Matthias rather than guess.

- [ ] **Step 5: Commit**

```bash
git add lib/audio/worker-factory.ts lib/audio/engine.ts
git commit -m "feat(audio): worker factory + AudioEngine (cached AudioBuffer, double-call guarded)"
```

---

## Task 9: AudioEngine tests — lifecycle + resume order

**Files:**

- Create: `tests/unit/audio/engine.test.ts`

> These tests rely on the AudioContext mock from Task 0. `<audio>` element is jsdom-native (works without polyfill, but `loadedmetadata` does not fire — we patch by manually dispatching it in the test).

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';

function patchAudio() {
  // jsdom HTMLAudioElement does NOT fire loadedmetadata. Patch the prototype
  // so engine.load() resolves once we set src.
  const origSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    set(value: string) {
      origSrc?.set?.call(this, value);
      // Schedule loadedmetadata on the next tick.
      queueMicrotask(() => {
        Object.defineProperty(this, 'duration', { value: 60, configurable: true });
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    },
    get() {
      return origSrc?.get?.call(this);
    }
  });
  return () => {
    if (origSrc) Object.defineProperty(HTMLMediaElement.prototype, 'src', origSrc);
  };
}

/**
 * Stub global.fetch + AudioContext.decodeAudioData. After the corrections to
 * engine.load() (it now caches a decoded AudioBuffer), the test fixtures must
 * supply both, or load() throws and every downstream test fails.
 */
function patchFetchAndDecode() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8)
  } as Response);

  const ctxProto = (
    globalThis as unknown as { AudioContext: { prototype: AudioContext } }
  ).AudioContext.prototype;
  const decodeSpy = vi
    .spyOn(ctxProto, 'decodeAudioData')
    .mockResolvedValue({
      sampleRate: 44100,
      length: 1,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(1)
    } as unknown as AudioBuffer);

  return () => {
    fetchSpy.mockRestore();
    decodeSpy.mockRestore();
  };
}

describe('AudioEngine lifecycle', () => {
  let restoreAudio: () => void;
  let restoreFetchDecode: () => void;

  beforeEach(() => {
    restoreAudio = patchAudio();
    restoreFetchDecode = patchFetchAndDecode();
  });

  afterEach(() => {
    restoreAudio();
    restoreFetchDecode();
  });

  it('starts in status=idle with default BeatGrid (120 BPM, manual)', () => {
    const engine = createAudioEngine();
    const s = engine.getState();
    expect(s.status).toBe('idle');
    expect(s.beatGrid.bpm).toBe(120);
    expect(s.beatGrid.source).toBe('manual');
    engine.destroy();
  });

  it('load() transitions idle → loading → ready and emits state updates', async () => {
    const engine = createAudioEngine();
    const statuses: string[] = [];
    engine.onStateChange((s) => statuses.push(s.status));
    await engine.load('blob:test');
    const s = engine.getState();
    expect(s.status).toBe('ready');
    expect(s.duration).toBe(60);
    expect(statuses).toContain('loading');
    expect(statuses).toContain('ready');
    engine.destroy();
  });

  it('play() awaits AudioContext.resume() BEFORE audioElement.play() (spec §5.1)', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');

    // Spy on the singleton AudioContext created by the engine.
    const audioCtx = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    const resumeSpy = vi.spyOn(audioCtx, 'resume');

    // Spy on HTMLMediaElement.play
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);

    await engine.play();
    expect(resumeSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    // resume() must complete before play() is invoked
    expect(resumeSpy.mock.invocationCallOrder[0]).toBeLessThan(playSpy.mock.invocationCallOrder[0]);
    engine.destroy();
  });

  it('play() sets status=error if AudioContext fails to resume', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');

    // Force resume() to leave state in 'suspended'.
    const audioCtx = (globalThis as unknown as { AudioContext: { prototype: AudioContext } })
      .AudioContext.prototype;
    vi.spyOn(audioCtx, 'resume').mockImplementation(async function (this: AudioContext) {
      // do not change state — simulate autoplay-blocked
    });

    await expect(engine.play()).rejects.toThrow(/autoplay/);
    expect(engine.getState().status).toBe('error');
    engine.destroy();
  });

  it('pause() returns status to ready', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await engine.play();
    engine.pause();
    expect(engine.getState().status).toBe('ready');
    engine.destroy();
  });

  it('seek() clamps negative input to 0 and updates currentTime', async () => {
    const engine = createAudioEngine();
    await engine.load('blob:test');
    engine.seek(-5);
    expect(engine.getState().currentTime).toBe(0);
    engine.seek(10);
    // jsdom may not echo currentTime back, but our setState path stores it
    expect(engine.getState().currentTime).toBeGreaterThanOrEqual(0);
    engine.destroy();
  });

  it('setBPM clamps to [60, 200] and marks source=manual', () => {
    const engine = createAudioEngine();
    engine.setBPM(45);
    expect(engine.getState().beatGrid.bpm).toBe(60);
    engine.setBPM(250);
    expect(engine.getState().beatGrid.bpm).toBe(200);
    engine.setBPM(140);
    expect(engine.getState().beatGrid.bpm).toBe(140);
    expect(engine.getState().beatGrid.source).toBe('manual');
    engine.destroy();
  });

  it('destroy() returns engine to status=idle and removes listeners', () => {
    const engine = createAudioEngine();
    const cb = vi.fn();
    engine.onStateChange(cb);
    engine.destroy();
    expect(engine.getState().status).toBe('idle');
    cb.mockClear();
    // After destroy, no listener should fire — call setBPM and confirm cb stays uncalled.
    engine.setBPM(150);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```
npm test -- audio
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/audio/engine.test.ts
git commit -m "test(audio): AudioEngine lifecycle (resume order, autoplay-block, clamps)"
```

---

## Task 10: Audio slice for Zustand store

**Files:**

- Create: `lib/store/audio-slice.ts`
- Modify: `lib/store/types.ts`
- Modify: `lib/store/index.ts`
- Create: `tests/unit/store/audio-slice.test.ts`

> Persist only `audio.grid`. Engine status/currentTime are NOT in the store — they are read via `getAudioEngine().getState()` or subscribed via `onStateChange`.

- [ ] **Step 1: Modify `lib/store/types.ts`**

```ts
import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';

export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
}

export interface AudioState {
  grid: BeatGrid;
}

export interface AudioActions {
  setBPM(bpm: number): void;
  setDetectedGrid(grid: BeatGrid): void;
  resetGrid(): void;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
}
```

- [ ] **Step 2: Write the slice**

`lib/store/audio-slice.ts`:

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import { DEFAULT_BEAT_GRID, type BeatGrid } from '@/lib/audio/types';

const BPM_MIN = 60;
const BPM_MAX = 200;

export const initialAudioGrid: BeatGrid = { ...DEFAULT_BEAT_GRID };

export const createAudioSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'audio' | 'audioActions'>
> = (set, get) => ({
  audio: { grid: initialAudioGrid },
  audioActions: {
    setBPM: (bpm) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
      set({
        audio: { grid: { ...get().audio.grid, bpm: clamped, source: 'manual' } }
      });
    },
    setDetectedGrid: (grid) => {
      const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, grid.bpm));
      set({ audio: { grid: { ...grid, bpm: clamped, source: 'detected' } } });
    },
    resetGrid: () => set({ audio: { grid: { ...initialAudioGrid } } })
  }
});
```

- [ ] **Step 3: Modify `lib/store/index.ts`** to compose the new slice

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';
import { createTimelineSlice } from './timeline-slice';
import { createAudioSlice } from './audio-slice';

export const useAppStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } })),
      ...createTimelineSlice(set, get, store),
      ...createAudioSlice(set, get, store)
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ui: state.ui,
        timeline: {
          ...state.timeline,
          playhead: {
            ...state.timeline.playhead,
            playing: false
          }
        },
        audio: state.audio
      })
    }
  )
);
```

- [ ] **Step 4: Write the slice test**

`tests/unit/store/audio-slice.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialAudioGrid } from '@/lib/store/audio-slice';

describe('audio store slice', () => {
  beforeEach(() => {
    useAppStore.setState({ audio: { grid: initialAudioGrid } });
  });

  it('exposes initialAudioGrid (120 BPM, manual)', () => {
    expect(useAppStore.getState().audio.grid).toEqual(initialAudioGrid);
  });

  it('setBPM clamps to [60, 200] and sets source=manual', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setBPM(45);
    expect(useAppStore.getState().audio.grid.bpm).toBe(60);
    audioActions.setBPM(250);
    expect(useAppStore.getState().audio.grid.bpm).toBe(200);
    audioActions.setBPM(140);
    expect(useAppStore.getState().audio.grid.bpm).toBe(140);
    expect(useAppStore.getState().audio.grid.source).toBe('manual');
  });

  it('setDetectedGrid stores detected beats and marks source=detected', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setDetectedGrid({
      bpm: 128,
      source: 'manual', // even if caller passes manual, slice forces detected
      beatsPerBar: 4,
      offsetMs: 0,
      detectedBeats: [0.5, 1.0, 1.5, 2.0]
    });
    const g = useAppStore.getState().audio.grid;
    expect(g.bpm).toBe(128);
    expect(g.source).toBe('detected');
    expect(g.detectedBeats).toHaveLength(4);
  });

  it('resetGrid returns to defaults', () => {
    const { audioActions } = useAppStore.getState();
    audioActions.setBPM(140);
    audioActions.resetGrid();
    expect(useAppStore.getState().audio.grid).toEqual(initialAudioGrid);
  });
});
```

- [ ] **Step 5: Run all timeline + audio + store tests**

```
npm test -- audio
npm test -- store
npm test -- timeline
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/store/audio-slice.ts lib/store/types.ts lib/store/index.ts tests/unit/store/audio-slice.test.ts
git commit -m "feat(store): integrate audio slice (BPM clamp, source override on detect)"
```

---

## Task 11: Final verification gate

- [ ] **Step 1: Typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Lint**

```
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Audio tests**

```
npm test -- audio
```

Expected: ≥ 35 tests across grid, beat-detector, clip-utils, engine.

- [ ] **Step 4: Store tests (regression)**

```
npm test -- store
```

Expected: timeline slice tests still pass + audio slice tests pass.

- [ ] **Step 5: Full suite**

```
npm test
```

Expected: every prior test still passes.

- [ ] **Step 6: Production build (catches worker bundling errors)**

```
npm run build
```

Expected: PASS. Workers compiled separately and listed in the output bundle.

---

## Done condition

All 11 tasks committed, all six verification steps green. The audio subsystem is a pure functional core (grid + detector + guard) with two thin Web Workers and an AudioEngine factory. The store gets a persisted `audio.grid` slice. **Plan 3 (Renderer + FX) can start.**

## Decisions resolved during review (2026-05-19)

1. **Detector heuristics** — defaults kept (`ENERGY_THRESHOLD = 1.3`, `LOCAL_WINDOW_S = 1`, `FRAME_MS = 10`). If a synthetic-click test fails by 1–2 BPM, **tune the algorithm** (lower threshold to 1.2, or widen window to 1.5 s). Do **not** relax test tolerance.
2. **Worker creation** — Next.js 14 App Router uses **Webpack**, not Vite. Workers are created via `new Worker(new URL('./x.worker.ts', import.meta.url))` **without** `{ type: 'module' }`. The two factory functions live in `lib/audio/worker-factory.ts` so the engine can inject them in tests and Webpack sees the literal `new URL(...)` at the call site (required for chunk emission). Documented in Task 8.
3. **Decoded `AudioBuffer` is cached** in the engine after `load()` and reused across `detectBPM` calls. Re-fetching on slow connections (1–3 s) is unacceptable UX; ~25 MB memory for a typical ≤5-minute stereo song at 44.1 kHz is acceptable. Buffer is nulled in `destroy()`.
4. **`currentTime` is NOT in the Zustand store.** The UI reads it from `engine.getState()` via a `useSyncExternalStore` hook in Plan 5.
5. **`setDetectedGrid` is opinionated** — it forces `source: 'detected'` regardless of caller input. Prevents accidental mislabeling.
6. **Double-call guard for `detectBPM`** — `activeDetectionAbort` AbortController cancels the previous in-flight detection before transferring the channel-data ArrayBuffer to a new worker. Avoids `DataCloneError` when the user double-clicks "Detect". Documented in Task 8.
7. **`nearestBeatIndex` derivation** — `lastFiredBeatGuard` documents that the renderer (Plan 3) computes `nearestBeatIndex = phase > 0.5 ? beatIndex + 1 : beatIndex` before calling the guard. Falling back to `beatIndex` directly would mis-fire when approaching a beat from below.
