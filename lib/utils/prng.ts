/**
 * Plan 8e — seeded pseudo-random number generator for FX that need
 * reproducible randomness across renders of the same beat.
 *
 * `mulberry32(seed)` returns a stateful function — each call advances
 * the internal state and returns a value in [0, 1). Given the same
 * seed, the sequence is bit-identical. Used by GlitchSlice to produce
 * stable slice offsets per (seed + beatIndex) tuple, so two viewers of
 * the same project see the same glitch pattern.
 *
 * Algorithm: mulberry32 (Tommy Ettinger, public domain). 32-bit state,
 * ~2^32 period — way more than enough for per-beat randomness.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function (): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
