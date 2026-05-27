'use client';
import { useEffect, useState } from 'react';
import {
  qualityManager,
  type QualityState
} from '@/lib/renderer/webgl/quality';

const LS_KEY = 'vg_quality_pinned';

/**
 * Plan 8f.1 — visualises the WebGL2 auto-scaling state and exposes the
 * "Pin to Maximum" toggle. Sits in `WorkspaceHeader` next to the BPM badge.
 *
 * Reads `qualityManager.getState()` via a 1s polling effect (the manager
 * is a singleton outside Zustand; we don't subscribe with selectors).
 * The Pin toggle additionally flips the local UI state synchronously
 * so the icon reflects the click without waiting for the next poll tick.
 *
 * Persistence: `localStorage` only — kein STORE_VERSION-Bump, kein
 * cross-component subscribe. The pin survives reloads on the same device.
 *
 * Hidden when WebGL is unavailable (tier='low' + webgl2=false): the
 * indicator is meaningless without WebGL FX on the timeline. We always
 * render in the WorkspaceHeader and hide via opacity so layout stability
 * is preserved across the WebGL-on/off transition.
 */
export function QualityIndicator() {
  // SSR-Hydration: the server has no `OffscreenCanvas`, so
  // `qualityManager.getState()` returns `tier='low' / FPS=60 / scale=1.0`.
  // The client (after hydration) detects the real GPU and returns e.g.
  // `tier='high'`. Rendering text from `getState()` directly during the
  // initial pass causes a hydration text mismatch. Defer to post-mount:
  // first render returns `null` (SSR + initial client are identical),
  // then `useEffect` populates the state and triggers the real render.
  const [state, setState] = useState<QualityState | null>(null);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const pinned = localStorage.getItem(LS_KEY) === 'true';
      qualityManager.pinToMax(pinned);
    }
    setState(qualityManager.getState());
    const id = setInterval(() => {
      setState(qualityManager.getState());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;

  const togglePin = () => {
    if (!state) return;
    const next = !state.userPinned;
    qualityManager.pinToMax(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, String(next));
    }
    setState(qualityManager.getState());
  };

  const scaleColor =
    state.scale === 1.0
      ? 'bg-green-400'
      : state.scale === 0.75
        ? 'bg-orange-400'
        : 'bg-red-400';

  const tierLabel = state.tier.toUpperCase();

  return (
    <div className="flex items-center gap-2 text-[10px] text-[var(--text-dim)] font-mono">
      <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text)] tracking-wider">
        {tierLabel}
      </span>
      <span className={`w-1.5 h-1.5 rounded-full ${scaleColor}`} />
      <span title={`Avg FPS over last 30 frames`}>{state.avgFps} FPS</span>
      <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text)]">
        {state.scale}×
      </span>
      <button
        type="button"
        onClick={togglePin}
        title={
          state.userPinned
            ? 'Quality pinned to maximum — click to unpin'
            : 'Pin quality to maximum (disables auto-scaling)'
        }
        className={`px-1.5 py-0.5 rounded transition-colors ${
          state.userPinned
            ? 'bg-[var(--a1)] text-white'
            : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-dim)]'
        }`}
      >
        📌 {state.userPinned ? 'Pinned' : 'Pin Max'}
      </button>
    </div>
  );
}
