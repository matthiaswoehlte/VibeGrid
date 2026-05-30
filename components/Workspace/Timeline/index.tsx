'use client';
import { useEffect, useMemo, useRef } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/lib/store';
import { computeTotalBeats } from '@/lib/timeline/total-beats';
import { useTimelinePinchZoom } from '@/lib/hooks/useTimelinePinchZoom';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import { RangeOverlay } from './RangeOverlay';
import type { AudioEngine } from '@/lib/audio/engine';

const BEAT_PX_BASE = 40;

export function Timeline({ engine }: { engine: AudioEngine | null }) {
  const clips = useAppStore((s) => s.timeline.clips);
  // Plan 5.8b — audio clips now contribute their `clip.lengthBeats` like
  // any other clip via computeTotalBeats. Earlier this hook also pulled
  // `mediaRef.duration` from the audio MediaRef (pre-5.9d "global
  // soundtrack" pattern), which left the scroller stuck at the original
  // FILE length even after the user trimmed the on-timeline clip.
  const totalBeats = useMemo(() => computeTotalBeats(clips), [clips]);

  // Reset horizontal scroll when the playhead jumps back to beat 0
  // (triggered by the Stop button via `setPlayhead(0)`, or by any
  // future "rewind to start" interaction). The auto-scroll in
  // Playhead.tsx only kicks in while `playing` is true, so a pure
  // beats-to-0 transition wouldn't otherwise move the viewport.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Plan 5.10 — two-finger pinch on the timeline scroll area adjusts
  // timeline.zoom (Anm 8). Mobile-first; on Desktop with a mouse the
  // hook attaches harmlessly (pinch events don't fire from a mouse).
  useTimelinePinchZoom(scrollRef);
  useEffect(() => {
    let prevBeats = useAppStore.getState().timeline.playhead.beats;
    return useAppStore.subscribe((state) => {
      const beats = state.timeline.playhead.beats;
      if (prevBeats !== 0 && beats === 0 && scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
      prevBeats = beats;
    });
  }, []);

  // Auto-scroll vertically to the bottom when a track is added. The
  // user just clicked "+ Track hinzufügen" and presumably wants to
  // do something with the new track immediately — scrolling down so
  // it's visible spares the manual scroll. Fires on length INCREASE
  // only; removeTrack / reorder keep the current scroll position.
  useEffect(() => {
    let prevTrackCount = useAppStore.getState().timeline.tracks.length;
    return useAppStore.subscribe((state) => {
      const count = state.timeline.tracks.length;
      if (count > prevTrackCount && scrollRef.current) {
        // Defer one rAF so React has flushed the new track row into
        // the DOM — without this, scrollHeight is still the
        // pre-mount value and the scrollTo lands one row short.
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: 'smooth'
            });
          }
        });
      }
      prevTrackCount = count;
    });
  }, []);

  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col">
        <Toolbar />
        {/* Shared horizontal+vertical scroll so Ruler ticks, track clips and
            the Playhead all stay aligned and scroll together. */}
        <div
          ref={scrollRef}
          data-timeline-scroll
          className="flex-1 overflow-auto relative"
        >
          <Ruler totalBeats={totalBeats} engine={engine} />
          <Tracks totalBeats={totalBeats} />
          {/* RangeOverlay sits below the Playhead (z-20 < z-40) and above
              the ruler/track background. pointer-events:none so ctrl-drag
              on the ruler is not intercepted. */}
          <RangeOverlay />
          <Playhead engine={engine} totalBeats={totalBeats} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
