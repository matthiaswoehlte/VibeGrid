import { createFile, DataStream, Endianness, type ISOFile } from 'mp4box';
import { isClient } from '@/lib/utils/is-client';
import { videoBytesCache } from './bytes-cache';

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
 * Linear scan for the latest sample whose ts is at or below `target`.
 * Exported for unit testing without the full mp4box / WebCodecs setup.
 *
 * Linear (not binary search): with B-frames, mp4box delivers samples
 * in DECODE order but we store the COMPOSITION timestamp (`cts`) as
 * `ts` so the WebCodecs decoder emits matching VideoFrame timestamps.
 * That makes `samples[i].ts` non-monotonic (typical IBBP pattern:
 * I=0, B=2, B=3, P=1, ...). Binary search on non-monotonic data
 * returns nonsense — that was the root cause of the second-video
 * freeze in the smoke test. Linear scan is O(N) but N≤a few thousand
 * for typical videos; export latency unchanged.
 *
 * - Returns -1 if `samples` is empty.
 * - Returns the index of the FIRST (lowest-ts) sample when `target` is
 *   before any sample — gives the caller a sensible "preview" frame.
 * - Among samples with ts <= target, returns the one with the LATEST ts
 *   (in case of a tie on ts, the first occurrence wins — irrelevant for
 *   well-formed MP4s where ts values are unique).
 */
export function findSampleForTime(
  samples: ReadonlyArray<{ ts: number }>,
  target: number
): number {
  if (samples.length === 0) return -1;
  let bestIdx = -1;
  let bestTs = Number.NEGATIVE_INFINITY;
  let minIdx = 0;
  let minTs = samples[0].ts;
  for (let i = 0; i < samples.length; i++) {
    const ts = samples[i].ts;
    if (ts <= target && ts > bestTs) {
      bestTs = ts;
      bestIdx = i;
    }
    if (ts < minTs) {
      minTs = ts;
      minIdx = i;
    }
  }
  // target is before any sample — return the first-presented frame
  return bestIdx >= 0 ? bestIdx : minIdx;
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

    // Pull bytes from the shared cache. By the time Export is clicked
    // the live preview's VideoEngine has already streamed the file in —
    // this resolves synchronously with the cached ArrayBuffer instead
    // of triggering a second full R2 download.
    const arrayBuffer = await videoBytesCache.fetch(url, undefined, signal);
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
          // Diagnostic: dump key facts about the loaded video so
          // we can spot codec-specific issues (B-frames cause
          // non-monotonic ts; weird timescale → wrong mapping).
          const n = this.samples.length;
          const tsMin = n > 0 ? this.samples[0].ts : 0;
          const tsMax = n > 0 ? this.samples[n - 1].ts : 0;
          let monotonic = true;
          for (let i = 1; i < n; i++) {
            if (this.samples[i].ts < this.samples[i - 1].ts) {
              monotonic = false;
              break;
            }
          }
          // eslint-disable-next-line no-console
          console.log(
            `[VideoDecoderSource] loaded: codec=${this.codec} samples=${n} ` +
              `ts=${tsMin}..${tsMax}us (~${((tsMax - tsMin) / 1_000_000).toFixed(2)}s) ` +
              `monotonic=${monotonic} (B-frames if false) ` +
              `${this.codedWidth}x${this.codedHeight}`
          );
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

    // Quick cache hit — handles the common case AND the past-end loop
    // (caller keeps asking for frames past source duration; sampleIdx
    // clamps to last sample, the corresponding frame is already in
    // the queue from when we hit end-of-source). Crucial: this MUST
    // come before the backward-seek check, otherwise past-end queries
    // trigger a false backward seek (sampleIdx=N-1 < nextSampleIdx=N).
    const cachedExact = this.outputQueue.find((f) => f.timestamp === target.ts);
    if (cachedExact) return cachedExact;
    // If queue has a frame whose ts is past target, the predecessor
    // (or that very frame) is the answer — and we have it.
    const matchIdxQuick = this.outputQueue.findIndex(
      (f) => f.timestamp > target.ts
    );
    if (matchIdxQuick > 0) return this.outputQueue[matchIdxQuick - 1];

    // Backward seek — compare TIMESTAMPS not DTS indices.
    //
    // Old check compared `sampleIdx + 1 < this.nextSampleIdx` which is
    // wrong for B-frame videos: DTS order (the order chunks must be
    // fed to the decoder) differs from CTS order (presentation order).
    // For a typical IBBP GOP `samples[1].cts < samples[0].cts +
    // frameInterval`, so any target with cts < latest-fed-cts triggered
    // a false backward seek — every frame for B-frame videos.
    //
    // Correct semantic: "have we already DECODED past this target?"
    // Measured by the LATEST emitted frame's timestamp vs target's
    // timestamp. If latest emitted > target by more than one frame
    // worth (we use 100 ms slack for safety against rounding), we've
    // moved past it and need to rewind to a keyframe.
    //
    // For forward sequential access (the offline export's natural
    // pattern), latestEmittedTs grows monotonically and target.ts
    // also grows. The check never fires. Only real backward seeks
    // (user scrubbing back in a future timeline UI) trigger flush.
    const latestEmittedTs =
      this.outputQueue.length > 0
        ? this.outputQueue[this.outputQueue.length - 1].timestamp
        : Number.NEGATIVE_INFINITY;
    const BACKWARD_SLACK_US = 100_000; // 100 ms
    if (target.ts + BACKWARD_SLACK_US < latestEmittedTs) {
      // eslint-disable-next-line no-console
      console.log(
        `[VideoDecoderSource] backward seek (target ${target.ts}us << latest emitted ${latestEmittedTs}us) — flushing decoder`
      );
      await this.flushWithTimeout('backward-seek');
      while (this.outputQueue.length > 0) this.outputQueue.shift()!.close();
      // Rewind nextSampleIdx to the nearest preceding keyframe in DTS order.
      // For backward seek correctness we need to find a keyframe whose
      // ts (cts) is <= target.ts.
      let keyIdx = 0;
      let keyTs = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < this.samples.length; i++) {
        const s = this.samples[i];
        if (s.isKey && s.ts <= target.ts && s.ts > keyTs) {
          keyIdx = i;
          keyTs = s.ts;
        }
      }
      this.nextSampleIdx = keyIdx;
    }

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
        if (matchIdx > 0) return this.outputQueue[matchIdx - 1];
        return matchFrame;
      }

      // Feed more chunks if any remain. DON'T call decoder.flush() —
      // it hangs in some Chromium configurations (confirmed in the
      // wild, both backward-seek and end-of-source flush time out
      // at 3s and leave the decoder in a worse state than before).
      // Instead: if all chunks are fed and we still don't have target,
      // return the latest cached frame (decoder's natural emission
      // will fill the queue with any in-flight B-frames over the next
      // few yields; subsequent calls will see them).
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
      } else if (this.outputQueue.length > 0) {
        // All chunks fed, but queue has SOMETHING — return the latest
        // frame at-or-before target. Skip flush.
        return this.outputQueue[this.outputQueue.length - 1];
      }
      // else: all chunks fed AND queue empty — keep yielding so
      // decoder can emit final buffered frames naturally. After
      // MAX_WAIT_ITERATIONS we give up via the safety net below.

      await new Promise<void>((r) => setTimeout(r, 0));
    }

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

  /**
   * Plan 8d — reset the per-source decoder state without re-downloading
   * the file. Called at the start of every offline export so each render
   * begins with a deterministic, freshly-configured decoder. Without
   * this, the cross-export "first-call triggers backward seek + flush"
   * recovery path runs every export start; in some cases the recovery
   * mid-run becomes inconsistent (visible as a "video stuck on still
   * frame" mid-export after 5+ successful runs in the same page
   * session — observed once FX clips made per-frame time longer).
   *
   * Cost: ~50-200 ms per source (close decoder + reconfigure). Cheap
   * compared to re-fetching + re-demuxing the file (multi-second).
   */
  async reset(): Promise<void> {
    if (!this.decoder) return;
    // Flush so we don't leak in-flight decoded frames; race a tight
    // timeout in case flush() hangs (documented Chromium issue).
    try {
      await Promise.race([
        this.decoder.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, 500))
      ]);
    } catch {
      /* flush errors are non-fatal — proceed with reset */
    }
    for (const f of this.outputQueue) f.close();
    this.outputQueue = [];
    if (this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.nextSampleIdx = 0;
    // Re-configure a fresh decoder with the same codec+description
    // (preserved on `this`). Drops every frame that was buffered.
    this.configureDecoder();
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
  /**
   * Plan 8d — reset every loaded source's decoder so the next render
   * starts deterministic. Closes queued frames, re-creates each
   * VideoDecoder with the same codec config, rewinds `nextSampleIdx`
   * to 0. The demuxed sample list is preserved (no re-fetch). Safe to
   * call before each export.
   */
  resetAllSources(): Promise<void>;
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
    async resetAllSources() {
      await Promise.all(
        [...sources.values()].map((s) => s.reset())
      );
    },
    destroy() {
      for (const source of sources.values()) source.destroy();
      sources.clear();
      inProgress.clear();
    }
  };
}
