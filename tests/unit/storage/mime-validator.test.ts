import { describe, it, expect } from 'vitest';
import { validateUpload, UploadValidationError } from '@/lib/storage/mime-validator';
import { jpegBytes, pngBytes, webpBytes, mp3Bytes, wavBytes, m4aBytes, bogusBytes, gifBytes } from './_fixtures';

describe('validateUpload — images', () => {
  it('accepts JPEG and returns mime + ext', async () => {
    const r = await validateUpload(jpegBytes(), 'image');
    expect(r.mime).toBe('image/jpeg');
    expect(r.ext).toBe('jpg');
  });

  it('accepts PNG', async () => {
    const r = await validateUpload(pngBytes(), 'image');
    expect(r.mime).toBe('image/png');
    expect(r.ext).toBe('png');
  });

  it('accepts WebP', async () => {
    const r = await validateUpload(webpBytes(), 'image');
    expect(r.mime).toBe('image/webp');
  });

  it('rejects audio bytes when image is expected', async () => {
    await expect(validateUpload(mp3Bytes(), 'image')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects bogus content', async () => {
    await expect(validateUpload(bogusBytes(), 'image')).rejects.toBeInstanceOf(
      UploadValidationError
    );
  });
});

describe('validateUpload — audio', () => {
  it('accepts MP3', async () => {
    const r = await validateUpload(mp3Bytes(), 'audio');
    expect(r.mime).toBe('audio/mpeg');
  });

  it('accepts WAV (any of audio/wav, audio/vnd.wave, audio/x-wav)', async () => {
    // file-type@19 returns `audio/vnd.wave` for RIFF/WAVE bytes; older versions
    // returned `audio/wav`. Assert the family, not a single string — see the
    // MIME_WHITELIST comment in types.ts for the rationale.
    const r = await validateUpload(wavBytes(), 'audio');
    expect(['audio/wav', 'audio/vnd.wave', 'audio/x-wav']).toContain(r.mime);
  });

  it('accepts M4A (audio/x-m4a or audio/mp4)', async () => {
    // file-type@19 returns `audio/x-m4a` for the M4A ftyp box; older versions
    // returned `audio/mp4`. Whitelist accepts both — assert the family.
    const r = await validateUpload(m4aBytes(), 'audio');
    expect(['audio/mp4', 'audio/x-m4a']).toContain(r.mime);
  });

  it('rejects image bytes when audio is expected', async () => {
    await expect(validateUpload(jpegBytes(), 'audio')).rejects.toBeInstanceOf(
      UploadValidationError
    );
  });
});

describe('validateUpload — size cap', () => {
  it('rejects an oversize image (> 20 MB)', async () => {
    const oversize = new Uint8Array(20 * 1024 * 1024 + 1);
    oversize.set(jpegBytes(), 0);
    await expect(validateUpload(oversize, 'image')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects an oversize audio (> 50 MB)', async () => {
    const oversize = new Uint8Array(50 * 1024 * 1024 + 1);
    oversize.set(mp3Bytes(), 0);
    await expect(validateUpload(oversize, 'audio')).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('error carries an UNSUPPORTED_MIME discriminator for detected-but-disallowed types', async () => {
    // GIF is detected by file-type (so the UNDETECTABLE_TYPE branch is skipped)
    // but is NOT in the image whitelist — exercises UNSUPPORTED_MIME specifically.
    try {
      await validateUpload(gifBytes(), 'image');
      throw new Error('expected validateUpload to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UploadValidationError);
      expect((e as UploadValidationError).code).toBe('UNSUPPORTED_MIME');
    }
  });

  it('error carries an UNDETECTABLE_TYPE discriminator for unrecognised bytes', async () => {
    try {
      await validateUpload(bogusBytes(), 'image');
      throw new Error('expected validateUpload to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UploadValidationError);
      expect((e as UploadValidationError).code).toBe('UNDETECTABLE_TYPE');
    }
  });
});
