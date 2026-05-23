import { createFile, DataStream, Endianness, type ISOFile } from 'mp4box';
import { isClient } from '@/lib/utils/is-client';

/**
 * Plan 5.10+ offline-export-only video frame source.
 *
 * Replaces the HTMLVideoElement-based seek-and-draw pipeline (which
 * was fragile against modern Chromium compositor optimisations — see
 * dev_runtime_gotchas) with a WebCodecs `VideoDecoder` fed by the
 * mp4box.js demuxer. No DOM, no <video> element, no compositor
 * involvement. Frames come out of the decoder pipeline in decode
 * order; consumers ask for the frame at a wall-clock timestamp and
 * receive the closest preceding decoded VideoFrame.
 *
 * Live preview is unaffected — `lib/video/engine.ts` still owns the
 * <video> pool there. The two systems coexist (different consumers,
 * different access patterns).
 */

interface EncodedSample {
  /** Microseconds — matches EncodedVideoChunk.timestamp + VideoFrame.timestamp. */
  ts: number;
  duration: number;
  data: Uint8Array;
  isKey: boolean;
}

interface CachedFrame {
  ts: number;
  frame: VideoFrame;
}

/** Sliding-window cap. 8 frames * ~8 MB at 1080p = ~64 MB per video. Sufficient
 *  for sequential export access; backward jumps trigger a flush + re-decode
 *  from the nearest preceding keyframe. */
const CACHE_SIZE = 8;

/** Hard timeout per getFrameAt — if the decoder silently stalls we don't want
 *  the export to hang forever. 2 s is plenty for a single frame even on
 *  slow hardware; in practice frames arrive in 1-20 ms. */
const FRAME_TIMEOUT_MS = 2000;

/**
 * Binary search for the latest sample whose ts is at or below `target`.
 * Exported for unit testing without the full mp4box / WebCodecs setup.
 *
 * - Returns -1 if `samples` is empty.
 * - Returns 0 if `target` is before the first sample (use the first frame
 *   as a sensible "preview" of the source).
 */
export function findSampleForTime(samples: ReadonlyArray<{ ts: number }>, target: number): number {
  if (samples.length === 0) return -1;
  if (target < samples[0].ts) return 0;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (samples[mid].ts <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

class VideoDecoderSource {
  private samples: EncodedSample[] = [];
  private codec = '';
  private description?: Uint8Array;
  private codedWidth = 0;
  private codedHeight = 0;
  private decoder: VideoDecoder | null = null;
  private cache: CachedFrame[] = [];
  private nextSampleIdx = 0;
  private pendingResolvers = new Map<number, (frame: VideoFrame) => void>();

  async load(url: string): Promise<void> {
    if (!isClient()) throw new Error('VideoDecoderSource: client only');
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('VideoDecoder unavailable (WebCodecs required)');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `VideoDecoderSource: fetch failed (${response.status} ${response.statusText})`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    await this.demux(arrayBuffer);
    this.configureDecoder();
  }

  private demux(arrayBuffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createFile();
      let trackId = -1;
      let timescale = 0;
      let resolved = false;

      file.onReady = (info) => {
        const track = info.videoTracks?.[0];
        if (!track) {
          reject(new Error('VideoDecoderSource: no video track in MP4'));
          return;
        }
        trackId = track.id;
        timescale = track.timescale;
        this.codec = track.codec;
        this.codedWidth = track.video?.width ?? track.track_width ?? 0;
        this.codedHeight = track.video?.height ?? track.track_height ?? 0;
        this.description = extractDescription(file, trackId);
        if (!this.description) {
          reject(
            new Error('VideoDecoderSource: codec config (avcC/hvcC) not found')
          );
          return;
        }
        // null user — we don't need to thread anything through. The cast
        // matches mp4box's loose TSampleUser generic.
        file.setExtractionOptions(trackId, null as never, { nbSamples: 1_000_000 });
        file.start();
      };

      file.onSamples = (id, _user, samples) => {
        if (id !== trackId) return;
        for (const s of samples) {
          if (!s.data) continue;
          this.samples.push({
            ts: Math.round((s.cts / timescale) * 1_000_000),
            duration: Math.round((s.duration / timescale) * 1_000_000),
            // Copy bytes so mp4box can recycle its internal buffers.
            data: new Uint8Array(s.data),
            isKey: s.is_sync
          });
        }
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      file.onError = (_module, message) => {
        if (!resolved) reject(new Error(`MP4 demux error: ${message}`));
      };

      const buf = arrayBuffer as ArrayBuffer & { fileStart?: number };
      buf.fileStart = 0;
      file.appendBuffer(buf as never);
      file.flush();
    });
  }

  private configureDecoder(): void {
    this.decoder = new VideoDecoder({
      output: (frame) => {
        const ts = frame.timestamp;
        this.cache.push({ ts, frame });
        while (this.cache.length > CACHE_SIZE) {
          const evicted = this.cache.shift();
          evicted?.frame.close();
        }
        const resolver = this.pendingResolvers.get(ts);
        if (resolver) {
          this.pendingResolvers.delete(ts);
          resolver(frame);
        }
      },
      error: (e) => {
        // eslint-disable-next-line no-console
        console.error('[VideoDecoderSource] decoder error:', e);
      }
    });
    this.decoder.configure({
      codec: this.codec,
      codedWidth: this.codedWidth,
      codedHeight: this.codedHeight,
      description: this.description
    });
  }

  async getFrameAt(timeSec: number): Promise<VideoFrame | null> {
    if (!this.decoder || this.samples.length === 0) return null;
    const targetTs = Math.round(timeSec * 1_000_000);
    const sampleIdx = findSampleForTime(this.samples, targetTs);
    if (sampleIdx < 0) return null;
    const sample = this.samples[sampleIdx];

    // Cache hit: return immediately.
    const cached = this.cache.find((c) => c.ts === sample.ts);
    if (cached) return cached.frame;

    // Backward seek — flush and rewind to the nearest preceding keyframe.
    // (Rare in offline export; the loop iterates forward.)
    if (sampleIdx < this.nextSampleIdx) {
      await this.decoder.flush();
      for (const c of this.cache) c.frame.close();
      this.cache = [];
      let keyIdx = sampleIdx;
      while (keyIdx > 0 && !this.samples[keyIdx].isKey) keyIdx--;
      this.nextSampleIdx = keyIdx;
    }

    // Set up the waiter BEFORE feeding chunks so we don't miss the output.
    const framePromise = new Promise<VideoFrame>((resolve) => {
      this.pendingResolvers.set(sample.ts, resolve);
    });

    while (this.nextSampleIdx <= sampleIdx) {
      const s = this.samples[this.nextSampleIdx];
      this.decoder.decode(
        new EncodedVideoChunk({
          type: s.isKey ? 'key' : 'delta',
          timestamp: s.ts,
          duration: s.duration,
          data: s.data
        })
      );
      this.nextSampleIdx++;
    }

    // If we just fed the last sample, force a flush so the decoder emits
    // any buffered B-frames.
    if (this.nextSampleIdx >= this.samples.length) {
      await this.decoder.flush();
    }

    // Race against a timeout so a silently-stalled decoder doesn't hang
    // the entire export.
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), FRAME_TIMEOUT_MS)
    );
    const result = await Promise.race([framePromise, timeout]);
    if (result === null) {
      // Clean up the dangling resolver to avoid a leak.
      this.pendingResolvers.delete(sample.ts);
    }
    return result;
  }

  destroy(): void {
    for (const c of this.cache) c.frame.close();
    this.cache = [];
    this.pendingResolvers.clear();
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close();
    }
    this.decoder = null;
    this.samples = [];
  }
}

/** Extract the codec config (avcC for H.264, hvcC for H.265, etc.) from
 *  the mp4box file's track sample-description entries. The bytes are
 *  what VideoDecoder.configure expects in its `description` field. */
function extractDescription(
  file: ISOFile,
  trackId: number
): Uint8Array | undefined {
  const trak = (file as unknown as {
    getTrackById(id: number): { mdia?: { minf?: { stbl?: { stsd?: { entries?: Array<Record<string, unknown>> } } } } } | undefined;
  }).getTrackById(trackId);
  if (!trak) return undefined;
  const entries = trak.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries) return undefined;
  for (const entry of entries) {
    const box =
      (entry.avcC as { write(s: DataStream): void } | undefined) ||
      (entry.hvcC as { write(s: DataStream): void } | undefined) ||
      (entry.vpcC as { write(s: DataStream): void } | undefined) ||
      (entry.av1C as { write(s: DataStream): void } | undefined);
    if (box) {
      const stream = new DataStream(
        undefined as never,
        0,
        Endianness.BIG_ENDIAN
      );
      box.write(stream);
      // The mp4box box.write() output begins with the 8-byte box header
      // (size + 4-char type). VideoDecoder.description wants the payload
      // only, so we slice past those 8 bytes.
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return undefined;
}

// ============================================================================

export interface VideoDecoderPool {
  /** Fetch + demux + configure the decoder for `url`. Idempotent per
   *  `mediaId`. Throws on fetch/demux/codec failure — caller decides
   *  whether to retry or abort. */
  load(mediaId: string, url: string): Promise<void>;
  /**
   * Returns the latest VideoFrame whose timestamp is at or before
   * `timeSec`. The frame is OWNED by the pool — the caller may pass it
   * to `drawImage` immediately but MUST NOT retain it past the next
   * `getFrameAt` call (the sliding cache may close it). Returns null
   * when the mediaId isn't loaded or the decoder couldn't produce a
   * frame within the per-frame timeout.
   */
  getFrameAt(mediaId: string, timeSec: number): Promise<VideoFrame | null>;
  /** mediaIds for which load() has succeeded. */
  loadedIds(): string[];
  /** Close every cached frame, close every decoder. Idempotent. */
  destroy(): void;
}

export function createVideoDecoderPool(): VideoDecoderPool | null {
  if (!isClient()) return null;
  if (typeof VideoDecoder === 'undefined') return null;

  const sources = new Map<string, VideoDecoderSource>();

  return {
    async load(mediaId, url) {
      if (sources.has(mediaId)) return;
      const source = new VideoDecoderSource();
      try {
        await source.load(url);
        sources.set(mediaId, source);
      } catch (err) {
        source.destroy();
        throw err;
      }
    },
    async getFrameAt(mediaId, timeSec) {
      const source = sources.get(mediaId);
      if (!source) return null;
      return source.getFrameAt(timeSec);
    },
    loadedIds() {
      return [...sources.keys()];
    },
    destroy() {
      for (const source of sources.values()) source.destroy();
      sources.clear();
    }
  };
}
