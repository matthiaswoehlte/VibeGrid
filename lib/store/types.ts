import type { TimelineState, Clip } from '@/lib/timeline/types';

export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface TimelineActions {
  addClip(clip: Clip): void;
  moveClip(clipId: string, newStartBeat: number): void;
  resizeClip(clipId: string, newLengthBeats: number): void;
  removeClip(clipId: string): void;
  setClipParams(clipId: string, params: Record<string, unknown>): void;
  setPlayhead(beats: number): void;
  setMuted(trackId: string, muted: boolean): void;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
  timeline: TimelineState;
  timelineActions: TimelineActions;
}
