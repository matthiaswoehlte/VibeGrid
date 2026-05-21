import { fileTypeFromBuffer } from 'file-type';
import { MIME_WHITELIST, SIZE_LIMITS } from './types';

export type UploadValidationCode =
  | 'SIZE_EXCEEDED'
  | 'UNSUPPORTED_MIME'
  | 'UNDETECTABLE_TYPE';

export class UploadValidationError extends Error {
  readonly code: UploadValidationCode;
  constructor(code: UploadValidationCode, message: string) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
    Object.setPrototypeOf(this, UploadValidationError.prototype);
  }
}

export interface ValidationResult {
  mime: string;
  ext: string;
}

export async function validateUpload(
  bytes: Uint8Array,
  kind: 'image' | 'audio'
): Promise<ValidationResult> {
  // 1. Size cap first — cheaper than running file-type on huge buffers.
  if (bytes.byteLength > SIZE_LIMITS[kind]) {
    throw new UploadValidationError(
      'SIZE_EXCEEDED',
      `${kind} upload exceeds ${SIZE_LIMITS[kind]} bytes (got ${bytes.byteLength})`
    );
  }

  // 2. Magic-byte detection — never trust the browser's Content-Type.
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) {
    throw new UploadValidationError(
      'UNDETECTABLE_TYPE',
      'file-type could not identify the buffer'
    );
  }

  // 3. Whitelist match for the requested kind.
  const allowed = MIME_WHITELIST[kind] as readonly string[];
  if (!allowed.includes(detected.mime)) {
    throw new UploadValidationError(
      'UNSUPPORTED_MIME',
      `${detected.mime} is not allowed for kind=${kind} (whitelist: ${allowed.join(', ')})`
    );
  }

  return { mime: detected.mime, ext: detected.ext };
}
