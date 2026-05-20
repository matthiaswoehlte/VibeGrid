'use client';
import { useMemo } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/lib/store';
import { computeTotalBeats } from '@/lib/timeline/total-beats';
import { useWaveformPeaks } from '@/lib/hooks/useWaveformPeaks';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import { Waveform } from './Waveform';
import type { AudioEngine } from '@/lib/audio/engine';

const BEAT_PX_BASE = 40;
const TRACK_LABEL_WIDTH = 80;

export function Timeline({ engine }: { engine: AudioEngine | null }) {
  const clips = useAppStore((s) => s.timeline.clips);
  const audioRefs = useAppStore((s) => s.media.mediaRefs);
  const bpm = useAppStore((s) => s.audio.grid.bpm);
  const zoom = useAppStore((s) => s.ui.zoom);
  const totalBeats = useMemo(() => {
    const lastAudio = [...audioRefs].reverse().find((m) => m.kind === 'audio' && m.duration);
    return computeTotalBeats(clips, lastAudio?.duration, bpm);
  }, [clips, audioRefs, bpm]);

  // First audio ref wins — multi-audio is v0.2.
  const activeAudio = audioRefs.find((m) => m.kind === 'audio' && m.url);
  const pxPerBeat = BEAT_PX_BASE * zoom;
  const { peaks } = useWaveformPeaks({
    mediaId: activeAudio?.id ?? null,
    audioUrl: activeAudio?.url ?? null,
    targetCols: Math.max(64, Math.min(2048, Math.floor(totalBeats * pxPerBeat)))
  });

  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col">
        <Toolbar />
        {/* Shared horizontal+vertical scroll so Ruler ticks, track clips and
            the Playhead all stay aligned and scroll together. */}
        <div className="flex-1 overflow-auto relative">
          <Ruler totalBeats={totalBeats} engine={engine} />
          {peaks && (
            <div
              className="absolute pointer-events-none"
              style={{ left: TRACK_LABEL_WIDTH, top: 24 }}
            >
              <Waveform peaks={peaks} width={totalBeats * pxPerBeat} height={32} />
            </div>
          )}
          <Tracks totalBeats={totalBeats} />
          <Playhead engine={engine} totalBeats={totalBeats} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
