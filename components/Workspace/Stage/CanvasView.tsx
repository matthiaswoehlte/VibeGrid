'use client';
import { useEffect } from 'react';
import { useRenderer } from '@/lib/hooks/useRenderer';
import type { AudioEngine } from '@/lib/audio/engine';

export function CanvasView({
  engine,
  canvasRef,
  getBitmapRef,
  getVideoElement
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Plan-6-R: writes the hook's `getBitmap` accessor into this ref so the
   *  TopBar's offline pipeline can read the same ImageBitmap cache. */
  getBitmapRef?: React.MutableRefObject<
    ((mediaId: string) => ImageBitmap | undefined) | null
  >;
  /** Plan-5.9b: per-mediaId HTMLVideoElement source for the renderer. */
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}) {
  const { getBitmap } = useRenderer({
    canvasRef,
    getCurrentTime: () => engine?.getState().currentTime ?? 0,
    getVideoElement,
    // Plan 5.9d — forward the engine's per-clip volume API so the
    // renderer can push per-frame ramps to active audio clips.
    rampClipVolume: engine
      ? (clipId, volume, targetTime) => engine.rampClipVolume(clipId, volume, targetTime)
      : undefined,
    getAudioContextTime: engine ? () => engine.getContextTime() : undefined
  });

  useEffect(() => {
    if (!getBitmapRef) return;
    getBitmapRef.current = getBitmap;
    return () => {
      if (getBitmapRef.current === getBitmap) getBitmapRef.current = null;
    };
  }, [getBitmap, getBitmapRef]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full bg-black"
      style={{ aspectRatio: '16/9' }}
    />
  );
}
