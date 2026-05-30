import { isClient } from '@/lib/utils/is-client';
import type { AudioEngineState, AudioStatus, BeatGrid } from './types';
import { BPM_MAX, BPM_MIN, DEFAULT_BEAT_GRID } from './types';
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
  getAudioStream(): MediaStream | null;
  getAudioElement(): HTMLAudioElement | null;
  /** Plan-6-R: the cached AudioBuffer from the most recent successful load
   *  (already used internally for BPM detection). Returned as-is so the
   *  offline render pipeline can chunk it without re-decoding. */
  getDecodedBuffer(): AudioBuffer | null;
  getState(): AudioEngineState;
  onStateChange(cb: (s: AudioEngineState) => void): () => void;
  destroy(): void;

  /** Plan 5.9d — per-clip audio routing. */
  loadClip(clipId: string, url: string): Promise<void>;
  unloadClip(clipId: string): void;
  /** Start playback. `offsetSec` is the position inside the clip's own
   *  buffer (0 = clip start). `whenSec` is the absolute AudioContext
   *  time when playback begins. Engine clamps to `max(currentTime,
   *  whenSec)` so callers never schedule in the past. */
  playClip(clipId: string, offsetSec: number, whenSec: number): void;
  stopClip(clipId: string): void;
  /** Stop every currently-playing source. Used by the reconciler on
   *  seek (paused or playing); the reconciler then calls `playClip`
   *  for every active clip to restart at the new position. */
  stopAllClips(): void;
  /** Instant volume set. Use for Seek / Stop where instant jumps are
   *  wanted. */
  setClipVolume(clipId: string, volume: number): void;
  /** Per-frame volume ramp. Anchors via `setValueAtTime` first (Web
   *  Audio footgun — without the anchor the ramp starts from t=0 =
   *  silence on the first call), then schedules a linear ramp from
   *  the current value to `volume` at `targetTime`. Sample-accurate,
   *  no zipper noise. */
  rampClipVolume(clipId: string, volume: number, targetTime: number): void;
  /** Returns `audioCtx.currentTime`, or 0 if no context is initialised
   *  yet. Used by the renderer to compute `rampClipVolume` target
   *  times without holding an AudioContext reference. */
  getContextTime(): number;
  /** Returns the list of currently-loaded clip IDs. The
   *  `useAudioEngine` reconciler diffs this against the set of clips
   *  it WANTS loaded to drive `loadClip` / `unloadClip`. */
  getLoadedClipIds(): string[];
}

interface EngineDeps {
  /** Override the worker constructor in tests. Defaults to the Webpack-compatible factory. */
  createBeatWorker?: () => Worker;
}

/** Fallback-clock tick cadence (ms). ~60 fps, comparable to `audioEl`'s
 *  `timeupdate`. Exported so tests drive the clock at the exact interval. */
export const FALLBACK_CLOCK_INTERVAL_MS = 16;

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

  // ── Fallback clock state (Plan 9c.2 T2) ────────────────────────────────────
  // Used when there is NO sync-soundtrack `audioEl`. Drives `currentTime`
  // via `setInterval` ticks computed from the AudioContext clock delta so
  // there is zero accumulation drift (each tick recomputes from the anchor).
  //
  // Exactly one of the two paths is active at any time:
  //   (a) audioEl present  → `timeupdate` events drive setState({currentTime})
  //                          (no fallback clock interval is created)
  //   (b) no audioEl       → fallback clock interval drives setState({currentTime})
  //                          (audioEl never used / already null)
  let fallbackTimerId: ReturnType<typeof setInterval> | null = null;
  /** AudioContext.currentTime captured at the moment play() started (or seek() re-anchored). */
  let ctxAnchor = 0;
  /** engine state.currentTime at the moment play() started (or seek() re-anchored). */
  let baseTime = 0;

  /** Start the fallback setInterval clock. Idempotent — no-op if already running. */
  function startFallbackClock(): void {
    if (fallbackTimerId !== null) return;
    // Anchor is set by the caller (play or seek) before calling this.
    fallbackTimerId = setInterval(() => {
      if (!audioContext) return;
      const elapsed = audioContext.currentTime - ctxAnchor;
      const computed = baseTime + elapsed;
      // Upper-bound clamp: when a meaningful duration exists (i.e. > 0,
      // set by load()), clamp to prevent the playhead running past the end.
      // When duration is 0 (no audio loaded, per-clip-only or no-audio),
      // no DOM element defines the end → leave unbounded; the reconciler /
      // Transport owns end-of-playback for that case.
      const clamped =
        state.duration > 0 ? Math.min(computed, state.duration) : computed;
      setState({ currentTime: clamped });
    }, FALLBACK_CLOCK_INTERVAL_MS);
  }

  /** Stop the fallback setInterval clock. Idempotent — no-op if not running. */
  function stopFallbackClock(): void {
    if (fallbackTimerId === null) return;
    clearInterval(fallbackTimerId);
    fallbackTimerId = null;
  }

  /**
   * `currentTime` is the engine's CANONICAL playback position (seconds).
   * It is written by:
   *   (a) the `audioEl` `timeupdate` event (sync-soundtrack path, case a) — unchanged;
   *   (b) `seek()` in both modes: when `audioEl` exists it also moves the audio
   *       element, when it does not it still updates the canonical value directly
   *       AND re-anchors the fallback clock when it is running;
   *   (c) the AudioContext fallback clock (Plan-9c.2 T2) — setInterval ticks
   *       computed as `baseTime + (audioContext.currentTime - ctxAnchor)`.
   *
   * All consumers (useAudioEngine → playhead.beats) receive updates via
   * `onStateChange`, which fires after every `setState` call.
   */
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

  /** Plan 5.9d — per-clip routing state. Each loaded clip has its own
   *  decoded buffer + GainNode (long-lived, used for volume
   *  automation) + current `AudioBufferSourceNode` (one-shot,
   *  replaced on every play/restart per Web Audio's one-shot
   *  source-node contract). */
  const clipBuffers = new Map<string, AudioBuffer>();
  const clipGainNodes = new Map<string, GainNode>();
  const clipSources = new Map<string, AudioBufferSourceNode>();

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
      if (audioEl) {
        // ── Case (a): sync-soundtrack loaded ─────────────────────────────────
        // Stop the fallback clock UP FRONT: when audioEl drives currentTime the
        // fallback must not run, and stopping it before resume()/play() leaves
        // no window where a stale tick races the element's timeupdate.
        stopFallbackClock();
        // AudioContext was created during load() → wireGraph(); ensureContext
        // sets the closure `audioContext` either way.
        const ctx = audioContext ?? ensureContext();
        await ctx.resume();
        if (ctx.state !== 'running') {
          setStatus('error');
          throw new Error('AudioContext could not resume (autoplay blocked?)');
        }
        await audioEl.play();
        setStatus('playing');
      } else {
        // ── Case (b): no sync-soundtrack — AudioContext-based fallback clock ─
        // ensureContext() creates the AudioContext (SUSPENDED state per spec).
        // We must explicitly resume() it so its clock starts advancing.
        // Without resume(), audioContext.currentTime stays at 0 indefinitely
        // and every tick would compute elapsed = 0, so no advance. (B2)
        const ctx = ensureContext();
        await ctx.resume();
        if (ctx.state !== 'running') {
          setStatus('error');
          throw new Error('AudioContext could not resume (autoplay blocked?)');
        }
        // Anchor the fallback clock at the current play position.
        ctxAnchor = ctx.currentTime;
        baseTime = state.currentTime;
        startFallbackClock();
        setStatus('playing');
      }
    },

    pause(): void {
      // Stop the fallback clock BEFORE pausing the audio element so we
      // capture the last ticked currentTime as the hold value.
      stopFallbackClock();
      audioEl?.pause();
      setStatus('ready');
    },

    seek(seconds): void {
      const clamped = Math.max(0, seconds);
      if (audioEl) {
        // Case a: sync-soundtrack loaded — move the audio element (which also
        // drives the `timeupdate` → setState loop) AND update state directly
        // so callers see the new position immediately without waiting for the
        // next timeupdate event.
        audioEl.currentTime = clamped;
        setState({ currentTime: audioEl.currentTime });
      } else {
        // Case b: no sync-soundtrack — update the canonical currentTime.
        // If the fallback clock is running, re-anchor it from the new position
        // so the next tick computes time from here rather than the old anchor.
        setState({ currentTime: clamped });
        if (fallbackTimerId !== null && audioContext) {
          ctxAnchor = audioContext.currentTime;
          baseTime = clamped;
        }
      }
    },

    async detectBPM(signal, onProgress): Promise<BeatGrid> {
      if (!audioEl || !cachedDecodedBuffer) {
        throw new Error('Audio not loaded');
      }

      if (activeDetectionAbort) {
        activeDetectionAbort.abort();
      }
      const myAbort = new AbortController();
      activeDetectionAbort = myAbort;

      const onExternalAbort = () => myAbort.abort();
      if (signal.aborted) myAbort.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });

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
            if (myAbort.signal.aborted) return;
            onProgress?.(msg.value);
          } else if (msg.type === 'result') {
            // Guard the race where abort() fires while the result message
            // is already in flight from the worker — without this, a stale
            // result would clobber the freshly started detection's state.
            if (myAbort.signal.aborted) return;
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
            if (myAbort.signal.aborted) return;
            cleanup();
            reject(new Error(msg.message));
          }
        };

        worker.postMessage(
          { type: 'detect', data: channelData, sampleRate },
          [channelData.buffer]
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

    getAudioStream(): MediaStream | null {
      return streamDest?.stream ?? null;
    },

    getAudioElement(): HTMLAudioElement | null {
      return audioEl;
    },

    getDecodedBuffer(): AudioBuffer | null {
      return cachedDecodedBuffer;
    },

    getState(): AudioEngineState {
      return state;
    },

    onStateChange(cb): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    // ----------------------------------------------------------------
    // Plan 5.9d — multi-clip API.
    // ----------------------------------------------------------------

    async loadClip(clipId, url): Promise<void> {
      if (clipBuffers.has(clipId)) return;
      const ctx = ensureContext();
      const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
      const buf = await ctx.decodeAudioData(arrayBuffer);
      clipBuffers.set(clipId, buf);
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      gain.connect(ctx.destination);
      clipGainNodes.set(clipId, gain);
    },

    unloadClip(clipId): void {
      const src = clipSources.get(clipId);
      if (src) {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
        clipSources.delete(clipId);
      }
      const gain = clipGainNodes.get(clipId);
      if (gain) {
        gain.disconnect();
        clipGainNodes.delete(clipId);
      }
      clipBuffers.delete(clipId);
    },

    playClip(clipId, offsetSec, whenSec): void {
      const buf = clipBuffers.get(clipId);
      const gain = clipGainNodes.get(clipId);
      if (!buf || !gain) return;
      // Replace any in-flight source (Web Audio source nodes are
      // one-shot; restarting at a new position requires a fresh node).
      const prev = clipSources.get(clipId);
      if (prev) {
        try { prev.stop(); } catch { /* already stopped */ }
        prev.disconnect();
      }
      const ctx = ensureContext();
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(gain);
      source.start(Math.max(ctx.currentTime, whenSec), offsetSec);
      clipSources.set(clipId, source);
    },

    stopClip(clipId): void {
      const src = clipSources.get(clipId);
      if (!src) return;
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
      clipSources.delete(clipId);
    },

    stopAllClips(): void {
      // The reconciler restarts clips at the new playhead position via
      // `playClip()`. No per-clip math needed here.
      for (const id of [...clipSources.keys()]) {
        const src = clipSources.get(id);
        if (!src) continue;
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
        clipSources.delete(id);
      }
    },

    setClipVolume(clipId, volume): void {
      const gain = clipGainNodes.get(clipId);
      if (!gain) return;
      gain.gain.value = Math.max(0, Math.min(1, volume));
    },

    rampClipVolume(clipId, volume, targetTime): void {
      const gain = clipGainNodes.get(clipId);
      if (!gain) return;
      const ctx = ensureContext();
      // ANCHOR — `linearRampToValueAtTime` ramps from the previous
      // scheduled event. Without an explicit setValueAtTime first the
      // Web Audio spec ramps from time-zero (effectively from value 0
      // = silence), so the FIRST ramp call after each load fades the
      // clip in from silence. Anchoring to the current value at the
      // current time is idempotent (no jump) and gives the ramp a
      // stable start. Footgun documented in MDN's
      // linearRampToValueAtTime notes.
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(
        Math.max(0, Math.min(1, volume)),
        targetTime
      );
    },

    getContextTime(): number {
      return audioContext?.currentTime ?? 0;
    },

    getLoadedClipIds(): string[] {
      return [...clipBuffers.keys()];
    },

    destroy(): void {
      activeDetectionAbort?.abort();
      activeDetectionAbort = null;
      stopFallbackClock();
      ctxAnchor = 0;
      baseTime = 0;
      audioEl?.pause();
      audioEl?.removeAttribute('src');
      sourceNode?.disconnect();
      analyser?.disconnect();
      streamDest?.disconnect();
      // Plan 5.9d — tear down per-clip state too.
      for (const src of clipSources.values()) {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
      }
      for (const gain of clipGainNodes.values()) gain.disconnect();
      clipSources.clear();
      clipGainNodes.clear();
      clipBuffers.clear();
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
