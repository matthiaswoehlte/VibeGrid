'use client';
import { useRef } from 'react';
import { useRenderer } from '@/lib/hooks/useRenderer';
import type { AudioEngine } from '@/lib/audio/engine';

export function CanvasView({ engine }: { engine: AudioEngine | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRenderer({
    canvasRef: ref,
    getCurrentTime: () => engine?.getState().currentTime ?? 0
  });
  return (
    <canvas
      ref={ref}
      className="block w-full h-full bg-black"
      style={{ aspectRatio: '16/9' }}
    />
  );
}
