'use client';
import type { PreloadState } from '@/lib/renderer/types';

export function PreloadIndicator({ state }: { state: PreloadState }) {
  if (state === 'idle' || state === 'ready') return null;
  if (state === 'error') {
    return (
      <span className="text-xs text-red-400" aria-label="Preload error">
        ⚠ preload error
      </span>
    );
  }
  // loading
  return (
    <span
      role="status"
      aria-label="Preloading"
      className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--a1)] animate-pulse" />
      preloading…
    </span>
  );
}
