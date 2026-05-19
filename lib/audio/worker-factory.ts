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
