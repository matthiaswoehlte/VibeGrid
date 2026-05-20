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
import { Clip } from './Clip';

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

    // Compute startBeat from the actual clip-area under the cursor (not the
    // outer container). This keeps the label column non-droppable and avoids
    // the off-by-LABEL_WIDTH issue when the user drops near a track's left edge.
    const target = e.target as HTMLElement;
    const clipArea = target.closest('[data-track-kind]') as HTMLElement | null;
    if (!clipArea) return;
    const rect = clipArea.getBoundingClientRect();
    const xInArea = e.clientX - rect.left;
    const startBeat = Math.max(0, xInArea / px);

    try {
      if (fxId) {
        const plugin = getPlugin(fxId);
        if (!plugin) {
          toast.error(`FX plugin "${fxId}" not registered`);
          return;
        }
        const trackKind = PLUGIN_TO_TRACK_KIND[plugin.kind as PluginFxKind];
        const targetTrack = tracks.find((t) => t.kind === trackKind);
        if (!targetTrack) {
          toast.error(`No "${trackKind}" track found for ${plugin.name}`);
          return;
        }
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
        if (!ref) {
          toast.error(`Media reference ${mediaIdImage} not found`);
          return;
        }
        const imageTrack = tracks.find((t) => t.kind === 'image');
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
      <div
        className="relative flex-1 overflow-x-auto"
        onDragOver={onNativeDragOver}
        onDrop={onNativeDrop}
      >
        {tracks.map((t) => (
          <div
            key={t.id}
            className="flex border-b border-[var(--border)]"
            style={{ height: TRACK_HEIGHT }}
          >
            <div
              className="shrink-0 sticky left-0 z-20 bg-[var(--surface-1)] border-r border-[var(--border)] px-2 flex items-center text-[10px] uppercase tracking-wider text-[var(--text-muted)] select-none"
              style={{ width: TRACK_LABEL_WIDTH }}
            >
              {t.name}
            </div>
            <div
              className="relative flex-1"
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
        ))}
      </div>
    </DndContext>
  );
}
