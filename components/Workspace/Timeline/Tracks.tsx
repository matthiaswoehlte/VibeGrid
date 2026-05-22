'use client';
import { type DragEvent as ReactDragEvent } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import type { TrackKind } from '@/lib/timeline/types';
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import { Clip } from './Clip';
import { AutomationLane } from './AutomationLane';
import { TrackHeader } from './TrackHeader';

const TRACK_HEIGHT = 32;
const BEAT_PX_BASE = 40;
// Shared with Ruler.tsx and Playhead.tsx — the sticky left column width
// reserved for track-name labels. All horizontal positioning of clips/ticks
// happens to the RIGHT of this column.
export const TRACK_LABEL_WIDTH = 80;

// Plan 5.9c — local PLUGIN_TO_TRACK_KIND map gone; use the SSOT
// `PLUGIN_KIND_TO_TRACK_KIND` from `@/lib/timeline/plugin-mapping`.
// Drop-routing also switches from "find track of the plugin's
// per-FX kind" to "find an fx track that accepts this clip-kind"
// (via canDropOnTrack), since all FX clips now live on 'fx' tracks.

export function Tracks({ totalBeats }: { totalBeats: number }) {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const clips = useAppStore((s) => s.timeline.clips);
  const zoom = useAppStore((s) => s.ui.zoom);
  // Inline lane preview is shown for the SELECTED clip (when it has any
  // automation curve). The editor modal opens via the Inspector and is
  // independent of inline visibility.
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const moveClip = useAppStore((s) => s.timelineActions.moveClip);
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const getMediaRef = useAppStore((s) => s.mediaActions.getMediaRef);
  const px = BEAT_PX_BASE * zoom;

  // Require 5px of movement before a clip drag activates — without this,
  // every pointerdown starts dnd-kit drag tracking and steals the subsequent
  // click event, so the Inspector never sees a clip-select click.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind: string; clipId?: string } | undefined;
    if (data?.kind !== 'clip' || !data.clipId) return;
    const clip = clips.find((c) => c.id === data.clipId);
    if (!clip) return;
    const dxBeats = e.delta.x / px;
    moveClip(clip.id, Math.max(0, clip.startBeat + dxBeats));
  };

  // Native HTML5 drop target — FxLibrary and MediaLibrary use native draggable
  // (not @dnd-kit), so this lane catches both. We allow the drop by preventing
  // default on dragover; on drop we discriminate by dataTransfer key.
  const onNativeDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (
      e.dataTransfer.types.includes('application/x-vibegrid-fx') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-image') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-video') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-audio')
    ) {
      e.preventDefault();
    }
  };

  const onNativeDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const fxId = e.dataTransfer.getData('application/x-vibegrid-fx');
    const mediaIdImage = e.dataTransfer.getData('application/x-vibegrid-media-image');
    const mediaIdVideo = e.dataTransfer.getData('application/x-vibegrid-media-video');
    const mediaIdAudio = e.dataTransfer.getData('application/x-vibegrid-media-audio');
    if (!fxId && !mediaIdImage && !mediaIdVideo && !mediaIdAudio) return;
    e.preventDefault();

    // Compute startBeat from the actual clip-area under the cursor (not the
    // outer container). This keeps the label column non-droppable and avoids
    // the off-by-LABEL_WIDTH issue when the user drops near a track's left edge.
    const target = e.target as HTMLElement;
    const clipArea = target.closest('[data-track-kind]') as HTMLElement | null;
    if (!clipArea) return;
    const rect = clipArea.getBoundingClientRect();
    const xInArea = e.clientX - rect.left;
    const startBeat = Math.max(0, xInArea / px);

    // Plan 5.9a — multi-track: identify the exact track under the cursor.
    const droppedTrackId = clipArea.getAttribute('data-track-id');
    const droppedTrackKind = clipArea.getAttribute('data-track-kind') as
      | TrackKind
      | null;

    try {
      if (fxId) {
        const plugin = getPlugin(fxId);
        if (!plugin) {
          toast.error(`FX plugin "${fxId}" not registered`);
          return;
        }
        const clipKind = PLUGIN_KIND_TO_TRACK_KIND[plugin.kind as PluginFxKind];
        // Plan 5.9c — drop routes to an 'fx' track. Prefer the lane
        // the user actually dropped on; fall back to the first
        // non-muted fx track. With multiple fx tracks (FX, FX 2, …)
        // this lets users group clips visually.
        // `t.kind` is transitionally widened to `TrackKind | TrackFxKind`
        // (Task 2). After Task 3's v5→v6 migrate runs, runtime values
        // are always in the narrow `TrackKind`; the cast bridges the
        // gap until Task 12 narrows the type back.
        const targetTrack =
          (droppedTrackId && droppedTrackKind === 'fx'
            ? tracks.find((t) => t.id === droppedTrackId && canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted)
            : undefined)
          ?? tracks.find((t) => canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted);
        if (!targetTrack) {
          toast.error(`No fx track available for ${plugin.name}`);
          return;
        }
        addClip({
          id: crypto.randomUUID(),
          trackId: targetTrack.id,
          kind: clipKind,
          fxId,
          startBeat,
          lengthBeats: 4,
          label: plugin.name
        });
        return;
      }

      if (mediaIdImage) {
        const ref = getMediaRef(mediaIdImage);
        if (!ref) {
          toast.error(`Media reference ${mediaIdImage} not found`);
          return;
        }
        // Plan 5.9a — validate media-track-kind match. The drop target must
        // be an image track (could be one of several with multi-track).
        if (droppedTrackKind && !canDropOnTrack('image', droppedTrackKind)) {
          toast.error(
            `Bild kann nicht auf "${droppedTrackKind}"-Track — nur auf Image-Tracks`
          );
          return;
        }
        const imageTrack =
          droppedTrackId
            ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'image')
            : tracks.find((t) => t.kind === 'image');
        if (!imageTrack) {
          toast.error('No image track found');
          return;
        }
        // Default image-clip length: 4 beats (same as FX defaults).
        // Pre-5.9d image clips were auto-stretched to the full audio
        // duration on the assumption "image = album art for the whole
        // song". With Multi-Audio and dynamic image-tracks the assumption
        // doesn't hold — long auto-stretched bars force the user to
        // scroll to the song's end just to shorten them. 4 beats is
        // visible without scrolling at any zoom level; the user resizes
        // outward when they actually want a longer image.
        addClip({
          id: crypto.randomUUID(),
          trackId: imageTrack.id,
          kind: 'image',
          mediaId: mediaIdImage,
          startBeat,
          lengthBeats: 4,
          label: ref.filename
        });
        return;
      }

      if (mediaIdVideo) {
        // Plan-5.9b — video drop.
        const ref = getMediaRef(mediaIdVideo);
        if (!ref) {
          toast.error(`Media reference ${mediaIdVideo} not found`);
          return;
        }
        if (droppedTrackKind && !canDropOnTrack('video', droppedTrackKind)) {
          toast.error(
            `Video kann nicht auf "${droppedTrackKind}"-Track — nur auf Video-Tracks`
          );
          return;
        }
        const videoTrack = droppedTrackId
          ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'video')
          : tracks.find((t) => t.kind === 'video');
        if (!videoTrack) {
          toast.error('No video track found');
          return;
        }
        // Video-clip length matches the source video duration (in beats).
        const bpm = useAppStore.getState().audio.grid.bpm || 120;
        const lengthBeats = ref.duration
          ? Math.max(1, Math.ceil((ref.duration * bpm) / 60))
          : 16;
        addClip({
          id: crypto.randomUUID(),
          trackId: videoTrack.id,
          kind: 'video',
          mediaId: mediaIdVideo,
          startBeat,
          lengthBeats,
          label: ref.filename
        });
        return;
      }

      if (mediaIdAudio) {
        // Plan 5.9d — audio drop. Mirrors the video block: pick the
        // dropped audio track (or fall back to the first one), length
        // matches the source audio duration in beats.
        const ref = getMediaRef(mediaIdAudio);
        if (!ref) {
          toast.error(`Media reference ${mediaIdAudio} not found`);
          return;
        }
        if (droppedTrackKind && !canDropOnTrack('audio', droppedTrackKind)) {
          toast.error(
            `Audio kann nicht auf "${droppedTrackKind}"-Track — nur auf Audio-Tracks`
          );
          return;
        }
        const audioTrack = droppedTrackId
          ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'audio')
          : tracks.find((t) => t.kind === 'audio');
        if (!audioTrack) {
          toast.error('No audio track found');
          return;
        }
        const bpm = useAppStore.getState().audio.grid.bpm || 120;
        const lengthBeats = ref.duration
          ? Math.max(1, Math.ceil((ref.duration * bpm) / 60))
          : 16;
        addClip({
          id: crypto.randomUUID(),
          trackId: audioTrack.id,
          kind: 'audio',
          mediaId: mediaIdAudio,
          startBeat,
          lengthBeats,
          label: ref.filename
        });
      }
    } catch (err) {
      // ops.addClip throws OperationError on OVERLAP — surface that explicitly
      // so the user knows WHY the drop did nothing.
      const msg = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Drop failed: ${msg}`);
      // eslint-disable-next-line no-console
      console.warn('[Tracks] addClip failed:', err);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={onDragEnd}
      // dnd-kit's built-in auto-scroll, configured explicitly.
      //
      // Root cause behind the earlier "no auto-scroll" symptom: the
      // Clip component used to render with `left: startBeat*px +
      // transform.x` and a CSS transform of only `translate3d(0,
      // transform.y, 0)`. dnd-kit's auto-scroll measures the dragged
      // element's CSS transform to decide whether it's near the
      // edge AND to compensate for layout shifts during scroll.
      // With `transform.x` always 0 on the element, dnd-kit
      // (a) couldn't detect edge-proximity → no scroll fired,
      // (b) couldn't compensate during scroll → if the scroll DID
      //     fire (via other means), the clip drifted off the cursor.
      //
      // After moving the drag offset into the CSS transform (both
      // axes), dnd-kit's built-in auto-scroll works as advertised.
      //
      // - threshold 0.25 on x: trigger zone is the leftmost / rightmost
      //   25% of the container width. Generous so users feel the scroll
      //   engage well before they hit the viewport edge.
      // - threshold 0 on y: timeline is short vertically, no need.
      // - layoutShiftCompensation: true: keep the clip glued to the
      //   cursor as the container scrolls.
      autoScroll={{
        enabled: true,
        threshold: { x: 0.25, y: 0 },
        acceleration: 10,
        layoutShiftCompensation: true
      }}
    >
      <div onDragOver={onNativeDragOver} onDrop={onNativeDrop}>
        {tracks.map((t) => {
          // Show the read-only inline lane under the selected clip's track
          // row whenever that clip has at least one automation curve. The
          // AutomationLane itself filters params and returns null when no
          // sliders are automated, so we don't double-check here.
          const expandedClip = selectedClipId
            ? clips.find((c) => c.trackId === t.id && c.id === selectedClipId)
            : undefined;
          return (
            <div key={t.id}>
              <div
                className="flex border-b border-[var(--border)]"
                style={{ height: TRACK_HEIGHT, width: TRACK_LABEL_WIDTH + totalBeats * px }}
              >
                <TrackHeader track={t} width={TRACK_LABEL_WIDTH} />
                <div
                  className="relative shrink-0"
                  style={{ width: totalBeats * px }}
                  data-track-id={t.id}
                  data-track-kind={t.kind}
                >
                  {clips
                    .filter((c) => c.trackId === t.id)
                    .map((c) => (
                      <Clip key={c.id} clip={c} />
                    ))}
                </div>
              </div>
              {expandedClip && (
                <div
                  className="relative border-b border-[var(--border)]"
                  style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
                >
                  {/* Height is intentionally not fixed — the lane auto-grows
                      for N automated params (Sweep has two: speed + radius). */}
                  <AutomationLane clipId={expandedClip.id} pxPerBeat={px} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
