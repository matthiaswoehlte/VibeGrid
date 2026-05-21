'use client';
import { useEffect } from 'react';
import { useRenderer } from '@/lib/hooks/useRenderer';
import type { AudioEngine } from '@/lib/audio/engine';

export function CanvasView({
  engine,
  canvasRef,
  getBitmapRef
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Plan-6-R: writes the hook's `getBitmap` accessor into this ref so the
   *  TopBar's offline pipeline can read the same ImageBitmap cache. */
  getBitmapRef?: React.MutableRefObject<
    ((mediaId: string) => ImageBitmap | undefined) | null
  >;
}) {
  const { getBitmap } = useRenderer({
    canvasRef,
    getCurrentTime: () => engine?.getState().currentTime ?? 0
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
