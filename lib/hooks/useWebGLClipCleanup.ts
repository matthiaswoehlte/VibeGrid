'use client';
import { useEffect, useRef } from 'react';
import {
  disposeContext,
  disposeAllContexts
} from '@/lib/renderer/webgl/context';

/**
 * Plan 8f.1 — disposes per-clip WebGL2 contexts when their owning clip
 * leaves the timeline. Without this, every removeClip / track-clear
 * leaves the GL context (and its ~32–256 MB GPU memory) hanging until
 * the browser tab closes.
 *
 * Why a React hook diff and not a `lib/store` subscription: the WebGL
 * layer must NOT be imported from `lib/store/timeline-slice` (would
 * invert the layer direction — store is foundational, renderer/webgl
 * is downstream). The hook diffs `clipIds` between renders; React's
 * batching ensures only one diff per store update.
 *
 * Mount point: the Timeline-root component (`components/Workspace/
 * Timeline/Tracks.tsx`). That component already subscribes to
 * `timeline.clips` so it re-renders on every clip lifecycle event.
 *
 * On unmount: all contexts are released (covers HMR + full
 * page-navigation).
 */
export function useWebGLClipCleanup(clipIds: readonly string[]): void {
  const prevRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const curr = new Set(clipIds);
    const prev = prevRef.current;
    for (const id of prev) {
      if (!curr.has(id)) disposeContext(id);
    }
    prevRef.current = curr;
  }, [clipIds]);

  useEffect(() => {
    return () => {
      disposeAllContexts();
    };
  }, []);
}
