'use client';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import { Clip } from './Clip';

const TRACK_HEIGHT = 32;
const BEAT_PX_BASE = 40;

export function Tracks() {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const clips = useAppStore((s) => s.timeline.clips);
  const zoom = useAppStore((s) => s.ui.zoom);
  const moveClip = useAppStore((s) => s.timelineActions.moveClip);
  const px = BEAT_PX_BASE * zoom;

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind: string; clipId?: string } | undefined;
    if (data?.kind !== 'clip' || !data.clipId) return;
    const clip = clips.find((c) => c.id === data.clipId);
    if (!clip) return;
    const dxBeats = e.delta.x / px;
    moveClip(clip.id, Math.max(0, clip.startBeat + dxBeats));
  };

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="relative flex-1 overflow-x-auto">
        {tracks.map((t) => (
          <div
            key={t.id}
            className="relative border-b border-[var(--border)]"
            style={{ height: TRACK_HEIGHT }}
          >
            {clips
              .filter((c) => c.trackId === t.id)
              .map((c) => (
                <Clip key={c.id} clip={c} />
              ))}
          </div>
        ))}
      </div>
    </DndContext>
  );
}
