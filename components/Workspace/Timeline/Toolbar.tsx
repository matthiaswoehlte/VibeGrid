'use client';
import { useAppStore } from '@/lib/store';
import { SelectControl } from '@/components/ui/SelectControl';
import { Slider } from '@/components/ui/Slider';
import { AddTrackButton } from './AddTrackButton';

export function Toolbar() {
  const zoom = useAppStore((s) => s.ui.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const snap = useAppStore((s) => s.timeline.snap);
  const setSnap = (v: 'beat' | 'half' | 'quarter' | 'off') =>
    useAppStore.setState((s) => ({ timeline: { ...s.timeline, snap: v } }));

  return (
    <div className="h-8 px-2 flex items-center gap-3 border-b border-[var(--border)]">
      <label className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
        Snap
        <SelectControl
          value={snap}
          onChange={(v) => setSnap(v as 'beat' | 'half' | 'quarter' | 'off')}
          options={[
            { value: 'beat', label: '1/1' },
            { value: 'half', label: '1/2' },
            { value: 'quarter', label: '1/4' },
            { value: 'off', label: 'off' }
          ]}
          label="Snap"
        />
      </label>
      {/* AddTrackButton lives here between Snap and Zoom so it stays
          reachable regardless of how many tracks exist (the old
          mount point at the bottom of the track list scrolled out of
          view as more tracks were added). */}
      <AddTrackButton />
      <label className="flex items-center gap-1 text-xs text-[var(--text-dim)] w-40">
        Zoom
        <Slider min={0.5} max={3} step={0.1} value={zoom} onChange={setZoom} label="Zoom" />
      </label>
    </div>
  );
}
