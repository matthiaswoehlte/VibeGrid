'use client';
import { useEffect, useState } from 'react';
import type { AudioEngine } from '@/lib/audio/engine';
import { useAppStore } from '@/lib/store';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useUndoRedoShortcuts } from '@/lib/hooks/useUndoRedoShortcuts';
import { useTransportShortcuts } from '@/lib/hooks/useTransportShortcuts';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { AutomationEditorModal } from './Timeline/AutomationEditorModal';
import { WorkspaceHeader } from './WorkspaceHeader';

const TIMELINE_MIN_PX = 120;
const STAGE_MIN_PX = 160;
const DEFAULT_TIMELINE_PX = 256;

export function Workspace({
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_PX);
  // Plan 5.10 — Mobile layout drops the Desktop LeftPanel + Inspector
  // asides (Mobile uses MediaDrawer / FXDrawer / InspectorSheet instead)
  // and switches the Timeline from a fixed pixel height to flex-grow so
  // it fills the area between the 40vh Stage and the bottom TabBar.
  const isMobile = useIsMobile();

  // Plan 10 — Ctrl/Cmd+Z (undo), Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z (redo).
  // Mounted at the Workspace level so it works regardless of where the
  // focus is on the canvas / timeline. Skips when an input has focus.
  useUndoRedoShortcuts();

  // Global Spacebar → play/pause (DAW transport reflex).
  // INTENTIONALLY fires even when an input/textarea is focused — per explicit
  // user requirement: "Spacebar soll immer Play/Pause toggeln egal wo man steht".
  useTransportShortcuts(engine);

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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Plan 9a — global header above the workspace flex. Fixed height
          (~40px); the inner flex retains the LeftPanel/Stage/Inspector
          arrangement so Mobile Stage's h-[40vh] math (Plan 5.10) stays
          intact. Hidden on Mobile where the TabBar takes its place. */}
      <div className="hidden md:block">
        <WorkspaceHeader />
      </div>
      <div className="flex flex-1 min-h-0">
        {/* Desktop LeftPanel — hidden on Mobile; MediaDrawer + FXDrawer
            (mounted in page.tsx) take over the same content. */}
        <aside className="hidden md:block w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
          <LeftPanel />
        </aside>
      <main className="flex-1 flex flex-col min-w-0">
        {/* On Desktop the Stage flex-grows above the resize handle; on
            Mobile the Stage component itself locks to h-[40vh] (Plan 5.10
            Task 5), so the wrapper drops flex-1 to let that height win. */}
        <div className="md:flex-1 md:min-h-0 relative">
          <Stage
            engine={engine}
            canvasRef={canvasRef}
            getBitmapRef={getBitmapRef}
            getVideoElement={getVideoElement}
          />
          <button
            type="button"
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            onClick={() => setInspectorOpen((v) => !v)}
            className="absolute right-2 top-2 hidden md:inline-flex lg:hidden h-7 px-2 rounded bg-[var(--surface-2)] text-xs"
          >
            {inspectorOpen ? '›' : '‹'}
          </button>
        </div>
        {/* Resize handle is Desktop-only — Mobile has no Stage/Timeline
            split to adjust (Stage = 40vh fixed, Timeline = flex-grow). */}
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
          className="hidden md:block h-1.5 shrink-0 bg-[var(--border)] hover:bg-[var(--a2)] transition-colors"
          style={{ cursor: 'row-resize', touchAction: 'none' }}
        />
        {/* Mobile: Timeline fills remaining viewport (flex-grow) between
            the 40vh Stage and the 48px TabBar. Desktop: fixed pixel
            height controlled by the resize handle above. The inline
            `style.height` is omitted on Mobile so flex-1 wins. */}
        <div
          className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)] flex-1 md:flex-none"
          style={isMobile ? undefined : { height: timelineHeight }}
        >
          <Timeline engine={engine} />
        </div>
      </main>
        {/* Desktop Inspector — hidden on Mobile; InspectorSheet (mounted in
            page.tsx) takes over with a bottom-sheet UX. */}
        {inspectorOpen && (
          <aside className="hidden md:block w-72 shrink-0 border-l border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto">
            <Inspector />
          </aside>
        )}
      </div>
      <AutomationEditorModal />
    </div>
  );
}
