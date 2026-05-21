'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CanvasView } from './CanvasView';
import type { AudioEngine } from '@/lib/audio/engine';

export function Stage({
  engine,
  canvasRef,
  getBitmapRef,
  getVideoElement
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  getBitmapRef?: React.MutableRefObject<
    ((mediaId: string) => ImageBitmap | undefined) | null
  >;
  getVideoElement?: (mediaId: string) => HTMLVideoElement | null;
}) {
  return (
    <ErrorBoundary name="Stage">
      <div className="h-full w-full flex items-center justify-center bg-black">
        <div className="max-w-full max-h-full w-full" style={{ aspectRatio: '16/9' }}>
          <CanvasView
            engine={engine}
            canvasRef={canvasRef}
            getBitmapRef={getBitmapRef}
            getVideoElement={getVideoElement}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}
