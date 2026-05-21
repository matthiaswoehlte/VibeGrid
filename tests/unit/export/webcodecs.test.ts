import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isWebCodecsSupported,
  pickVideoEncoderConfig,
  pickAudioEncoderConfig
} from '@/lib/export/webcodecs';

type Globalish = Record<string, unknown>;

interface MockSupportFn {
  (config: { codec: string }): Promise<{ supported: boolean; config: typeof config }>;
}

function installMocks(videoSupports: MockSupportFn, audioSupports: MockSupportFn) {
  (globalThis as Globalish).VideoEncoder = class {
    static isConfigSupported = vi.fn(videoSupports);
  };
  (globalThis as Globalish).AudioEncoder = class {
    static isConfigSupported = vi.fn(audioSupports);
  };
}

function clearMocks() {
  delete (globalThis as Globalish).VideoEncoder;
  delete (globalThis as Globalish).AudioEncoder;
}

beforeEach(clearMocks);
afterEach(clearMocks);

describe('isWebCodecsSupported', () => {
  it('true when both VideoEncoder and AudioEncoder are defined', () => {
    installMocks(
      async (c) => ({ supported: true, config: c }),
      async (c) => ({ supported: true, config: c })
    );
    expect(isWebCodecsSupported()).toBe(true);
  });

  it('false when VideoEncoder is missing', () => {
    (globalThis as Globalish).AudioEncoder = class {};
    expect(isWebCodecsSupported()).toBe(false);
  });

  it('false when AudioEncoder is missing', () => {
    (globalThis as Globalish).VideoEncoder = class {};
    expect(isWebCodecsSupported()).toBe(false);
  });
});

describe('pickVideoEncoderConfig', () => {
  it('prefers H.264 (avc1) MP4 when supported', async () => {
    installMocks(
      async (c) => ({ supported: c.codec.startsWith('avc1'), config: c }),
      async (c) => ({ supported: true, config: c })
    );
    const r = await pickVideoEncoderConfig(1920, 1080, 30);
    expect(r).not.toBeNull();
    expect(r!.config.codec).toMatch(/^avc1/);
    expect(r!.ext).toBe('mp4');
  });

  it('falls back to VP9 WebM when MP4 is rejected', async () => {
    installMocks(
      async (c) => ({ supported: c.codec.startsWith('vp09'), config: c }),
      async (c) => ({ supported: true, config: c })
    );
    const r = await pickVideoEncoderConfig(1920, 1080, 30);
    expect(r).not.toBeNull();
    expect(r!.config.codec).toMatch(/^vp09/);
    expect(r!.ext).toBe('webm');
  });

  it('returns null when neither codec is supported', async () => {
    installMocks(
      async (c) => ({ supported: false, config: c }),
      async (c) => ({ supported: true, config: c })
    );
    const r = await pickVideoEncoderConfig(1920, 1080, 30);
    expect(r).toBeNull();
  });

  it('returns null when WebCodecs is unavailable entirely', async () => {
    // No installMocks call → VideoEncoder undefined.
    const r = await pickVideoEncoderConfig(1920, 1080, 30);
    expect(r).toBeNull();
  });
});

describe('pickAudioEncoderConfig', () => {
  it('prefers AAC (mp4a.40.2) when supported', async () => {
    installMocks(
      async (c) => ({ supported: true, config: c }),
      async (c) => ({ supported: c.codec === 'mp4a.40.2', config: c })
    );
    const r = await pickAudioEncoderConfig(48000, 2);
    expect(r).not.toBeNull();
    expect(r!.codec).toBe('mp4a.40.2');
  });

  it('falls back to Opus when AAC is rejected', async () => {
    installMocks(
      async (c) => ({ supported: true, config: c }),
      async (c) => ({ supported: c.codec === 'opus', config: c })
    );
    const r = await pickAudioEncoderConfig(48000, 2);
    expect(r).not.toBeNull();
    expect(r!.codec).toBe('opus');
  });
});
