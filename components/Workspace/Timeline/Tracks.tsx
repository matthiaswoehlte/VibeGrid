'use client';
import type { DragEvent as ReactDragEvent } from 'react';
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
import { Clip } from './Clip';

const TRACK_HEIGHT = 32;
const BEAT_PX_BASE = 40;

// PluginFxKind (PascalCase, used by FxPlugin.kind) → TrackKind (slice key).
// Mirrors the same map in lib/renderer/loop.ts — kept local to avoid an
// import cycle through the renderer.
const PLUGIN_TO_TRACK_KIND: Record<PluginFxKind, TrackKind> = {
  Contour: 'contour',
  Pulse: 'pulse',
  Sweep: 'sweep',
  Particle: 'particles'
};

export function Tracks() {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const clips = useAppStore((s) => s.timeline.clips);
  const zoom = useAppStore((s) => s.ui.zoom);
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
      e.dataTransfer.types.includes('application/x-vibegrid-media-image')
    ) {
      e.preventDefault();
    }
  };

  const onNativeDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const fxId = e.dataTransfer.getData('application/x-vibegrid-fx');
    const mediaIdImage = e.dataTransfer.getData('application/x-vibegrid-media-image');
    if (!fxId && !mediaIdImage) return;
    e.preventDefault();

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const xInContainer = e.clientX - rect.left + container.scrollLeft;
    const startBeat = Math.max(0, xInContainer / px);

    if (fxId) {
      const plugin = getPlugin(fxId);
      if (!plugin) return;
      const trackKind = PLUGIN_TO_TRACK_KIND[plugin.kind as PluginFxKind];
      const targetTrack = tracks.find((t) => t.kind === trackKind);
      if (!targetTrack) return;
      addClip({
        id: crypto.randomUUID(),
        trackId: targetTrack.id,
        kind: trackKind,
        fxId,
        startBeat,
        lengthBeats: 4,
        label: plugin.name
      });
      return;
    }

    if (mediaIdImage) {
      const ref = getMediaRef(mediaIdImage);
      if (!ref) return;
      const imageTrack = tracks.find((t) => t.kind === 'image');
      if (!imageTrack) return;
      addClip({
        id: crypto.randomUUID(),
        trackId: imageTrack.id,
        kind: 'image',
        mediaId: mediaIdImage,
        startBeat,
        lengthBeats: 16,
        label: ref.filename
      });
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div
        className="relative flex-1 overflow-x-auto"
        onDragOver={onNativeDragOver}
        onDrop={onNativeDrop}
      >
        {tracks.map((t) => (
          <div
            key={t.id}
            data-track-id={t.id}
            data-track-kind={t.kind}
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
