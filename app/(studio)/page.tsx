'use client';
import { useCallback, useRef } from 'react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { useVideoEngine } from '@/lib/hooks/useVideoEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { MobileTabBar } from '@/components/Mobile/MobileTabBar';

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

  return (
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
      <MobileTabBar />
    </div>
  );
}
