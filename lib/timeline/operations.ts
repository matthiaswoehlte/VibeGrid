export type OperationErrorCode =
  | 'OVERLAP'
  | 'CLIP_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'INVALID_LENGTH';

export class OperationError extends Error {
  readonly code: OperationErrorCode;

  constructor(code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'OperationError';
    this.code = code;
    Object.setPrototypeOf(this, OperationError.prototype);
  }
}
