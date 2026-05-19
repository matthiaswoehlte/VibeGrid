'use client';
import type { AudioEngine } from '@/lib/audio/engine';
// Stub — replaced by Task 21 (Toolbar + Ruler + Tracks + Clip + Playhead).
export function Timeline({ engine: _engine }: { engine: AudioEngine | null }) {
  return <div className="p-3 text-xs text-[var(--text-dim)]">Timeline (Task 21)</div>;
}
