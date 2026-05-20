/// <reference lib="webworker" />
import { downsamplePeaks, type WaveformPeaks } from './peaks';

export type WaveformWorkerInbound = {
  type: 'downsample';
  data: Float32Array;
  targetCols: number;
};

export type { WaveformPeaks };

export type WaveformWorkerOutbound =
  | { type: 'peaks'; payload: WaveformPeaks }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WaveformWorkerInbound>) => {
  if (e.data.type !== 'downsample') return;
  try {
    const payload = downsamplePeaks(e.data.data, e.data.targetCols);
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'peaks',
      payload
    } satisfies WaveformWorkerOutbound);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    } satisfies WaveformWorkerOutbound);
  }
};

export {};
