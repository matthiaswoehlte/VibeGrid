'use client';
import { useRenderer } from '@/lib/hooks/useRenderer';
import type { AudioEngine } from '@/lib/audio/engine';

export function CanvasView({
  engine,
  canvasRef
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {
  useRenderer({
    canvasRef,
    getCurrentTime: () => engine?.getState().currentTime ?? 0
  });
  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full bg-black"
      style={{ aspectRatio: '16/9' }}
    />
  );
}
