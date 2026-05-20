import type { TimelineState, Clip } from '@/lib/timeline/types';
import type { BeatGrid } from '@/lib/audio/types';
import type { MediaRef } from '@/lib/storage/types';
import type { AutomationPoint, Interpolation } from '@/lib/automation/types';

export interface UIState {
  zoom: number;
  selectedClipId: string | null;
  expandedAutomationClipId: string | null;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
  setClipParam(clipId: string, key: string, value: unknown): void;
  convertParamToAutomation(clipId: string, key: string, beat: number): void;
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
  setExpandedAutomationClipId(clipId: string | null): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
  audio: AudioState;
  audioActions: AudioActions;
  media: MediaState;
  mediaActions: MediaActions;
}
