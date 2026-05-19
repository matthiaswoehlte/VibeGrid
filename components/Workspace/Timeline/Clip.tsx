'use client';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import type { Clip as ClipT } from '@/lib/timeline/types';

const BEAT_PX_BASE = 40;

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

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setSelected(clip.id)}
      style={{
        left: clip.startBeat * px + (transform?.x ?? 0),
        width: clip.lengthBeats * px,
        transform: transform ? `translate3d(0,${transform.y}px,0)` : undefined
      }}
      className={`absolute top-1 bottom-1 rounded text-xs px-1 cursor-grab active:cursor-grabbing ${
        selected
          ? 'bg-[var(--a1)] text-white ring-1 ring-white'
          : 'bg-[var(--surface-3)] text-[var(--text)]'
      }`}
    >
      <span className="truncate">{clip.label}</span>
      <div
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20"
        aria-label="Resize clip"
      />
    </div>
  );
}
