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

export {};
