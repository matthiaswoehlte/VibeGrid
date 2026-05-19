'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CanvasView } from './CanvasView';
import type { AudioEngine } from '@/lib/audio/engine';

export function Stage({ engine }: { engine: AudioEngine | null }) {
  return (
    <ErrorBoundary name="Stage">
      <div className="h-full w-full flex items-center justify-center bg-black">
        <div className="max-w-full max-h-full w-full" style={{ aspectRatio: '16/9' }}>
          <CanvasView engine={engine} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
