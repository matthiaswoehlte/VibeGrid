'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useAppStore } from '@/lib/store';
import { listPlugins, getPlugin } from '@/lib/renderer/registry';
import { registerBuiltInPlugins } from '@/lib/fx';
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import type { TrackKind } from '@/lib/timeline/types';
import { FXTrackPickerDialog } from './FXTrackPickerDialog';

// Idempotent — safe to call at module top. Matches FxLibrary.tsx pattern.
registerBuiltInPlugins();

/**
 * Plan 5.10 — Mobile slide-up drawer that replaces the Desktop FxLibrary
 * panel when the mobileTab is 'fx'. Uses TAP-TO-ADD (not drag) because:
 *  - Native HTML5 drag is unreliable on touch (broken on iOS Safari,
 *    inconsistent on Chrome Mobile) — see KNOWN_LIMITATIONS.
 *  - Drag target on Mobile is too small for precision.
 *
 * Tap behavior:
 *  - Single FX track for the plugin's kind: clip added directly at
 *    playhead position.
 *  - ≥ 2 FX tracks: FXTrackPickerDialog asks the user to pick one
 *    (Bug 2 Option C — no new `selectedTrackId` store state needed).
 */
export function FXDrawer() {
  const isMobile = useIsMobile();
  const active = useAppStore((s) => s.mobileUI.mobileTab);
  const tracks = useAppStore((s) => s.timeline.tracks);
  const playheadBeats = useAppStore((s) => s.timeline.playhead.beats);
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);
  const [pickerPluginId, setPickerPluginId] = useState<string | null>(null);

  if (!isMobile || active !== 'fx') return null;

  const plugins = listPlugins();

  const onTap = (pluginId: string) => {
    const plugin = getPlugin(pluginId);
    if (!plugin) {
      toast.error(`FX plugin "${pluginId}" not registered`);
      return;
    }
    const clipKind = PLUGIN_KIND_TO_TRACK_KIND[plugin.kind as PluginFxKind];
    const fxTracks = tracks.filter(
      (t) => canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted
    );
    if (fxTracks.length === 0) {
      toast.error(`No fx track available for ${plugin.name}`);
      return;
    }
    if (fxTracks.length === 1) {
      // Single FX track — add directly, no dialog.
      try {
        addClip({
          id: crypto.randomUUID(),
          trackId: fxTracks[0].id,
          kind: clipKind,
          fxId: pluginId,
          startBeat: Math.max(0, playheadBeats),
          lengthBeats: 4,
          label: plugin.name
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        toast.error(`Add failed: ${msg}`);
      }
      return;
    }
    // ≥ 2 fx tracks — let the user pick.
    setPickerPluginId(pluginId);
  };

  return (
    <>
      {/* Backdrop — tap to close the drawer (switch back to Timeline tab). */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setTab('timeline')}
        aria-label="Close FX drawer"
      />
      {/* Panel — z-50, sits above the TabBar (z-30) but the TabBar is
          positioned at bottom-0 so the drawer ends at bottom-12 to keep
          the TabBar visible. */}
      <div
        className="fixed left-0 right-0 bottom-12 z-50 h-[60vh] bg-[var(--surface-1)] border-t border-[var(--border)] overflow-y-auto p-3 md:hidden"
        role="region"
        aria-label="FX library"
      >
        <h2 className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-2">
          FX — tap to add at playhead
        </h2>
        <ul className="grid grid-cols-2 gap-2">
          {plugins.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onTap(p.id)}
                className="w-full min-h-11 px-2 py-2 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm text-[var(--text)] flex flex-col items-center justify-center gap-0.5"
              >
                <span>{p.name}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{p.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <FXTrackPickerDialog
        pluginId={pickerPluginId}
        onClose={() => setPickerPluginId(null)}
      />
    </>
  );
}
