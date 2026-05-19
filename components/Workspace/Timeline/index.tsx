'use client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toolbar } from './Toolbar';
import { Ruler } from './Ruler';
import { Tracks } from './Tracks';
import { Playhead } from './Playhead';
import type { AudioEngine } from '@/lib/audio/engine';

export function Timeline({ engine: _engine }: { engine: AudioEngine | null }) {
  return (
    <ErrorBoundary name="Timeline">
      <div className="h-full flex flex-col relative">
        <Toolbar />
        <Ruler />
        <Tracks />
        <Playhead />
      </div>
    </ErrorBoundary>
  );
}
