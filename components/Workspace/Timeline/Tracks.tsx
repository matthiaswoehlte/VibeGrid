'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent
} from 'react';
import { toast } from 'sonner';
import { useDndMonitor, type DragEndEvent } from '@dnd-kit/core';
import { useAppStore } from '@/lib/store';
import { getPlugin } from '@/lib/renderer/registry';
import { isAutomationCurve } from '@/lib/automation/resolve';
import type { TrackKind } from '@/lib/timeline/types';
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import { canDropOnTrack } from '@/lib/timeline/track-validation';
import { sortedTracks } from '@/lib/timeline/selectors';
import { applySyncAudioFromArrayBuffer } from '@/lib/sceneflow/apply-sync-audio';
import { useWebGLClipCleanup } from '@/lib/hooks/useWebGLClipCleanup';
import { snapBeat } from '@/lib/automation/snap';
import { readClipSnap } from '@/components/Workspace/ClipSnapPicker';
import {
  clipsInRubberband,
  computeCtrlDOffset,
  type Rect,
  type TrackBand
} from '@/lib/timeline/multi-select';
import {
  setGroupDragListener,
  type GroupDragMode
} from '@/lib/timeline/group-drag-bus';
import { Clip } from './Clip';
import { AutomationLane } from './AutomationLane';
import { TrackHeader } from './TrackHeader';
import { SyncAudioDropZone } from './SyncAudioDropZone';
import { GridBackground } from './GridBackground';
import { MobileAutomationButton } from '@/components/Mobile/MobileAutomationButton';

const BEAT_PX_BASE = 40;
// Shared with Ruler.tsx and Playhead.tsx — the sticky left column width
// reserved for track-name labels. All horizontal positioning of clips/ticks
// happens to the RIGHT of this column.
export const TRACK_LABEL_WIDTH = 80;

// Plan 5.9c — local PLUGIN_TO_TRACK_KIND map gone; use the SSOT
// `PLUGIN_KIND_TO_TRACK_KIND` from `@/lib/timeline/plugin-mapping`.
// Drop-routing also switches from "find track of the plugin's
// per-FX kind" to "find an fx track that accepts this clip-kind"
// (via canDropOnTrack), since all FX clips now live on 'fx' tracks.

export function Tracks({ totalBeats }: { totalBeats: number }) {
  const tracks = useAppStore((s) => s.timeline.tracks);
  const clips = useAppStore((s) => s.timeline.clips);
  const zoom = useAppStore((s) => s.ui.zoom);
  // Inline lane preview is shown for the SELECTED clip (when it has any
  // automation curve). The editor modal opens via the Inspector and is
  // independent of inline visibility.
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const moveClip = useAppStore((s) => s.timelineActions.moveClip);
  const moveClipToTrack = useAppStore((s) => s.timelineActions.moveClipToTrack);
  const addClip = useAppStore((s) => s.timelineActions.addClip);
  const getMediaRef = useAppStore((s) => s.mediaActions.getMediaRef);
  const selectClips = useAppStore((s) => s.selectClips);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const moveSelectedClips = useAppStore((s) => s.moveSelectedClips);
  const duplicateSelectedClips = useAppStore(
    (s) => s.duplicateSelectedClips
  );
  const deleteSelectedClips = useAppStore((s) => s.deleteSelectedClips);
  const px = BEAT_PX_BASE * zoom;

  // Plan 9b — rubberband selection state. Local to this component
  // (transient, no store). `null` means no rubberband active.
  const tracksRootRef = useRef<HTMLDivElement | null>(null);
  const [rubberband, setRubberband] = useState<Rect | null>(null);

  // Plan 9b — group-drag state (move OR copy). Ghost-only preview
  // during drag; store mutation only on PointerUp. Architect-D4.
  const [groupDrag, setGroupDrag] = useState<{
    mode: GroupDragMode;
    deltaBeats: number;
    /** Snapshot of selectedClipIds at drag-start so we render ghosts
     *  for the right set even if selection changes mid-drag. */
    clipIds: string[];
  } | null>(null);

  // Plan 8f.1 — release per-clip WebGL2 contexts when their owning clip
  // is removed. Memoise the id-array so the cleanup hook's useEffect
  // only re-runs when the clip SET changes — without the memo every
  // unrelated Tracks re-render (rubberband, group-drag, resize tick at
  // 60 fps) recreates the array and triggers the effect's O(N)
  // Set-diff for nothing.
  const clipIdsKey = clips.map((c) => c.id).join('\n');
  const clipIds = useMemo(
    () => clips.map((c) => c.id),
    // Stable string-key avoids array-identity churn while still
    // capturing add/remove/reorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipIdsKey]
  );
  useWebGLClipCleanup(clipIds);

  // Plan 5.10: DndContext is now mounted in app/(studio)/page.tsx so the
  // InspectorSheet (mounted as a sibling of Workspace) can use
  // useDndMonitor to detect drag-in-progress. Tracks subscribes to the
  // same parent context via useDndMonitor below — drag-handler logic is
  // unchanged, only the wiring moved up one level. Sensors + activation
  // constraints + autoScroll={false} live at the parent DndContext.

  // Auto-scroll lives in a ref so its lifecycle is controlled by the
  // drag callbacks below — no React state, no useEffect, no
  // useDndContext (which has been unreliable for detecting drag activation
  // across earlier fix attempts). The ref holds the running rAF id, the
  // window-level pointermove listener, and a counter we log on drag end.
  const autoScrollRef = useRef<{
    rafId: number | null;
    lastClientX: number;
    onMove: ((e: PointerEvent) => void) | null;
    scrollsAttempted: number;
  }>({
    rafId: null,
    lastClientX: 0,
    onMove: null,
    scrollsAttempted: 0
  });

  const startAutoScroll = () => {
    const s = autoScrollRef.current;
    if (s.rafId !== null) return; // already running
    s.scrollsAttempted = 0;
    s.lastClientX = 0;
    s.onMove = (e: PointerEvent) => {
      s.lastClientX = e.clientX;
    };
    window.addEventListener('pointermove', s.onMove, { capture: true, passive: true });
    const tick = () => {
      const container = document.querySelector(
        '[data-timeline-scroll]'
      ) as HTMLElement | null;
      if (container && s.lastClientX > 0) {
        const rect = container.getBoundingClientRect();
        const EDGE = 80;
        const STEP = 14;
        const x = s.lastClientX;
        if (x < rect.left + EDGE && container.scrollLeft > 0) {
          const prev = container.scrollLeft;
          container.scrollLeft = Math.max(0, container.scrollLeft - STEP);
          if (container.scrollLeft !== prev) s.scrollsAttempted++;
        } else if (x > rect.right - EDGE) {
          const max = container.scrollWidth - container.clientWidth;
          if (container.scrollLeft < max) {
            const prev = container.scrollLeft;
            container.scrollLeft = Math.min(max, container.scrollLeft + STEP);
            if (container.scrollLeft !== prev) s.scrollsAttempted++;
          }
        }
      }
      s.rafId = requestAnimationFrame(tick);
    };
    s.rafId = requestAnimationFrame(tick);
  };

  const stopAutoScroll = () => {
    const s = autoScrollRef.current;
    if (s.onMove) {
      window.removeEventListener('pointermove', s.onMove, { capture: true });
      s.onMove = null;
    }
    if (s.rafId !== null) {
      cancelAnimationFrame(s.rafId);
      s.rafId = null;
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    stopAutoScroll();
    const data = e.active.data.current as { kind: string; clipId?: string } | undefined;
    if (data?.kind !== 'clip' || !data.clipId) return;
    const clip = clips.find((c) => c.id === data.clipId);
    if (!clip) return;
    const dxBeats = e.delta.x / px;
    // Beat-Snap on move — resolution from the global ClipSnapPicker
    // (localStorage-persisted). 'off' falls through to free-float.
    const target = snapBeat(clip.startBeat + dxBeats, readClipSnap());

    // Plan 8h — cross-track drag (single clips, same-kind only).
    // Use the activator event (pointerdown position) + delta to compute
    // the final pointer position, then find the track element underneath.
    //
    // CRITICAL: the dragged clip itself sits at the cursor (dnd-kit's
    // CSS transform-translate moves it visually, and the element stays
    // hit-testable). `elementFromPoint` would return the dragged clip,
    // and `closest('[data-track-id]')` walks the DOM up to the clip's
    // SOURCE track — making every "cross-track" drop look like a same-
    // track time-shift. Use `elementsFromPoint` (plural) and skip
    // anything inside the dragged clip's DOM subtree, so we find the
    // ACTUAL track row visually under the cursor.
    const activator = e.activatorEvent as PointerEvent | null;
    if (activator) {
      const finalX = activator.clientX + e.delta.x;
      const finalY = activator.clientY + e.delta.y;
      const sourceClipEl = document.querySelector(
        `[data-clip-id="${clip.id}"]`
      );
      const stack = document.elementsFromPoint(finalX, finalY);
      let clipArea: HTMLElement | null = null;
      for (const el of stack) {
        // Skip the dragged clip and any of its descendants.
        if (sourceClipEl && sourceClipEl.contains(el)) continue;
        const track = (el as HTMLElement).closest(
          '[data-track-id]'
        ) as HTMLElement | null;
        if (track) {
          clipArea = track;
          break;
        }
      }
      const targetTrackId = clipArea?.getAttribute('data-track-id') ?? null;

      if (targetTrackId && targetTrackId !== clip.trackId) {
        // The user dropped on a different track — validate kind compatibility.
        const targetTrack = tracks.find((t) => t.id === targetTrackId);
        if (targetTrack && canDropOnTrack(clip.kind, targetTrack.kind as TrackKind)) {
          moveClipToTrack(clip.id, targetTrackId, target);
          return;
        } else {
          toast.error('Clip cannot move to this track type');
          return; // clip stays at original position
        }
      }
    }

    // Same track (or no target detected) — existing time-shift behaviour.
    moveClip(clip.id, target);
  };

  // Native HTML5 drop target — FxLibrary and MediaLibrary use native draggable
  // (not @dnd-kit), so this lane catches both. We allow the drop by preventing
  // default on dragover; on drop we discriminate by dataTransfer key.
  const onNativeDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (
      e.dataTransfer.types.includes('application/x-vibegrid-fx') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-image') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-video') ||
      e.dataTransfer.types.includes('application/x-vibegrid-media-audio')
    ) {
      e.preventDefault();
    }
  };

  const onNativeDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const fxId = e.dataTransfer.getData('application/x-vibegrid-fx');
    const mediaIdImage = e.dataTransfer.getData('application/x-vibegrid-media-image');
    const mediaIdVideo = e.dataTransfer.getData('application/x-vibegrid-media-video');
    const mediaIdAudio = e.dataTransfer.getData('application/x-vibegrid-media-audio');
    if (!fxId && !mediaIdImage && !mediaIdVideo && !mediaIdAudio) return;
    e.preventDefault();

    // Compute startBeat from the actual clip-area under the cursor (not the
    // outer container). This keeps the label column non-droppable and avoids
    // the off-by-LABEL_WIDTH issue when the user drops near a track's left edge.
    const target = e.target as HTMLElement;
    const clipArea = target.closest('[data-track-kind]') as HTMLElement | null;
    if (!clipArea) return;
    const rect = clipArea.getBoundingClientRect();
    const xInArea = e.clientX - rect.left;
    // Snap to the user-selected grid resolution (default '1' beat,
    // configurable in the WorkspaceHeader via ClipSnapPicker). 'off'
    // bypasses snapping for free-float positioning.
    const startBeat = snapBeat(xInArea / px, readClipSnap());

    // Plan 5.9a — multi-track: identify the exact track under the cursor.
    const droppedTrackId = clipArea.getAttribute('data-track-id');
    const droppedTrackKind = clipArea.getAttribute('data-track-kind') as
      | TrackKind
      | null;

    try {
      if (fxId) {
        const plugin = getPlugin(fxId);
        if (!plugin) {
          toast.error(`FX plugin "${fxId}" not registered`);
          return;
        }
        const clipKind = PLUGIN_KIND_TO_TRACK_KIND[plugin.kind as PluginFxKind];
        // Plan 5.9c — drop routes to an 'fx' track. Prefer the lane
        // the user actually dropped on; fall back to the first
        // non-muted fx track. With multiple fx tracks (FX, FX 2, …)
        // this lets users group clips visually.
        // `t.kind` is transitionally widened to `TrackKind | TrackFxKind`
        // (Task 2). After Task 3's v5→v6 migrate runs, runtime values
        // are always in the narrow `TrackKind`; the cast bridges the
        // gap until Task 12 narrows the type back.
        const targetTrack =
          (droppedTrackId && droppedTrackKind === 'fx'
            ? tracks.find((t) => t.id === droppedTrackId && canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted)
            : undefined)
          ?? tracks.find((t) => canDropOnTrack(clipKind, t.kind as TrackKind) && !t.muted);
        if (!targetTrack) {
          toast.error(`No fx track available for ${plugin.name}`);
          return;
        }
        addClip({
          id: crypto.randomUUID(),
          trackId: targetTrack.id,
          kind: clipKind,
          fxId,
          startBeat,
          lengthBeats: 4,
          label: plugin.name
        });
        return;
      }

      if (mediaIdImage) {
        const ref = getMediaRef(mediaIdImage);
        if (!ref) {
          toast.error(`Media reference ${mediaIdImage} not found`);
          return;
        }
        // Plan 5.9a — validate media-track-kind match. The drop target must
        // be an image track (could be one of several with multi-track).
        if (droppedTrackKind && !canDropOnTrack('image', droppedTrackKind)) {
          toast.error(
            `Bild kann nicht auf "${droppedTrackKind}"-Track — nur auf Image-Tracks`
          );
          return;
        }
        const imageTrack =
          droppedTrackId
            ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'image')
            : tracks.find((t) => t.kind === 'image');
        if (!imageTrack) {
          toast.error('No image track found');
          return;
        }
        // Default image-clip length: 4 beats (same as FX defaults).
        // Pre-5.9d image clips were auto-stretched to the full audio
        // duration on the assumption "image = album art for the whole
        // song". With Multi-Audio and dynamic image-tracks the assumption
        // doesn't hold — long auto-stretched bars force the user to
        // scroll to the song's end just to shorten them. 4 beats is
        // visible without scrolling at any zoom level; the user resizes
        // outward when they actually want a longer image.
        addClip({
          id: crypto.randomUUID(),
          trackId: imageTrack.id,
          kind: 'image',
          mediaId: mediaIdImage,
          startBeat,
          lengthBeats: 4,
          label: ref.filename
        });
        return;
      }

      if (mediaIdVideo) {
        // Plan-5.9b — video drop.
        const ref = getMediaRef(mediaIdVideo);
        if (!ref) {
          toast.error(`Media reference ${mediaIdVideo} not found`);
          return;
        }
        if (droppedTrackKind && !canDropOnTrack('video', droppedTrackKind)) {
          toast.error(
            `Video kann nicht auf "${droppedTrackKind}"-Track — nur auf Video-Tracks`
          );
          return;
        }
        // Video clips can land on either a regular 'video' track OR
        // the SceneFlow-owned 'main-video' singleton (Plan 8d). Both
        // are valid per canDropOnTrack; the renderer treats them
        // identically. Without main-video in the predicate here, clips
        // dropped onto the main-video lane after a clear would silently
        // fall back to the first 'video' track (or fail if none exists).
        const isVideoLane = (kind: TrackKind | undefined): boolean =>
          kind === 'video' || kind === 'main-video';
        const videoTrack = droppedTrackId
          ? tracks.find((t) => t.id === droppedTrackId && isVideoLane(t.kind))
          : tracks.find((t) => isVideoLane(t.kind));
        if (!videoTrack) {
          toast.error('No video track found');
          return;
        }
        // Video-clip length matches the source video duration (in beats).
        const bpm = useAppStore.getState().audio.grid.bpm || 120;
        const lengthBeats = ref.duration
          ? Math.max(1, Math.ceil((ref.duration * bpm) / 60))
          : 16;
        addClip({
          id: crypto.randomUUID(),
          trackId: videoTrack.id,
          kind: 'video',
          mediaId: mediaIdVideo,
          startBeat,
          lengthBeats,
          label: ref.filename
        });
        return;
      }

      if (mediaIdAudio) {
        // Plan 5.9d/8d — audio drop. Routes to either a regular
        // `audio` lane (normal clip add) or the singleton `sync-audio`
        // lane (BPM-detect + main-video re-snap via the shared
        // apply-sync-audio pipeline).
        const ref = getMediaRef(mediaIdAudio);
        if (!ref) {
          toast.error(`Media reference ${mediaIdAudio} not found`);
          return;
        }
        if (droppedTrackKind && !canDropOnTrack('audio', droppedTrackKind)) {
          toast.error(
            `Audio kann nicht auf "${droppedTrackKind}"-Track — nur auf Audio-Tracks`
          );
          return;
        }

        // Plan 8d — sync-audio target: fetch the file from R2, decode,
        // detect BPM, and re-snap all main-video clips. Same pipeline
        // as SyncAudioDropZone's upload path, just starting from a URL.
        if (droppedTrackKind === 'sync-audio') {
          const syncTrack = droppedTrackId
            ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'sync-audio')
            : tracks.find((t) => t.kind === 'sync-audio');
          if (!syncTrack) {
            toast.error('Sync-Audio-Track nicht gefunden');
            return;
          }
          const state = useAppStore.getState();
          const existingClip =
            state.timeline.clips.find((c) => c.trackId === syncTrack.id) ?? null;
          const mainVideoClips = state.timeline.clips.filter((c) => {
            const t = state.timeline.tracks.find((tr) => tr.id === c.trackId);
            return t?.kind === 'main-video';
          });
          void (async () => {
            let arrayBuffer: ArrayBuffer;
            try {
              const res = await fetch(ref.url);
              if (!res.ok) {
                toast.error(`Audio konnte nicht geladen werden (HTTP ${res.status})`);
                return;
              }
              arrayBuffer = await res.arrayBuffer();
            } catch (e) {
              toast.error('Audio-Fetch fehlgeschlagen: ' + (e as Error).message);
              return;
            }
            await applySyncAudioFromArrayBuffer({
              arrayBuffer,
              mediaId: mediaIdAudio,
              filename: ref.filename,
              trackId: syncTrack.id,
              existingClip,
              mainVideoClips,
              getMediaRef: useAppStore.getState().mediaActions.getMediaRef,
              currentBpm: useAppStore.getState().audio.grid.bpm || 120,
              setBPM: useAppStore.getState().audioActions.setBPM,
              addClip: useAppStore.getState().timelineActions.addClip,
              removeClip: useAppStore.getState().timelineActions.removeClip,
              removeMediaRef: useAppStore.getState().mediaActions.removeMediaRef,
              replaceMainVideoClips:
                useAppStore.getState().timelineActions.replaceMainVideoClips,
              setClipParam: useAppStore.getState().timelineActions.setClipParam,
              getAllClips: () => useAppStore.getState().timeline.clips
            });
          })();
          return;
        }

        const audioTrack = droppedTrackId
          ? tracks.find((t) => t.id === droppedTrackId && t.kind === 'audio')
          : tracks.find((t) => t.kind === 'audio');
        if (!audioTrack) {
          toast.error('No audio track found');
          return;
        }
        const bpm = useAppStore.getState().audio.grid.bpm || 120;
        const lengthBeats = ref.duration
          ? Math.max(1, Math.ceil((ref.duration * bpm) / 60))
          : 16;
        addClip({
          id: crypto.randomUUID(),
          trackId: audioTrack.id,
          kind: 'audio',
          mediaId: mediaIdAudio,
          startBeat,
          lengthBeats,
          label: ref.filename
        });
      }
    } catch (err) {
      // ops.addClip throws OperationError on OVERLAP — surface that explicitly
      // so the user knows WHY the drop did nothing.
      const msg = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Drop failed: ${msg}`);
      // eslint-disable-next-line no-console
      console.warn('[Tracks] addClip failed:', err);
    }
  };

  // Subscribe to the parent DndContext's drag lifecycle (Plan 5.10 lift).
  // Same handlers that previously sat on the local DndContext props —
  // useDndMonitor accepts the same listener shape and fires identically.
  useDndMonitor({
    onDragStart: (e) => {
      const data = e.active.data.current as { kind?: string } | undefined;
      if (data?.kind === 'clip') startAutoScroll();
    },
    onDragCancel: stopAutoScroll,
    onDragEnd
  });

  // Plan 9b — global keyboard shortcuts for the selection.
  // Input-Guard (W6): skip when an input/textarea/select has focus, so
  // Backspace in the Inspector's number-field doesn't delete clips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName ?? '';
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        ae?.isContentEditable
      ) {
        return;
      }
      const cmd = e.ctrlKey || e.metaKey;
      const state = useAppStore.getState();

      if (e.key === 'Escape') {
        if (state.ui.selectedClipIds.length > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      if (cmd && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectClips(state.timeline.clips.map((c) => c.id));
        return;
      }
      if (cmd && (e.key === 'd' || e.key === 'D')) {
        // Architect D2 — offset = rightmost-edge − leftmost-edge.
        e.preventDefault();
        const offset = computeCtrlDOffset(
          state.ui.selectedClipIds,
          state.timeline.clips
        );
        if (offset > 0) {
          const total = state.ui.selectedClipIds.length;
          const added = duplicateSelectedClips(offset);
          const skipped = total - added;
          if (added > 0 && skipped === 0) {
            toast.success(`${added} clips duplicated`);
          } else if (added > 0 && skipped > 0) {
            toast.message(
              `${added} of ${total} clips duplicated (${skipped} overlap)`
            );
          } else if (added === 0 && total > 0) {
            toast.error('No clips duplicated (all overlap)');
          }
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.ui.selectedClipIds.length === 0) return;
        e.preventDefault();
        const n = state.ui.selectedClipIds.length;
        deleteSelectedClips();
        toast.message(`${n} ${n === 1 ? 'clip' : 'clips'} deleted`);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (state.ui.selectedClipIds.length === 0) return;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const step = e.shiftKey ? 4 : 1;
        e.preventDefault();
        moveSelectedClips(dir * step);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    clearSelection,
    selectClips,
    moveSelectedClips,
    duplicateSelectedClips,
    deleteSelectedClips
  ]);

  // Plan 9b — register the group-drag bus listener. Activated by
  // Clip.tsx via dispatchGroupDragStart when the user PointerDowns
  // on a selected clip in a multi-selection (or shift+drag).
  useEffect(() => {
    setGroupDragListener(({ pointerEvent, mode }) => {
      const startX = pointerEvent.clientX;
      const initialIds = useAppStore.getState().ui.selectedClipIds;
      if (initialIds.length === 0) return;
      // Closure-scoped snapshot — independent of React state. Updated
      // by onMove, read by onUp. We CANNOT read live values via
      // setGroupDrag's updater callback because React 18 invokes
      // updaters during the reconciliation phase, NOT synchronously
      // during the setter call — by the time onUp's side effects run,
      // the updater has not yet executed and any "snapshot = prev"
      // assignment is still null. Closure variables sidestep React
      // entirely for the side-effect path; setGroupDrag is used purely
      // for ghost rendering.
      const liveClipIds = [...initialIds];
      let liveDeltaBeats = 0;
      setGroupDrag({ mode, deltaBeats: 0, clipIds: liveClipIds });

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        liveDeltaBeats = dx / px;
        // Ghost rendering — React state update. Updater is pure
        // (no side effects), Strict-Mode-safe.
        setGroupDrag((prev) =>
          prev ? { ...prev, deltaBeats: liveDeltaBeats } : prev
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Clear ghost FIRST via pure setter — no side effects inside.
        // This is what React Strict Mode could double-invoke safely
        // (the only effect is setting state to null).
        setGroupDrag(null);

        // All side effects use CLOSURE variables (liveDeltaBeats,
        // mode, liveClipIds), NOT React state. They fire exactly once
        // per onUp invocation regardless of any React internals.
        const snapped = snapBeat(liveDeltaBeats, readClipSnap());
        if (snapped === 0) return;
        if (mode === 'move') {
          moveSelectedClips(snapped);
        } else {
          const total = liveClipIds.length;
          const added = duplicateSelectedClips(snapped);
          const skipped = total - added;
          if (added > 0 && skipped === 0) {
            toast.success(`${added} clips duplicated`);
          } else if (added > 0 && skipped > 0) {
            toast.message(
              `${added} of ${total} clips duplicated (${skipped} overlap)`
            );
          } else if (added === 0) {
            toast.error('No clips duplicated (all overlap)');
          }
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return () => setGroupDragListener(null);
  }, [px, moveSelectedClips, duplicateSelectedClips]);

  // Plan 9b — rubberband selection. PointerDown on a track-area that
  // is NOT a clip starts a rubberband. PointerUp with no drag-move
  // (≤ 3px) treats the gesture as a Click → clearSelection().
  const onRubberbandPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary-button pointer events trigger rubberband (mouse left,
    // touch first, pen tip). Buttons === 1 covers left+nothing-else.
    if (e.button !== 0) return;
    // Ignore clicks on a clip — clip's own handler runs first.
    const target = e.target as HTMLElement;
    if (target.closest('[data-clip-id]')) return;
    // Ignore clicks on the sticky track-label column.
    if (target.closest('[data-track-label]')) return;
    // Ignore clicks on resize handles or sync-audio drop zones.
    if (target.closest('[data-no-rubberband]')) return;

    const root = tracksRootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const startX = e.clientX - rootRect.left;
    const startY = e.clientY - rootRect.top;

    let movedBeyondThreshold = false;
    const THRESHOLD = 3;

    const onMove = (ev: PointerEvent) => {
      const rr = root.getBoundingClientRect();
      const cx = ev.clientX - rr.left;
      const cy = ev.clientY - rr.top;
      if (
        !movedBeyondThreshold &&
        (Math.abs(cx - startX) > THRESHOLD || Math.abs(cy - startY) > THRESHOLD)
      ) {
        movedBeyondThreshold = true;
      }
      if (!movedBeyondThreshold) return;
      setRubberband({ x1: startX, y1: startY, x2: cx, y2: cy });

      // Live hit-test — compute current track-band rects from the DOM
      // so the math works regardless of CSS-driven row heights.
      const trackBands: TrackBand[] = [];
      const trackEls = root.querySelectorAll('[data-track-id]');
      trackEls.forEach((el) => {
        const tid = el.getAttribute('data-track-id');
        if (!tid) return;
        const r = el.getBoundingClientRect();
        trackBands.push({
          trackId: tid,
          top: r.top - rootRect.top,
          height: r.height
        });
      });
      // Scroll-offset: lane content is positioned relative to its own
      // track-area `<div>` (no shared scrollLeft offset against the
      // track-area rect). Our hit-test rect is in root-relative coords
      // already, so scrollLeft is 0 from this code's perspective —
      // because trackBands are already root-relative.
      const ids = clipsInRubberband(
        { x1: startX, y1: startY, x2: cx, y2: cy },
        clips,
        trackBands,
        px,
        // Track-area `<div>` is positioned right of TrackHeader. The
        // clip's `left = startBeat * px` is relative to that div, so
        // we add TRACK_LABEL_WIDTH back so the rubberband math lines
        // up with clip positions in root-relative coords.
        -TRACK_LABEL_WIDTH
      );
      selectClips(ids);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setRubberband(null);
      if (!movedBeyondThreshold) {
        // Plain click — clear selection if no actual rubberband drag.
        clearSelection();
      }
      try {
        (ev.target as Element | null)?.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* not captured — ok */
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    /* Plan 5.10: touch-pan-x on Mobile hints to the browser that
        horizontal pans are preferred within the timeline drop area;
        vertical pans propagate up to the outer Timeline container so
        the track-list still scrolls. Reset to touch-auto on Desktop
        (where mouse drives both axes). dnd-kit's PointerSensor sets
        its own touch-action: none on draggable handles, so clip-drag
        isn't affected by this default. */
    <div
      ref={tracksRootRef}
      onDragOver={onNativeDragOver}
      onDrop={onNativeDrop}
      onPointerDown={onRubberbandPointerDown}
      className="touch-pan-x md:touch-auto relative"
    >
      {/* Plan 9b follow-up — orientation grid background. Spans every
          track row vertically; starts after the sticky label-column so
          it aligns with clip positions. `z-0` keeps it under clips
          (which are auto-stacked above with their own absolute
          positioning). */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 z-0"
        style={{ left: TRACK_LABEL_WIDTH }}
      >
        <GridBackground totalBeats={totalBeats} pxPerBeat={px} />
      </div>
      {rubberband && (
        // Plain absolute-positioned div, NOT an SVG. The SVG path
        // had two issues that clipped the rect when the user dragged
        // past certain boundaries: (1) no viewBox → user-space is
        // tied to the SVG element's CSS size, and with `width: 100%`
        // on a flex/relative parent the SVG box was sometimes
        // narrower than the dragged rect; (2) the default SVG
        // `overflow: hidden` then cropped everything outside that
        // box, even though the rect coordinates were still valid.
        // A div bypasses both problems — it positions and renders
        // independently of any viewBox math.
        <div
          aria-hidden
          className="pointer-events-none absolute z-10"
          style={{
            left: Math.min(rubberband.x1, rubberband.x2),
            top: Math.min(rubberband.y1, rubberband.y2),
            width: Math.abs(rubberband.x2 - rubberband.x1),
            height: Math.abs(rubberband.y2 - rubberband.y1),
            background: 'rgba(168,107,255,0.08)',
            border: '1px dashed #a86bff'
          }}
        />
      )}
      {groupDrag && (
        <GroupDragGhosts
          clipIds={groupDrag.clipIds}
          deltaBeats={groupDrag.deltaBeats}
          mode={groupDrag.mode}
          px={px}
          clips={clips}
          tracks={tracks}
          labelWidth={TRACK_LABEL_WIDTH}
          rootRef={tracksRootRef}
        />
      )}
        {sortedTracks(tracks).map((t) => {
          // Show the read-only inline lane under the selected clip's track
          // row whenever that clip has at least one automation curve. The
          // AutomationLane itself filters params and returns null when no
          // sliders are automated, so we don't double-check here.
          const expandedClip = selectedClipId
            ? clips.find((c) => c.trackId === t.id && c.id === selectedClipId)
            : undefined;
          // Plan 5.10: Mobile shows a "⚡ Open editor" button row below
          // each track whose first clip carries any automation curve, in
          // place of the AutomationLane preview (hidden on Mobile). Cheap
          // O(clips-on-track) scan — runs per render, no memo needed at
          // this list size.
          const firstAutomationClip = clips.find(
            (c) =>
              c.trackId === t.id &&
              Object.values((c.params ?? {}) as Record<string, unknown>).some(
                isAutomationCurve
              )
          );
          return (
            <div key={t.id}>
              <div
                className="flex border-b border-[var(--border)] h-14 md:h-8"
                style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
              >
                <TrackHeader track={t} width={TRACK_LABEL_WIDTH} />
                <div
                  className="relative shrink-0"
                  style={{ width: totalBeats * px }}
                  data-track-id={t.id}
                  data-track-kind={t.kind}
                >
                  {clips
                    .filter((c) => c.trackId === t.id)
                    .map((c) => (
                      <Clip key={c.id} clip={c} />
                    ))}
                  {/* Plan 8d — sync-audio lane gets a drop/upload overlay.
                      Renders full-width when empty, small top-right button
                      when a clip exists. Click triggers file picker with
                      BPM-detect + main-video re-snap. */}
                  {t.kind === 'sync-audio' && (
                    <SyncAudioDropZone
                      track={{ id: t.id, kind: 'sync-audio' }}
                      existingClip={
                        clips.find((c) => c.trackId === t.id) ?? null
                      }
                      pxPerBeat={px}
                    />
                  )}
                </div>
              </div>
              {firstAutomationClip && (
                <MobileAutomationButton clipId={firstAutomationClip.id} />
              )}
              {expandedClip && (
                <div
                  className="relative border-b border-[var(--border)]"
                  style={{ width: TRACK_LABEL_WIDTH + totalBeats * px }}
                >
                  {/* Height is intentionally not fixed — the lane auto-grows
                      for N automated params (Sweep has two: speed + radius). */}
                  <AutomationLane clipId={expandedClip.id} pxPerBeat={px} />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

/**
 * Plan 9b — non-destructive ghost overlay during group-move/group-copy.
 * Renders one translucent rectangle per selected clip at its
 * (startBeat + deltaBeats) position. No store mutation happens until
 * the parent commits via moveSelectedClips / duplicateSelectedClips on
 * PointerUp.
 *
 * Track-Y resolution: per render we look up each clip's owning track
 * via getBoundingClientRect of its track-band DOM-element. Cheap
 * enough at typical track counts (≤20). No memoisation — pointermove
 * triggers a re-render via deltaBeats state.
 */
function GroupDragGhosts(props: {
  clipIds: readonly string[];
  deltaBeats: number;
  mode: GroupDragMode;
  px: number;
  clips: readonly import('@/lib/timeline/types').Clip[];
  tracks: readonly import('@/lib/timeline/types').Track[];
  labelWidth: number;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { clipIds, deltaBeats, mode, px, clips, rootRef, labelWidth } = props;
  const ids = new Set(clipIds);
  const root = rootRef.current;
  if (!root) return null;
  const rootRect = root.getBoundingClientRect();
  // Resolve each visible track-area DOM-element once.
  const trackEls = Array.from(
    root.querySelectorAll<HTMLDivElement>('[data-track-id]')
  );
  const trackTopById = new Map<string, { top: number; height: number }>();
  for (const el of trackEls) {
    const tid = el.getAttribute('data-track-id');
    if (!tid) continue;
    const r = el.getBoundingClientRect();
    trackTopById.set(tid, {
      top: r.top - rootRect.top,
      height: r.height
    });
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {clips
        .filter((c) => ids.has(c.id))
        .map((c) => {
          const band = trackTopById.get(c.trackId);
          if (!band) return null;
          // x = label-column-offset + (startBeat + delta) * px
          const x = labelWidth + (c.startBeat + deltaBeats) * px;
          const w = c.lengthBeats * px;
          // Inset by 4px vertically to mirror the clip's `top-1 bottom-1`.
          const top = band.top + 4;
          const height = band.height - 8;
          return (
            <div
              key={`ghost-${c.id}`}
              style={{
                position: 'absolute',
                left: x,
                top,
                width: w,
                height,
                border: `1px dashed ${mode === 'copy' ? '#5a8fff' : '#ff3b3b'}`,
                background:
                  mode === 'copy'
                    ? 'rgba(90,143,255,0.18)'
                    : 'rgba(255,59,59,0.18)',
                borderRadius: 4,
                opacity: 0.7
              }}
            />
          );
        })}
    </div>
  );
}
