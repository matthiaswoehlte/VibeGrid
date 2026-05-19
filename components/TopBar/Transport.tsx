'use client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import type { AudioEngine } from '@/lib/audio/engine';

export function Transport({ engine }: { engine: AudioEngine | null }) {
  const playing = useAppStore((s) => s.timeline.playhead.playing);
  const setPlayhead = useAppStore((s) => s.timelineActions.setPlayhead);

  const toggle = async () => {
    if (!engine) return;
    if (playing) {
      engine.pause();
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, playhead: { ...s.timeline.playhead, playing: false } }
      }));
    } else {
      await engine.play();
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, playhead: { ...s.timeline.playhead, playing: true } }
      }));
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="primary" size="sm" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸︎' : '▶︎'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          engine?.seek(0);
          setPlayhead(0);
        }}
        aria-label="Stop"
      >
        ⏹︎
      </Button>
    </div>
  );
}
