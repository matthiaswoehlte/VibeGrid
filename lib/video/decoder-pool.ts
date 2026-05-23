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

/** How many encoded chunks to feed per pass of the wait-for-output loop.
 *  Decoders typically have an internal lookahead of 4-16 chunks before
 *  they start emitting, so feeding in small batches and yielding lets
 *  the output callback fire reliably without overshooting too far. */
const FEED_BATCH_SIZE = 8;

/** Safety cap on the wait-for-output loop in getFrameAt. Each iteration
 *  yields to the event loop (~1 ms), so 500 iterations ≈ 500 ms max
 *  per frame. Real-world per-frame latency on a modern hardware decoder
 *  is 5-30 ms. */
const MAX_WAIT_ITERATIONS = 500;

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
  /** Frames emitted by the decoder, in presentation order. The output
   *  callback simply pushes; getFrameAt walks/evicts. Old approach
   *  (Map<ts, resolver>) didn't work because the decoder's lookahead
   *  meant the awaited resolver for a target timestamp often hit the
   *  per-frame timeout before its frame was emitted. Sequential queue
   *  matches how the decoder + sequential-export access pattern
   *  actually work. */
  private outputQueue: VideoFrame[] = [];
  private nextSampleIdx = 0;

  async load(url: string, signal?: AbortSignal): Promise<void> {
    if (!isClient()) throw new Error('VideoDecoderSource: client only');
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('VideoDecoder unavailable (WebCodecs required)');
    }

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(
        `VideoDecoderSource: fetch failed (${response.status} ${response.statusText})`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
        // Just push — getFrameAt walks the queue to find target + evict
        // pre-target frames. No timestamp matching here. Output order
        // is presentation order (cts), which matches what getFrameAt
        // expects.
        this.outputQueue.push(frame);
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
    const target = this.samples[sampleIdx];

    // Backward seek — flush, drop queue, rewind to preceding keyframe.
    // Rare on offline export (sequential frame iteration), can happen
    // on clip-trim manual scrubbing.
    if (sampleIdx < this.nextSampleIdx) {
      // eslint-disable-next-line no-console
      console.log('[VideoDecoderSource] backward seek — flushing decoder');
      await this.flushWithTimeout('backward-seek');
      while (this.outputQueue.length > 0) this.outputQueue.shift()!.close();
      let keyIdx = sampleIdx;
      while (keyIdx > 0 && !this.samples[keyIdx].isKey) keyIdx--;
      this.nextSampleIdx = keyIdx;
    }

    // Walk the queue, feeding more chunks and yielding to let outputs
    // accumulate. Exit when target frame is present OR we've fed all
    // remaining chunks and flushed.
    for (let iter = 0; iter < MAX_WAIT_ITERATIONS; iter++) {
      // Evict frames strictly before target while there's still a frame
      // at-or-before target to keep as the answer. This keeps memory
      // bounded as we walk forward through the video.
      while (
        this.outputQueue.length >= 2 &&
        this.outputQueue[1].timestamp <= target.ts
      ) {
        this.outputQueue.shift()!.close();
      }

      // Have we reached target?
      const matchIdx = this.outputQueue.findIndex((f) => f.timestamp >= target.ts);
      if (matchIdx >= 0) {
        const matchFrame = this.outputQueue[matchIdx];
        if (matchFrame.timestamp === target.ts) {
          return matchFrame;
        }
        // Decoder skipped past target (shouldn't happen with proper
        // sample feeding, but be defensive). Use the latest frame
        // before target if any, else the one after.
        if (matchIdx > 0) return this.outputQueue[matchIdx - 1];
        return matchFrame;
      }

      // Need more frames. Feed the next batch of chunks if any remain.
      if (this.nextSampleIdx < this.samples.length) {
        const batchEnd = Math.min(
          this.nextSampleIdx + FEED_BATCH_SIZE,
          this.samples.length
        );
        while (this.nextSampleIdx < batchEnd) {
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
      } else {
        // All chunks fed — force any remaining buffered output out.
        // eslint-disable-next-line no-console
        console.log(
          `[VideoDecoderSource] end-of-source flush at target ${target.ts}us (samples.length=${this.samples.length})`
        );
        await this.flushWithTimeout('end-of-source');
        const found = this.outputQueue.findIndex(
          (f) => f.timestamp >= target.ts
        );
        if (found >= 0) {
          const f = this.outputQueue[found];
          if (f.timestamp === target.ts) return f;
          if (found > 0) return this.outputQueue[found - 1];
          return f;
        }
        return this.outputQueue.length > 0
          ? this.outputQueue[this.outputQueue.length - 1]
          : null;
      }

      // Yield to event loop so decoder output callback can fire
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    // Safety net hit (decoder isn't producing output despite chunks fed).
    // eslint-disable-next-line no-console
    console.warn(
      `[VideoDecoderSource] gave up on frame at ${timeSec}s after ${MAX_WAIT_ITERATIONS} iterations`
    );
    return this.outputQueue.length > 0
      ? this.outputQueue[this.outputQueue.length - 1]
      : null;
  }

  destroy(): void {
    for (const f of this.outputQueue) f.close();
    this.outputQueue = [];
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close();
    }
    this.decoder = null;
    this.samples = [];
  }

  /** flush() is known to occasionally hang in some Chromium builds when
   *  the decoder is in an inconsistent state. Race against a timeout so
   *  the export doesn't freeze; if the timeout fires we proceed with
   *  whatever frames the decoder already emitted (drop the rest). */
  private async flushWithTimeout(reason: string): Promise<void> {
    if (!this.decoder) return;
    const FLUSH_TIMEOUT_MS = 3000;
    try {
      await Promise.race([
        this.decoder.flush(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`decoder.flush() timeout (${reason})`)),
            FLUSH_TIMEOUT_MS
          )
        )
      ]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[VideoDecoderSource] flush failed (${reason}):`,
        err instanceof Error ? err.message : err
      );
    }
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
   *  whether to retry or abort. Optional `signal` lets the caller
   *  abort a long-running fetch (e.g. user cancels the export
   *  during pre-load). */
  load(mediaId: string, url: string, signal?: AbortSignal): Promise<void>;
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
  // In-progress loads dedup: useVideoDecoderPool's reconciler may call
  // load() before the user-clicked Export does, and the export's own
  // pre-load shouldn't duplicate the fetch. Returning the same Promise
  // for concurrent callers prevents the orphan-source leak (two parallel
  // VideoDecoderSource instances, one overwritten in `sources`, the
  // other never close()'d).
  const inProgress = new Map<string, Promise<void>>();

  return {
    load(mediaId, url, signal) {
      if (sources.has(mediaId)) return Promise.resolve();
      const existing = inProgress.get(mediaId);
      if (existing) return existing;
      const source = new VideoDecoderSource();
      const promise = source.load(url, signal).then(
        () => {
          sources.set(mediaId, source);
          inProgress.delete(mediaId);
        },
        (err: unknown) => {
          source.destroy();
          inProgress.delete(mediaId);
          throw err;
        }
      );
      inProgress.set(mediaId, promise);
      return promise;
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
      inProgress.clear();
    }
  };
}
