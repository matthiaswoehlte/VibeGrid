'use client';
import { useDraggable } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import type { Clip as ClipT, TrackKind } from '@/lib/timeline/types';
import {
  FX_CLIP_COLORS,
  type TrackFxKind
} from '@/lib/timeline/plugin-mapping';
import { dispatchGroupDragStart } from '@/lib/timeline/group-drag-bus';

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
  fx: 'var(--surface-3)',
  // Plan 8d — SceneFlow singleton tracks. Main-Video reuses the video
  // color (semantically same content); Sync-Audio gets a teal accent
  // to differentiate from regular audio tracks at a glance.
  'main-video': '#7a4dff',
  'sync-audio': '#2ee0d0'   // teal (matches --a3)
};

export function Clip({ clip }: { clip: ClipT }) {
  const zoom = useAppStore((s) => s.ui.zoom);
  const px = BEAT_PX_BASE * zoom;
  // Plan 9b — selection is now an array. Per-clip subscription avoids
  // re-rendering all clips when the selection changes via `includes`.
  const selected = useAppStore((s) => s.ui.selectedClipIds.includes(clip.id));
  const selectedCount = useAppStore((s) => s.ui.selectedClipIds.length);
  const selectClips = useAppStore((s) => s.selectClips);
  const addToSelection = useAppStore((s) => s.addToSelection);
  const resizeClip = useAppStore((s) => s.timelineActions.resizeClip);
  // For video/audio clips, the resize handle can't extend the clip past
  // the source media's intrinsic duration — beyond that the renderer
  // (and the audio engine) just clamp on the last frame / silence,
  // which looks like a freeze. Read mediaRefs + bpm here so the closure
  // in `onResizePointerDown` has a stable snapshot. (BPM changes mid-
  // resize are not a real-world concern.)
  const mediaRefs = useAppStore((s) => s.media.mediaRefs);
  const bpm = useAppStore((s) => s.audio.grid.bpm);

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

    // Max length in beats for video/audio clips — the resize handle
    // hard-stops there so users can't accidentally extend a 30s video
    // to 60s of frozen last-frame. Image and FX clips have no source
    // duration and stay unbounded. If the mediaRef hasn't loaded its
    // duration yet (slow upload), maxLengthBeats stays Infinity and
    // the clip behaves as before — better unbounded than blocked.
    let maxLengthBeats = Infinity;
    if ((clip.kind === 'video' || clip.kind === 'audio') && clip.mediaId) {
      const ref = mediaRefs.find((m) => m.id === clip.mediaId);
      if (ref?.duration && bpm > 0) {
        maxLengthBeats = (ref.duration * bpm) / 60;
      }
    }
    const clampLen = (n: number): number =>
      Math.min(maxLengthBeats, Math.max(0.25, n));

    // Auto-scroll while the user resizes near a viewport edge. Uses
    // the cursor's LIVE clientX (updated in `move` below) and a rAF
    // loop that nudges scrollLeft when within EDGE px of either side.
    // Because resize math is CONTENT-coordinate based, scrolling here
    // is safe — the next pointermove recomputes the length against
    // the new scrollLeft, so the resize anchor stays on the cursor.
    let lastClientX = e.clientX;
    const EDGE = 80;
    const STEP = 14;
    const tick = () => {
      if (scrollContainer) {
        const rect = scrollContainer.getBoundingClientRect();
        if (lastClientX < rect.left + EDGE && scrollContainer.scrollLeft > 0) {
          const prev = scrollContainer.scrollLeft;
          scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft - STEP);
          if (scrollContainer.scrollLeft !== prev) {
            // Recompute the resize length against the new scroll, so
            // the visible clip end "catches up" to the cursor while
            // scrolling — without this, you'd have to wiggle the
            // pointer after each scroll step to trigger another resize.
            const newContentX = lastClientX - rect.left + scrollContainer.scrollLeft;
            resizeClip(clip.id, clampLen(startLen + (newContentX - startContentX) / px));
          }
        } else if (lastClientX > rect.right - EDGE) {
          const max = scrollContainer.scrollWidth - scrollContainer.clientWidth;
          if (scrollContainer.scrollLeft < max) {
            const prev = scrollContainer.scrollLeft;
            scrollContainer.scrollLeft = Math.min(max, scrollContainer.scrollLeft + STEP);
            if (scrollContainer.scrollLeft !== prev) {
              const newContentX = lastClientX - rect.left + scrollContainer.scrollLeft;
              resizeClip(clip.id, clampLen(startLen + (newContentX - startContentX) / px));
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    let rafId: number = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => {
      lastClientX = ev.clientX;
      const currentScrollLeft = scrollContainer?.scrollLeft ?? initialScrollLeft;
      const currentContainerLeft =
        scrollContainer?.getBoundingClientRect().left ?? containerLeft;
      const currentContentX = ev.clientX - currentContainerLeft + currentScrollLeft;
      const dxBeats = (currentContentX - startContentX) / px;
      resizeClip(clip.id, clampLen(startLen + dxBeats));
    };
    const up = (ev: PointerEvent) => {
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer was never captured — ok */
      }
      cancelAnimationFrame(rafId);
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
  // Plan 9b — selected clips get a red ring + glow (#ff3b3b). The bg
  // stays FX-coloured so the user still sees clip-kind at a glance;
  // only the ring + outer glow change.
  const SELECTED_RING = '#ff3b3b';

  // Plan 9b — click-to-select. Shift/Ctrl/Meta toggles individual clips
  // in the selection; plain click replaces it. Multi-clip selected ≥2:
  // a plain click on a NON-selected clip replaces; on a selected clip,
  // we keep the selection (so the next drag can group-move).
  const onClickSelect = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selected) {
        // Toggle off — read current ids inline (no stale closure).
        const next = useAppStore
          .getState()
          .ui.selectedClipIds.filter((id) => id !== clip.id);
        selectClips(next);
      } else {
        addToSelection([clip.id]);
      }
      return;
    }
    if (selected && selectedCount > 1) {
      // Plain click on a clip that's already part of a multi-selection:
      // keep the group intact — the user is positioning their cursor for
      // a group-move drag.
      return;
    }
    selectClips([clip.id]);
  };

  // Plan 9b — onPointerDownCapture (Architect Option A): when this clip
  // is part of a multi-selection AND the user initiates a primary-button
  // drag, divert to the group-drag bus and stop propagation BEFORE
  // @dnd-kit's listeners can claim the event for single-clip drag.
  //   - Shift held → 'copy' mode (Phase 6 duplicate)
  //   - else        → 'move' mode (Phase 5 group-move)
  // Lone-selected (1 clip) keeps @dnd-kit's single-drag path so the
  // legacy single-clip ergonomics are preserved.
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!selected) return;
    if (selectedCount < 2 && !e.shiftKey) return;
    const consumed = dispatchGroupDragStart({
      clipId: clip.id,
      mode: e.shiftKey ? 'copy' : 'move',
      pointerEvent: e
    });
    if (consumed) {
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-clip-id={clip.id}
      {...attributes}
      {...listeners}
      onPointerDownCapture={onPointerDownCapture}
      onClick={onClickSelect}
      style={{
        // Plan 5.10-aware: base position via `left` (so the clip is
        // anchored to the right content-X for its startBeat), drag
        // offset via CSS `transform` on BOTH axes. The previous
        // approach (`left + transform.x` for x, transform for y)
        // broke dnd-kit's auto-scroll layout-shift compensation
        // because dnd-kit assumes drag offset is in `transform` and
        // adjusts it during scroll to keep the dragged element
        // glued to the cursor. With the offset split across two
        // properties, dnd-kit's compensation hit the wrong axis.
        left: clip.startBeat * px,
        width: clip.lengthBeats * px,
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0)`
          : undefined,
        backgroundColor: `${color}${bgAlpha}`,
        borderLeft: `3px solid ${color}`,
        boxShadow: selected
          ? `inset 0 0 0 2px ${SELECTED_RING}, 0 0 12px ${SELECTED_RING}66`
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
