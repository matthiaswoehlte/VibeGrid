'use client';
import { useCallback, useRef } from 'react';
import { useAudioEngine } from '@/lib/hooks/useAudioEngine';
import { TopBar } from '@/components/TopBar';
import { Workspace } from '@/components/Workspace';
import { MobileTabBar } from '@/components/Mobile/MobileTabBar';

export default function StudioPage() {
  const { engine } = useAudioEngine();
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
      <TopBar engine={engine} canvasRef={canvasRef} getImageBitmap={getImageBitmap} />
      <Workspace
        engine={engine}
        canvasRef={canvasRef}
        getBitmapRef={getBitmapRef}
      />
      <MobileTabBar />
    </div>
  );
}
