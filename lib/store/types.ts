import type { TimelineState, Clip, TrackKind } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { MediaRef } from '@/lib/storage/types';
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';
import type { AutomationSnap } from '@/lib/automation/snap';
import type { ExportState } from '@/lib/export/types';

export interface UIState {
  zoom: number;
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
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
  /** Plan 5.9a — dynamic multi-track actions. `addTrack('audio')` throws
   *  at runtime; UI must call this only with kinds returned by the
   *  "add track" picker (which excludes 'audio'). */
  addTrack(kind: TrackKind, label?: string): void;
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
}

export interface MediaActions {
  addMediaRef(ref: MediaRef): void;
  removeMediaRef(id: string): void;
  getMediaRef(id: string): MediaRef | undefined;
  addMediaRefMeta(id: string, partial: Pick<MediaRef, 'width' | 'height' | 'duration'>): void;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setSelectedClipId(id: string | null): void;
  setAutomationEditorClipId(clipId: string | null): void;
  setAutomationSnap(snap: AutomationSnap): void;
  setExportState(patch: Partial<ExportState>): void;
  setFlowMode(value: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
  media: MediaState;
  mediaActions: MediaActions;
}
