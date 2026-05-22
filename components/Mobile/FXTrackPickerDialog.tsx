'use client';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import type { TrackKind } from '@/lib/timeline/types';
import { toast } from 'sonner';

interface Props {
  /** Plugin id whose clip should be added on confirm. `null` keeps the
   *  dialog closed. */
  pluginId: string | null;
  onClose: () => void;
}

/**
 * Plan 5.10 — Bug 2 Option C resolution. When the user taps an FX in
 * the FXDrawer and ≥ 2 fx-kind tracks exist, this dialog lists those
 * tracks so the user picks the destination explicitly. With exactly
 * one fx track, the FXDrawer skips this dialog and adds the clip
 * directly. The dialog itself is mobile-only (`md:hidden`) — Desktop
 * uses drag-and-drop into the timeline lane the user wants.
 */
export function FXTrackPickerDialog({ pluginId, onClose }: Props) {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const playheadBeats = useAppStore((s) => s.timeline.playhead.beats);
  const addClip = useAppStore((s) => s.timelineActions.addClip);

  if (!pluginId) return null;
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;

  const clipKind = PLUGIN_KIND_TO_TRACK_KIND[plugin.kind as PluginFxKind];
  const fxTracks = tracks.filter(
    (t) => canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted
  );

  const addToTrack = (trackId: string) => {
    try {
      addClip({
        id: crypto.randomUUID(),
        trackId,
        kind: clipKind,
        fxId: pluginId,
        startBeat: Math.max(0, playheadBeats),
        lengthBeats: 4,
        label: plugin.name
      });
    } catch (err) {
      // ops.addClip throws OperationError on OVERLAP — surface that
      // explicitly so the user knows WHY the tap did nothing.
      const msg = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Add failed: ${msg}`);
    }
    onClose();
  };

  return (
    <div
      // z-60 → Z_MODAL (matches AutomationEditorModal layer).
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 md:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Choose FX track for ${plugin.name}`}
    >
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 max-w-xs w-full mx-4"
        // Stop propagation so taps inside the dialog body don't close it.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium mb-3 text-[var(--text)]">
          Add {plugin.name} to which FX track?
        </h2>
        <ul className="space-y-1">
          {fxTracks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => addToTrack(t.id)}
                className="w-full text-left h-11 px-3 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] flex items-center text-sm text-[var(--text)]"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full h-11 text-xs uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
