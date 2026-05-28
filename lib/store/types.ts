import type { TimelineState, Clip, TrackKind } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { MediaRef } from '@/lib/storage/types';
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';
import type { AutomationSnap } from '@/lib/automation/snap';
import type { ExportState } from '@/lib/export/types';
import type { MobileUIState, MobileUIActions } from './mobile-ui-slice';
import type { AppMode } from './app-mode-slice';
import type { HistoryState } from './history-types';
import type { RecordingSet } from './recording-set';
import type { SoundsState, SoundsActions } from './sounds-slice';

// Plan 10 — re-export so external callers (NewProjectButton,
// Transport, deserialize) can import without coupling to the
// recording-set module path.
export type { RecordingSet };

export interface UIState {
  zoom: number;
  /**
   * Plan 9b — primary selection state. `string[]` (not Set) so zustand's
   * default Object.is comparator stays effective and serialisation stays
   * trivial (would be `{}` for Set).
   *
   * `selectedClipId` (singular) below is a SYNCED COMPAT-FIELD kept in
   * lockstep with `selectedClipIds`:
   *   - selectedClipIds.length === 1 → selectedClipId = selectedClipIds[0]
   *   - else                          → selectedClipId = null
   * Every action that mutates `selectedClipIds` MUST update
   * `selectedClipId` in the same `set()` call. The compat field exists
   * so the 43 pre-Plan-9b consumers (Inspector, AutomationEditor,
   * Mobile InspectorSheet, etc.) don't need a coordinated rewrite.
   */
  selectedClipIds: string[];
  selectedClipId: string | null;
  /** Clip id whose AutomationEditorModal is currently open, or null when
   *  the modal is closed. Plan 5.5–5.6 called this `expandedAutomationClipId`
   *  and used it to toggle the now-removed inline interactive lane; Plan
   *  5.7-R repurposed it to drive the full-screen editor modal. The cleanup
   *  semantics (cleared on selectedClipId change + clip remove) are
   *  identical, so partialize-exclusion + selectedClipId/removeClip
   *  handling were carried over without change. */
  automationEditorClipId: string | null;
  automationSnap: AutomationSnap;
  /**
   * Plan 9b follow-up — global clip-snap resolution. Controls how new
   * drops, drag-moves, group-moves, and Shift+Arrow shifts snap to the
   * beat grid. Synced with localStorage `vg_clip_snap` for cross-session
   * persistence (write-through). Default '1' (one beat).
   *
   * Subscribers: `Tracks.tsx` (drop/move), `Ruler.tsx` + `Tracks.tsx`
   * grid-background (visualisation), `ClipSnapPicker.tsx` (selector UI).
   */
  clipSnap: AutomationSnap;
  exportState: ExportState;
  /** Hotfix: global Beat ↔ Flow toggle. When true, beat-triggered FX
   *  (Pulse flash, ZoomPulse scale, Particles burst) are suppressed and
   *  automation curves stretch over each clip's full length instead of
   *  being read in absolute beat coords. Transient — never persisted. */
  flowMode: boolean;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  /** Plan 8h — drag-and-drop across tracks of the same kind.
   *  UI gates by canDropOnTrack; the store operation is unconditional. */
  moveClipToTrack(clipId: string, newTrackId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
  /** Plan 5.9a/5.9c — dynamic multi-track actions. `addTrack('audio')`
   *  soft-rejects via toast (no throw) — Multi-Audio is parked for
   *  Plan 5.9d. The AddTrackButton picker only exposes image / video
   *  / fx. */
  /** Plan 9a — returns the generated track id so callers (e.g. the
   *  preset-pack store-bridge) can immediately reference the new track
   *  without an extra `tracks.find()` lookup. */
  addTrack(kind: TrackKind, label?: string): string;
  /** Removes a track. Throws if any clip has `trackId === id`. */
  removeTrack(trackId: string): void;
  /** Reorders `tracks[]` to match the given id sequence. Unknown ids are
   *  ignored, missing ids retain their relative order at the end. */
  reorderTracks(orderedIds: string[]): void;
  /** Plan 5.9a — inline label edit. */
  setTrackLabel(trackId: string, label: string): void;
  setClipParam(clipId: string, key: string, value: unknown): void;
  convertParamToAutomation(clipId: string, key: string, beat: number, initialValue?: unknown): void;
  convertParamToStatic(clipId: string, key: string): void;
  addParamPoint(clipId: string, key: string, point: AutomationPoint<unknown>): void;
  removeParamPoint(clipId: string, key: string, index: number): void;
  updateParamPoint(
    clipId: string,
    key: string,
    index: number,
    patch: Partial<AutomationPoint<unknown>>
  ): void;
  setParamInterpolation(clipId: string, key: string, interpolation: Interpolation): void;
  setBlendInterpolation(clipId: string, interpolation: Interpolation): void;
  updateParamPoints(
    clipId: string,
    key: string,
    updates: Array<{ index: number; beat?: number; value?: number }>
  ): void;
  /**
   * Plan 8d — wipe all tracks + clips. Used by the SceneFlow Transfer
   * flow to start with a clean Gantt chart before adding the new
   * main-video + sync-audio tracks and clips.
   */
  clearAllTracks(): void;
  /**
   * Plan 8d — re-snap the main-video clips after a BPM change. Mutates
   * only startBeat + lengthBeats on the matching clips (by mediaId);
   * clip.id stays stable so Undo/Redo + FX bindings + JSONB persistence
   * survive.
   */
  replaceMainVideoClips(
    layoutByMediaId: Map<string, { startBeat: number; lengthBeats: number }>
  ): void;
}

export interface AudioState {
  grid: BeatGrid;
}

export interface AudioActions {
  setBPM(bpm: number): void;
  setDetectedGrid(grid: BeatGrid): void;
  resetGrid(): void;
}

export interface MediaState {
  mediaRefs: MediaRef[];
  /** Plan 5.10+ — per-mediaId download progress for videos that the
   *  VideoEngine pre-fetches at page-load via the shared bytes cache.
   *  MediaLibrary reads this to render a progress bar under each
   *  video item. Transient (never persisted). */
  videoLoadProgress: Record<string, { received: number; total: number }>;
}

export interface MediaActions {
  addMediaRef(ref: MediaRef): void;
  removeMediaRef(id: string): void;
  getMediaRef(id: string): MediaRef | undefined;
  addMediaRefMeta(id: string, partial: Pick<MediaRef, 'width' | 'height' | 'duration'>): void;
  /** Plan 5.10+ — VideoEngine calls this from its bytes-cache progress
   *  callback so the MediaLibrary can render live download status. */
  setVideoLoadProgress(mediaId: string, received: number, total: number): void;
  /**
   * Plan 8d — remove every mediaRef whose URL is under the SceneFlow
   * R2 path for the given user+story. Called before clearAllTracks at
   * the start of a Transfer flow so re-transfer doesn't leak verwaiste
   * MediaRefs from the previous run.
   *
   * URL-prefix shape (from lib/sceneflow/fal-to-r2.ts:sceneflowR2Key):
   *   sceneflow/{userId}/{storyId}/{sceneId}/{kind}.{ext}
   * The R2 public URL is `${R2_PUBLIC_URL}/sceneflow/{userId}/{storyId}/...`.
   */
  purgeSceneflowMediaRefs(storyId: string, userId: string): void;
}

export interface AppState {
  ui: UIState;
  /** Plan 10 — bounded undo / redo history. Transient (never persisted). */
  history: HistoryState;
  /** Plan 10 — global recording-set action. External callers
   *  (NewProjectButton, Transport, deserialize) invoke via
   *  `useAppStore.getState().recordingSet(...)`. ESLint enforces that
   *  no direct `set()` / `useAppStore.setState()` calls bypass this. */
  recordingSet: RecordingSet;
  /** Plan 10 — pop one entry off `past`, push current state onto `future`. */
  undo(): void;
  /** Plan 10 — pop one entry off `future`, push current state onto `past`. */
  redo(): void;
  /** Plan 10 — wipe both past and future stacks. Called by
   *  `lib/project/deserialize.ts` after a successful project-load so
   *  Ctrl+Z doesn't reach across project boundaries. */
  clearHistory(): void;
  setZoom(zoom: number): void;
  setSelectedClipId(id: string | null): void;
  /** Plan 9b — replace the current selection with `ids`. Pass `[]` to clear. */
  selectClips(ids: string[]): void;
  /** Plan 9b — append `ids` to the current selection (dedup). */
  addToSelection(ids: string[]): void;
  /** Plan 9b — alias for `selectClips([])`. */
  clearSelection(): void;
  /** Plan 9b — group-shift every selected clip by `deltaBeats`. Atomic
   *  store mutation (one history entry). Guard: clamps so no clip goes
   *  below startBeat 0. */
  moveSelectedClips(deltaBeats: number): void;
  /** Plan 9b — group-resize every selected clip by `deltaBeats`. Each clip
   *  clamps independently to a 0.5-beat minimum (per architect decision L4). */
  resizeSelectedClips(deltaBeats: number, edge: 'start' | 'end'): void;
  /** Plan 9b — duplicate every selected clip at +offsetBeats. Automation
   *  curves are deep-cloned with the same beat offset. Returns the count
   *  of duplicated clips (skipped overlaps reported via toast). */
  duplicateSelectedClips(offsetBeats: number): number;
  /** Plan 9b — delete every selected clip in one mutation. */
  deleteSelectedClips(): void;
  setAutomationEditorClipId(clipId: string | null): void;
  setAutomationSnap(snap: AutomationSnap): void;
  setClipSnap(snap: AutomationSnap): void;
  setExportState(patch: Partial<ExportState>): void;
  setFlowMode(value: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
  media: MediaState;
  mediaActions: MediaActions;
  /** Plan 5.10 — Mobile-only UI state (active tab). Transient,
   *  excluded from `partialize`. See `lib/store/mobile-ui-slice.ts`. */
  mobileUI: MobileUIState;
  mobileUIActions: MobileUIActions;
  /** Plan 8a — top-level workspace mode (VibeGrid vs SceneFlow tab).
   *  Transient, excluded from `partialize`. See `lib/store/app-mode-slice.ts`. */
  appMode: AppMode;
  setAppMode(mode: AppMode): void;
  /** Plan 8.7 — Sound Library manifest + bootstrap state. Transient
   *  (manifest is fetched at app-start, never persisted to localStorage
   *  via partialize). See `lib/store/sounds-slice.ts`. */
  sounds: SoundsState;
  soundsActions: SoundsActions;
}
