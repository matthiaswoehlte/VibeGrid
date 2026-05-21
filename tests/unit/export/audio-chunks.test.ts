import { describe, it, expect } from 'vitest';
import { chunkAudioBuffer, FRAMES_PER_CHUNK } from '@/lib/export/audio-chunks';

function makeBuffer(sampleRate: number, channels: number, frames: number): AudioBuffer {
  const data = Array.from(
    { length: channels },
    (_, c) => new Float32Array(frames).map((_v, i) => c * 0.1 + i * 0.001)
  );
  return {
    sampleRate,
    length: frames,
    duration: frames / sampleRate,
    numberOfChannels: channels,
    getChannelData: (i: number) => data[i]
  } as unknown as AudioBuffer;
}

describe('chunkAudioBuffer', () => {
  it('emits ceil(length / FRAMES_PER_CHUNK) chunks for non-multiple lengths', () => {
    const buf = makeBuffer(48000, 2, FRAMES_PER_CHUNK * 3 + 100);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks.length).toBe(4);
  });

  it('emits exactly N chunks for length = N * FRAMES_PER_CHUNK', () => {
    const buf = makeBuffer(48000, 2, FRAMES_PER_CHUNK * 5);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks.length).toBe(5);
    // Every chunk is full-size — no short last frame.
    for (const c of chunks) expect(c.frameCount).toBe(FRAMES_PER_CHUNK);
  });

  it('timestamps start at 0 and rise monotonically per chunk', () => {
    const buf = makeBuffer(48000, 1, FRAMES_PER_CHUNK * 3);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks[0].timestampUs).toBe(0);
    // Compute expected exactly the way the implementation does — round per
    // frameOffset, not by multiplying a single step (frameRate/sampleRate
    // isn't integer, so round(2×step) ≠ 2×round(step)).
    for (let i = 1; i < chunks.length; i++) {
      const expected = Math.round(((i * FRAMES_PER_CHUNK) / 48000) * 1_000_000);
      expect(chunks[i].timestampUs).toBe(expected);
      expect(chunks[i].timestampUs).toBeGreaterThan(chunks[i - 1].timestampUs);
    }
  });

  it('last chunk frameCount equals the remainder when length is not a multiple', () => {
    const buf = makeBuffer(48000, 2, FRAMES_PER_CHUNK * 2 + 137);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks[chunks.length - 1].frameCount).toBe(137);
  });

  it('handles mono buffers (numberOfChannels = 1)', () => {
    const buf = makeBuffer(44100, 1, FRAMES_PER_CHUNK + 5);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks.length).toBe(2);
    expect(chunks[0].channels.length).toBe(1);
    expect(chunks[1].channels.length).toBe(1);
  });

  it('handles stereo buffers and returns a Float32Array per channel sized to frameCount', () => {
    const buf = makeBuffer(48000, 2, FRAMES_PER_CHUNK + 50);
    const chunks = [...chunkAudioBuffer(buf)];
    expect(chunks[0].channels.length).toBe(2);
    expect(chunks[0].channels[0].length).toBe(FRAMES_PER_CHUNK);
    expect(chunks[0].channels[1].length).toBe(FRAMES_PER_CHUNK);
    expect(chunks[1].channels[0].length).toBe(50);
    expect(chunks[1].channels[1].length).toBe(50);
  });
});
