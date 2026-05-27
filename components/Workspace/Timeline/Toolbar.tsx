'use client';
import { useAppStore } from '@/lib/store';
import { Slider } from '@/components/ui/Slider';
import { ClipSnapPicker } from '@/components/Workspace/ClipSnapPicker';
import { AddTrackButton } from './AddTrackButton';
import { PlayheadTime } from './PlayheadTime';

/**
 * Timeline-toolbar with the Snap picker, AddTrack and Zoom controls.
 *
 * The legacy `timeline.snap` store field (Plan-1-7) is dead — it was
 * only consumed by this toolbar itself, never by any drag/drop/resize
 * code. Plan 8f.1 introduced `ClipSnapPicker` + `readClipSnap()` as
 * the single source of truth for clip snapping; the picker now lives
 * here (was briefly in the WorkspaceHeader during the 8f.1 follow-up).
 */
export function Toolbar() {
  const zoom = useAppStore((s) => s.ui.zoom);
  const setZoom = useAppStore((s) => s.setZoom);

  return (
    <div className="h-8 px-2 flex items-center gap-3 border-b border-[var(--border)]">
      <ClipSnapPicker />
      {/* AddTrackButton lives here between Snap and Zoom so it stays
          reachable regardless of how many tracks exist (the old
          mount point at the bottom of the track list scrolled out of
          view as more tracks were added). */}
      <AddTrackButton />
      {/* Plan 9b follow-up — wall-clock time display centered above the
          Gantt. Spacers (`flex-1`) on both sides push it to the middle. */}
      <div className="flex-1" />
      <PlayheadTime />
      <div className="flex-1" />
      <label className="flex items-center gap-1 text-xs text-[var(--text-dim)] w-40">
        Zoom
        <Slider min={0.5} max={3} step={0.1} value={zoom} onChange={setZoom} label="Zoom" />
      </label>
    </div>
  );
}
