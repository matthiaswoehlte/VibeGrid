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

  // Plan 5.10: 44×44 px touch targets on Mobile (Apple HIG / Material).
  // `!h-11 !w-11` forces height/width override on the Button's sm variant
  // (h-7 = 28 px) when at or below the mobile breakpoint; md: restores
  // the Desktop sizing exactly. Icon font-size also scales — 28 px button
  // with a 12 px glyph looks fine; 44 px button needs a larger glyph
  // for visual weight.
  const touchTargetClass = '!h-11 !w-11 md:!h-7 md:!w-auto md:!px-2 text-lg md:text-xs';
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="primary"
        size="sm"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={touchTargetClass}
      >
        {playing ? '⏸︎' : '▶︎'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          // Stop = pause + rewind. Without the pause(), audio kept playing
          // even though the playhead jumped to 0 (Bug Plan-5 smoke).
          engine?.pause();
          engine?.seek(0);
          setPlayhead(0);
          useAppStore.setState((s) => ({
            timeline: {
              ...s.timeline,
              playhead: { ...s.timeline.playhead, playing: false }
            }
          }));
        }}
        aria-label="Stop"
        className={touchTargetClass}
      >
        ⏹︎
      </Button>
    </div>
  );
}
