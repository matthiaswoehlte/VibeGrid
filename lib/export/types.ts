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
  | 'recorder-failed';

export interface ExportState {
  status: ExportStatus;
  progress: number; // 0..1
  elapsedSeconds: number;
  totalSeconds: number;
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
