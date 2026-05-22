'use client';
import { useCallback, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useVideoEngine } from '@/lib/hooks/useVideoEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { TabBar } from '@/components/Mobile/TabBar';
import { MediaDrawer } from '@/components/Mobile/MediaDrawer';
import { FXDrawer } from '@/components/Mobile/FXDrawer';
import { InspectorSheet } from '@/components/Mobile/InspectorSheet';

export default function StudioPage() {
  const { engine } = useAudioEngine();
  // Plan 5.9b — VideoEngine lifecycle owns its element pool. The hook
  // lazy-loads referenced videos, syncs play/pause/seek with the
  // playhead, destroys on unmount. We thread the `getElement`
  // accessor through to both the renderer (live preview drawImage)
  // and the offline export (seekAllTo per frame).
  const { getElement: getVideoElement, engine: videoEngine } = useVideoEngine();

  // Canvas ref lives here so both Workspace (renders the Stage) and TopBar
  // (mounts the useVideoExporter hook) can reach the same DOM element.
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Plan-6-R: CanvasView calls useRenderer and stores the bitmap getter
  // in this ref so the TopBar's offline-export pipeline can read from
  // the same ImageBitmap cache instance. The wrapper closure stays stable
  // across renders so TopBar's useMemo deps don't churn.
  const getBitmapRef = useRef<((mediaId: string) => ImageBitmap | undefined) | null>(null);
  const getImageBitmap = useCallback(
    (mediaId: string) => getBitmapRef.current?.(mediaId),
    []
  );

  // Plan 5.10 — DndContext lifted from Tracks.tsx so that sibling Mobile
  // components (InspectorSheet, future drag-from-drawer) can subscribe
  // to drag lifecycle via useDndMonitor. PointerSensor activation
  // distance:5 stays as before (prevents pointerdown from swallowing
  // the click-to-select). Built-in autoScroll disabled — the timeline
  // uses its own manual implementation (see Tracks.tsx startAutoScroll).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  return (
    <DndContext sensors={sensors} autoScroll={false}>
      <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)]">
        <TopBar
          engine={engine}
          canvasRef={canvasRef}
          getImageBitmap={getImageBitmap}
          videoEngine={videoEngine}
        />
        <Workspace
          engine={engine}
          canvasRef={canvasRef}
          getBitmapRef={getBitmapRef}
          getVideoElement={getVideoElement}
        />
        <TabBar />
        {/* Mobile-only drawers. Each component early-returns null on
            Desktop AND when the matching mobileTab is not active, so
            mounting them all unconditionally is safe — only one is
            ever visible at a time. */}
        <MediaDrawer />
        <FXDrawer />
        <InspectorSheet />
      </div>
    </DndContext>
  );
}
