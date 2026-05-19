export type MediaKind = 'image' | 'audio';

export interface MediaRef {
  id: string;
  kind: MediaKind;
  url: string;
  filename: string;
  width?: number;
  height?: number;
  duration?: number;
  uploadedAt: string; // ISO 8601
}

export interface StorageAdapter {
  uploadImage(file: File): Promise<MediaRef>;
  uploadAudio(file: File): Promise<MediaRef>;
}

/** Size caps per spec §7.1 (bytes). */
export const SIZE_LIMITS = {
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024
} as const satisfies Record<MediaKind, number>;

/** Whitelisted MIME types per kind (spec §7.1).
 *  Defensive widening — file-type's exact MIME string for the same payload
 *  varies across versions:
 *    - WAV: `audio/wav` (file-type@19.6 + most browsers), `audio/vnd.wave`
 *      (IANA), `audio/x-wav` (legacy Microsoft) — all RIFF/WAVE.
 *    - M4A: `audio/x-m4a` (file-type's Apple-specific) vs `audio/mp4` (generic
 *      MP4 container) — same `ftyp` box. */
export const MIME_WHITELIST = {
  image: ['image/jpeg', 'image/png', 'image/webp'] as const,
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/vnd.wave',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a'
  ] as const
} as const satisfies Record<MediaKind, readonly string[]>;
