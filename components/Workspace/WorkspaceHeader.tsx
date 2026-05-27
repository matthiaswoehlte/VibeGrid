'use client';
import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { PresetPackBrowser } from '@/components/PresetPacks/PresetPackBrowser';
import { QualityIndicator } from './QualityIndicator';

/**
 * Plan 9a — global workspace header. Sits above the LeftPanel/Stage/
 * Timeline/Inspector flex container. Hosts the project BPM display
 * and the Preset-Packs entry button. Future home for export + project
 * name UI; v0.1 keeps it minimal.
 */
export function WorkspaceHeader() {
  const [browserOpen, setBrowserOpen] = useState(false);
  const bpm = useAppStore((s) => s.audio.grid.bpm);

  return (
    <div className="h-10 shrink-0 px-3 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-2 text-sm text-[var(--text)]">
        <span className="font-bold tracking-tight">VibeGrid</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--text-dim)]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          <span>{bpm} BPM</span>
        </div>
        <QualityIndicator />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="px-3 py-1.5 rounded-md bg-[var(--a1)] hover:opacity-90 text-white text-xs font-semibold transition-opacity"
          title="Open Preset Packs"
        >
          ✦ Preset Packs
        </button>
      </div>
      <PresetPackBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
      />
    </div>
  );
}
