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
 *  WAV ships with three historical MIME aliases — `audio/wav` is the de-facto
 *  browser-shipped value, `audio/vnd.wave` is the IANA-registered value that
 *  `file-type@^19` returns, and `audio/x-wav` is the legacy Microsoft alias.
 *  All three map to the same RIFF/WAVE payload — accept all so the whitelist
 *  is not coupled to a single library version. */
export const MIME_WHITELIST = {
  image: ['image/jpeg', 'image/png', 'image/webp'] as const,
  audio: ['audio/mpeg', 'audio/wav', 'audio/vnd.wave', 'audio/x-wav', 'audio/mp4'] as const
} as const satisfies Record<MediaKind, readonly string[]>;
