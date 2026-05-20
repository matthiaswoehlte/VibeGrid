'use client';
import { useMemo } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/lib/store';
import { computeTotalBeats } from '@/lib/timeline/total-beats';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import type { AudioEngine } from '@/lib/audio/engine';

export function Timeline({ engine }: { engine: AudioEngine | null }) {
  // Dynamic timeline length — single source of truth for Ruler / Tracks /
  // Playhead so all three size their scrollable content identically.
  const clips = useAppStore((s) => s.timeline.clips);
  const audioRefs = useAppStore((s) => s.media.mediaRefs);
  const bpm = useAppStore((s) => s.audio.grid.bpm);
  const totalBeats = useMemo(() => {
    const lastAudio = [...audioRefs].reverse().find((m) => m.kind === 'audio' && m.duration);
    return computeTotalBeats(clips, lastAudio?.duration, bpm);
  }, [clips, audioRefs, bpm]);

  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col">
        <Toolbar />
        {/* Shared horizontal+vertical scroll so Ruler ticks, track clips and
            the Playhead all stay aligned and scroll together. */}
        <div className="flex-1 overflow-auto relative">
          <Ruler totalBeats={totalBeats} />
          <Tracks totalBeats={totalBeats} />
          <Playhead engine={engine} totalBeats={totalBeats} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
