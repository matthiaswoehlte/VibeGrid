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
