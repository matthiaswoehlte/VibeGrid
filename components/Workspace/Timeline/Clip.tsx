'use client';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import type { Clip as ClipT, TrackKind } from '@/lib/timeline/types';

const BEAT_PX_BASE = 40;

// Per-TrackKind accent. Aligns with plugin defaults where possible
// (sweep uses --a1 purple, particles uses --a3 teal). Image gets blue,
// pulse + contour get distinct hues so all five lanes read at a glance.
const KIND_COLOR: Record<TrackKind, string> = {
  image: '#5a8fff',     // blue (matches --a2)
  contour: '#a86bff',   // purple (matches --a1)
  sweep: '#ff6b9d',     // pink
  particles: '#2ee0d0', // teal (matches --a3)
  pulse: '#ffd166'      // amber
};

export function Clip({ clip }: { clip: ClipT }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  const selected = useAppStore((s) => s.ui.selectedClipId === clip.id);
  const setSelected = useAppStore((s) => s.setSelectedClipId);
  const resizeClip = useAppStore((s) => s.timelineActions.resizeClip);

  const { setNodeRef, listeners, attributes, transform } = useDraggable({
    id: clip.id,
    data: { kind: 'clip', clipId: clip.id }
  });

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startLen = clip.lengthBeats;
    const move = (ev: PointerEvent) => {
      const dxBeats = (ev.clientX - startX) / px;
      const next = Math.max(0.25, startLen + dxBeats);
      resizeClip(clip.id, next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const color = KIND_COLOR[clip.kind];
  // 33 / 66 hex suffix = ~20% / ~40% alpha — translucent fills layered over
  // the dark surface read as glowing washes instead of solid blocks.
  const bgAlpha = selected ? '66' : '33';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setSelected(clip.id)}
      style={{
        left: clip.startBeat * px + (transform?.x ?? 0),
        width: clip.lengthBeats * px,
        transform: transform ? `translate3d(0,${transform.y}px,0)` : undefined,
        backgroundColor: `${color}${bgAlpha}`,
        borderLeft: `3px solid ${color}`,
        boxShadow: selected
          ? `inset 0 0 0 1px ${color}, 0 0 12px ${color}66`
          : `inset 0 0 0 1px ${color}55`
      }}
      className="absolute top-1 bottom-1 rounded text-xs px-1.5 cursor-grab active:cursor-grabbing overflow-hidden"
    >
      <span
        className="block truncate font-medium text-white/90"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}
      >
        {clip.label}
      </span>
      <div
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40"
        aria-label="Resize clip"
      />
    </div>
  );
}
