'use client';
import type { AudioEngine } from '@/lib/audio/engine';
// Stub — replaced by Task 14 with ErrorBoundary + CanvasView.
export function Stage({ engine: _engine }: { engine: AudioEngine | null }) {
  return <div className="h-full w-full grid place-items-center text-xs text-[var(--text-dim)]">Stage (Task 14)</div>;
}
