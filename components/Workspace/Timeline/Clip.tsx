'use client';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import type { Clip as ClipT, TrackKind } from '@/lib/timeline/types';
import {
  FX_CLIP_COLORS,
  type TrackFxKind
} from '@/lib/timeline/plugin-mapping';

const BEAT_PX_BASE = 40;

// Media-kind colors stay local to the Timeline UI — they're a UI
// concern, not a renderer/plugin concern. FX clip colors come from
// the SSOT `FX_CLIP_COLORS` in plugin-mapping (extended below at
// lookup time).
const KIND_COLOR: Record<TrackKind, string> = {
  image: '#5a8fff',     // blue (matches --a2)
  audio: '#3a3f55',     // muted blue-grey (stub, never user-visible in v0.1)
  video: '#7a4dff',     // saturated purple — distinct from image (blue)
  // Generic FX track fallback — used when a clip carries an unknown
  // clip-kind (e.g. legacy / future). Specific FX clip-kinds resolve
  // via FX_CLIP_COLORS first.
  fx: 'var(--surface-3)'
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
    const handle = e.currentTarget as HTMLElement;
    // Resolve the timeline's horizontal scroll container so the resize
    // math can compute pointer position in CONTENT coordinates (which
    // are invariant under scrolling). Without this, when the container
    // scrolls during a resize (trackpad two-finger swipe, auto-scroll,
    // or the user scrolling near the viewport edge), `ev.clientX`
    // stays the same in viewport coords while the content shifts —
    // the resize anchor drifts off the cursor and the user perceives
    // a "lost grip" (smoke Bug E).
    const scrollContainer = handle.closest('[data-timeline-scroll]') as HTMLElement | null;
    // Pointer capture binds all pointermove / pointerup events for
    // this pointerId to the handle until release. Without it, the
    // implicit capture can break when the cursor crosses other
    // pointer-event-handling elements (especially during scroll).
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Older browsers — fall back to window listeners below.
    }

    const containerLeft = scrollContainer?.getBoundingClientRect().left ?? 0;
    const initialScrollLeft = scrollContainer?.scrollLeft ?? 0;
    // Cursor position in TIMELINE-CONTENT coordinates at drag start.
    // contentX = (viewport X - container left) + container scrollLeft.
    const startContentX = e.clientX - containerLeft + initialScrollLeft;
    const startLen = clip.lengthBeats;

    const move = (ev: PointerEvent) => {
      const currentScrollLeft = scrollContainer?.scrollLeft ?? initialScrollLeft;
      const currentContainerLeft =
        scrollContainer?.getBoundingClientRect().left ?? containerLeft;
      const currentContentX = ev.clientX - currentContainerLeft + currentScrollLeft;
      const dxBeats = (currentContentX - startContentX) / px;
      const next = Math.max(0.25, startLen + dxBeats);
      resizeClip(clip.id, next);
    };
    const up = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer was never captured — ok */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Resolve color: FX-specific kind first (purple/pink/teal/…), then
  // media-kind fallback, then a neutral surface default.
  const color =
    FX_CLIP_COLORS[clip.kind as TrackFxKind]
    ?? KIND_COLOR[clip.kind as TrackKind]
    ?? 'var(--surface-3)';
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
