/**
 * AAC's native frame size — also the standard chunk granularity for
 * WebCodecs AudioEncoder.encode(). At 48 kHz this is ~21 ms per chunk.
 */
export const FRAMES_PER_CHUNK = 1024;

/**
 * Walks a decoded AudioBuffer in fixed-size frame windows and yields
 * `(timestampUs, channels, frameCount)` tuples ready for AudioEncoder.encode().
 *
 * Pure generator — no DOM, no I/O. Per-channel Float32Array.subarray() views
 * share the underlying buffer, so this allocates O(numChannels) per chunk
 * regardless of audio length.
 *
 * The last chunk's `frameCount` is the remainder when the buffer length
 * isn't a multiple of FRAMES_PER_CHUNK — callers must read this rather than
 * assume FRAMES_PER_CHUNK so the muxer pads correctly.
 */
export function* chunkAudioBuffer(buffer: AudioBuffer): Generator<{
  timestampUs: number;
  channels: Float32Array[];
  frameCount: number;
}> {
  const totalFrames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const channelData = Array.from({ length: numChannels }, (_, i) =>
    buffer.getChannelData(i)
  );

  for (let frameOffset = 0; frameOffset < totalFrames; frameOffset += FRAMES_PER_CHUNK) {
    const frameCount = Math.min(FRAMES_PER_CHUNK, totalFrames - frameOffset);
    const timestampUs = Math.round((frameOffset / sampleRate) * 1_000_000);
    const channels = channelData.map((ch) =>
      ch.subarray(frameOffset, frameOffset + frameCount)
    );
    yield { timestampUs, channels, frameCount };
  }
}
