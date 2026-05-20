'use client';
import { Transport } from './Transport';
import { BPMBadge } from './BPMBadge';
import { ExportButton } from './ExportButton';
import { RecIndicator } from './RecIndicator';
import { ClearProjectButton } from './ClearProjectButton';
import type { AudioEngine } from '@/lib/audio/engine';

export function TopBar({ engine }: { engine: AudioEngine | null }) {
  return (
    <header className="h-12 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3">
        <Transport engine={engine} />
        <BPMBadge />
      </div>
      <div className="flex items-center gap-2">
        <RecIndicator />
        <ClearProjectButton />
        {/* onStart is a no-op until Task 10 wires the useVideoExporter hook. */}
        <ExportButton onStart={() => undefined} />
      </div>
    </header>
  );
}
