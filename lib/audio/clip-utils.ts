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
