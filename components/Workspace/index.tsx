'use client';
import { useEffect, useState } from 'react';
import type { AudioEngine } from '@/lib/audio/engine';
import { useAppStore } from '@/lib/store';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { AutomationEditorModal } from './Timeline/AutomationEditorModal';

const TIMELINE_MIN_PX = 120;
const STAGE_MIN_PX = 160;
const DEFAULT_TIMELINE_PX = 256;

export function Workspace({
  engine,
  canvasRef
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_PX);

  // Global Delete / Backspace shortcut — removes the currently selected clip.
  // No-op when an input/textarea/contenteditable has focus (don't interfere
  // with text editing in the BPM input or Inspector controls).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const { selectedClipId } = useAppStore.getState().ui;
      if (!selectedClipId) return;
      useAppStore.getState().timelineActions.removeClip(selectedClipId);
      useAppStore.getState().setSelectedClipId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
        <LeftPanel />
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 relative">
          <Stage engine={engine} canvasRef={canvasRef} />
          <button
            type="button"
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="absolute right-2 top-2 lg:hidden h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
          >
            {inspectorOpen ? '›' : '‹'}
          </button>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
          onPointerDown={(e) => {
            e.preventDefault();
            const target = e.currentTarget;
            try {
              target.setPointerCapture(e.pointerId);
            } catch {
              /* not all platforms */
            }
            const startY = e.clientY;
            const startHeight = timelineHeight;
            const move = (ev: PointerEvent) => {
              // Dragging up = make timeline taller. Dragging down = shorter.
              const dy = startY - ev.clientY;
              const maxHeight = Math.max(
                TIMELINE_MIN_PX,
                window.innerHeight - STAGE_MIN_PX - 80 /* topbar */
              );
              setTimelineHeight(
                Math.max(TIMELINE_MIN_PX, Math.min(maxHeight, startHeight + dy))
              );
            };
            const up = (ev: PointerEvent) => {
              try {
                target.releasePointerCapture(ev.pointerId);
              } catch {
                /* may already be released */
              }
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', up);
              target.removeEventListener('pointercancel', up);
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', up);
            target.addEventListener('pointercancel', up);
          }}
          className="h-1.5 shrink-0 bg-[var(--border)] hover:bg-[var(--a2)] transition-colors"
          style={{ cursor: 'row-resize', touchAction: 'none' }}
        />
        <div
          className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)]"
          style={{ height: timelineHeight }}
        >
          <Timeline engine={engine} />
        </div>
      </main>
      {inspectorOpen && (
        <aside className="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
          <Inspector />
        </aside>
      )}
      <AutomationEditorModal />
    </div>
  );
}
