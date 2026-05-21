export type ExportStatus =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'finalizing'
  | 'done'
  | 'error';

export type ExportWarning = 'performance-degraded' | 'tab-hidden';
export type ExportErrorCode =
  | 'no-audio'
  | 'no-image'
  | 'codec-unsupported'
  | 'recorder-failed'
  | 'render-failed';

/** Realtime = MediaRecorder + canvas.captureStream (Plan 6). Offline =
 *  WebCodecs frame-by-frame + muxer (Plan 6-R). The choice is auto-
 *  detected per browser; the UI renders different layouts per mode. */
export type ExportMode = 'realtime' | 'offline';

export interface ExportState {
  status: ExportStatus;
  mode: ExportMode;
  progress: number; // 0..1
  elapsedSeconds: number;
  totalSeconds: number;
  /** Offline only — current frame index in the render loop. */
  currentFrame?: number;
  /** Offline only — total output frame count = ceil(duration × fps). */
  totalFrames?: number;
  /** Offline only — estimated seconds until completion (rolling avg). */
  etaSeconds?: number;
  warning?: ExportWarning;
  errorCode?: ExportErrorCode;
  /** Human-readable codec label, set after pickCodec. Surfaces in the UI. */
  codecLabel?: string;
}

export interface ExportOptions {
  filename: string;
  mimeType: string;
  frameRate: 30 | 60;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}
