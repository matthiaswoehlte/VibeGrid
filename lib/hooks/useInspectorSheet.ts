'use client';
import { useState } from 'react';
import { useDndMonitor } from '@dnd-kit/core';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useAppStore } from '@/lib/store';

/**
 * Plan 5.10 — drives the Mobile InspectorSheet's open/close state.
 *
 * `isOpen` is true when ALL of:
 *  - a clip is selected (`ui.selectedClipId !== null`)
 *  - the viewport is mobile (`useIsMobile()`)
 *  - no drag is currently in progress (Anm 7 Fix)
 *
 * The `!isDragging` gate prevents the sheet from popping up the
 * moment the user touches a clip to start a drag — `selectedClipId`
 * gets set on the Click after a drag finishes too (current Clip
 * onClick semantics), but we only want the sheet to open for genuine
 * taps. `useDndMonitor` requires the hook to be called inside a
 * DndContext — InspectorSheet is mounted in page.tsx inside the
 * lifted DndContext (Plan 5.10 Task 8).
 */
export function useInspectorSheet(): { isOpen: boolean; close: () => void } {
  const isMobile = useIsMobile();
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const setSelectedClipId = useAppStore((s) => s.setSelectedClipId);
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false)
  });
  return {
    isOpen: selectedClipId !== null && isMobile && !isDragging,
    close: () => setSelectedClipId(null)
  };
}
