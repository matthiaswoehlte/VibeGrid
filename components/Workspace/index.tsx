'use client';
import { useState } from 'react';
import type { AudioEngine } from '@/lib/audio/engine';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';

export function Workspace({ engine }: { engine: AudioEngine | null }) {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
        <LeftPanel />
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 relative">
          <Stage engine={engine} />
          <button
            type="button"
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="absolute right-2 top-2 lg:hidden h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
          >
            {inspectorOpen ? '›' : '‹'}
          </button>
        </div>
        <div className="h-64 shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)]">
          <Timeline engine={engine} />
        </div>
      </main>
      {inspectorOpen && (
        <aside className="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
          <Inspector />
        </aside>
      )}
    </div>
  );
}
