/**
 * Minimal magic-byte prefixes for `file-type` detection. Each helper returns
 * a Uint8Array padded out so `fileTypeFromBuffer` has enough bytes to identify.
 */

function pad(prefix: number[], targetLen = 64): Uint8Array {
  const buf = new Uint8Array(targetLen);
  buf.set(prefix);
  return buf;
}

// JPEG: FF D8 FF E0 ... 'JFIF'
export function jpegBytes(): Uint8Array {
  return pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

// PNG: 89 50 4E 47 0D 0A 1A 0A
export function pngBytes(): Uint8Array {
  return pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

// WebP: 'RIFF' .... 'WEBP'
export function webpBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  buf.set([0x20, 0x00, 0x00, 0x00], 4); // size (arbitrary)
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  buf.set([0x56, 0x50, 0x38, 0x20], 12); // VP8 (space)
  return buf;
}

// MP3 (with ID3v2 tag): 'ID3' .. 03 00 00 ..
export function mp3Bytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 0);
  return buf;
}

// WAV: 'RIFF' .... 'WAVE'
export function wavBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  buf.set([0x20, 0x00, 0x00, 0x00], 4);
  buf.set([0x57, 0x41, 0x56, 0x45], 8);
  buf.set([0x66, 0x6d, 0x74, 0x20], 12);
  return buf;
}

// MP4 audio (ftyp box, 'M4A '): 00 00 00 20 'ftyp' 'M4A '
export function m4aBytes(): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set([0x00, 0x00, 0x00, 0x20], 0);
  buf.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  buf.set([0x4d, 0x34, 0x41, 0x20], 8); // 'M4A '
  buf.set([0x00, 0x00, 0x00, 0x00], 12);
  buf.set([0x4d, 0x34, 0x41, 0x20], 16); // compat brand
  return buf;
}

// Bogus content masquerading as image — payload starts with 'NOTAFILE'
export function bogusBytes(): Uint8Array {
  return pad([0x4e, 0x4f, 0x54, 0x41, 0x46, 0x49, 0x4c, 0x45]);
}
