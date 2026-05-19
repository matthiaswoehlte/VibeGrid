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
  getState(): AudioEngineState;
  onStateChange(cb: (s: AudioEngineState) => void): () => void;
  destroy(): void;
}

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
