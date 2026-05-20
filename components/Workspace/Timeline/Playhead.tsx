'use client';
import { useAppStore } from '@/lib/store';
import { TRACK_LABEL_WIDTH } from './Tracks';

const BEAT_PX_BASE = 40;

export function Playhead() {
  const beats = useAppStore((s) => s.timeline.playhead.beats);
  const zoom = useAppStore((s) => s.ui.zoom);
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-[var(--a1)] pointer-events-none"
      style={{ left: TRACK_LABEL_WIDTH + beats * BEAT_PX_BASE * zoom }}
    />
  );
}
