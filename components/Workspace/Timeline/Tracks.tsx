'use client';
import type { DragEvent as ReactDragEvent } from 'react';
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
import type { FxKind as PluginFxKind } from '@/lib/renderer/types';
import type { TrackKind } from '@/lib/timeline/types';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import { Clip } from './Clip';
import { AutomationLane } from './AutomationLane';
import { TrackHeader } from './TrackHeader';
import { AddTrackButton } from './AddTrackButton';

const TRACK_HEIGHT = 32;
const BEAT_PX_BASE = 40;
// Shared with Ruler.tsx and Playhead.tsx — the sticky left column width
// reserved for track-name labels. All horizontal positioning of clips/ticks
// happens to the RIGHT of this column.
export const TRACK_LABEL_WIDTH = 80;

// PluginFxKind (PascalCase, used by FxPlugin.kind) → TrackKind (slice key).
// Mirrors the same map in lib/renderer/loop.ts — kept local to avoid an
// import cycle through the renderer.
const PLUGIN_TO_TRACK_KIND: Record<PluginFxKind, TrackKind> = {
  Contour: 'contour',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles',
  ZoomPulse: 'zoom-pulse',
  // Plan 5.8a — new kinds, lowercase TrackKind names match 1:1.
  Text: 'text',
  Dissolve: 'dissolve',
  Sunray: 'sunray'
};

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
      e.dataTransfer.types.includes('application/x-vibegrid-media-video')
    ) {
      e.preventDefault();
    }
  };

  const onNativeDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const fxId = e.dataTransfer.getData('application/x-vibegrid-fx');
    const mediaIdImage = e.dataTransfer.getData('application/x-vibegrid-media-image');
    const mediaIdVideo = e.dataTransfer.getData('application/x-vibegrid-media-video');
    if (!fxId && !mediaIdImage && !mediaIdVideo) return;
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
        const pluginTrackKind = PLUGIN_TO_TRACK_KIND[plugin.kind as PluginFxKind];
        // Use the dropped track when its kind matches the plugin; otherwise
        // fall back to the first track of the plugin's kind. With multi-track
        // this lets the user pick which specific track receives the FX clip.
        const targetTrack =
          droppedTrackId && droppedTrackKind === pluginTrackKind
            ? tracks.find((t) => t.id === droppedTrackId)
            : tracks.find((t) => t.kind === pluginTrackKind);
        if (!targetTrack) {
          toast.error(`No "${pluginTrackKind}" track found for ${plugin.name}`);
          return;
        }
        addClip({
          id: crypto.randomUUID(),
          trackId: targetTrack.id,
          kind: pluginTrackKind,
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
        // Default image-clip length: cover the active audio (most images are
        // "the album art" that stays for the full song). Fallback: 256 beats
        // (~2 min at 120 BPM) when no audio exists yet. User can resize after.
        const state = useAppStore.getState();
        const audio = state.media.mediaRefs.find((m) => m.kind === 'audio' && m.duration);
        const bpm = state.audio.grid.bpm || 120;
        const lengthBeats = audio?.duration
          ? Math.ceil((audio.duration * bpm) / 60)
          : 256;
        addClip({
          id: crypto.randomUUID(),
          trackId: imageTrack.id,
          kind: 'image',
          mediaId: mediaIdImage,
          startBeat,
          lengthBeats,
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
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
        <div
          className="px-2 py-2 border-b border-[var(--border)]"
          style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
        >
          <AddTrackButton />
        </div>
      </div>
    </DndContext>
  );
}
