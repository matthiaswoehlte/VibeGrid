import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVideoExporter } from '@/lib/export/recorder';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import type { ExportState } from '@/lib/export/types';
import type { TimelineState } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';

// Minimal canvas stub — jsdom doesn't ship captureStream.
function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).captureStream = vi.fn((_fps?: number) =>
    ({ getVideoTracks: () => [{ kind: 'video' }] }) as unknown as MediaStream
  );
  return c;
}

type EngineStub = Parameters<typeof createVideoExporter>[0]['audioEngine'];

function makeAudioEngine(stream: MediaStream | null = { id: 'audio-stream' } as MediaStream): EngineStub {
  return {
    getAudioStream: () => (stream
      ? ({ ...stream, getAudioTracks: () => [{ kind: 'audio' }] } as unknown as MediaStream)
      : null),
    getAudioElement: () => null,
    getState: () => ({ status: 'ready', currentTime: 0, duration: 60, beatGrid: {} as never }),
    pause: vi.fn(),
    play: vi.fn(),
    seek: vi.fn()
  } as unknown as EngineStub;
}

const audioMediaRef: MediaRef = {
  id: 'a1',
  url: 'blob:audio',
  kind: 'audio',
  filename: 'song.mp3',
  size: 1,
  uploadedAt: 0,
  duration: 60
};

const timelineWithImage: TimelineState = {
  tracks: [{ id: 'track-image', kind: 'image', name: 'Image', muted: false, order: 0 }],
  clips: [
    {
      id: 'img1',
      trackId: 'track-image',
      kind: 'image',
      mediaId: 'img-media',
      startBeat: 0,
      lengthBeats: 256,
      label: 'cover.jpg'
    }
  ],
  playhead: { beats: 0, playing: false },
  zoom: 1,
  snap: 'beat'
};

const timelineEmpty: TimelineState = {
  ...timelineWithImage,
  clips: []
};

let states: ExportState[];
const setExportState = vi.fn((patch: Partial<ExportState>) => {
  const last = states[states.length - 1] ?? EXPORT_INITIAL_STATE;
  states.push({ ...last, ...patch });
});

beforeEach(() => {
  states = [EXPORT_INITIAL_STATE];
  setExportState.mockClear();
});

describe('VideoExporter — pre-checks + start', () => {
  it('start with all pre-checks satisfied transitions to recording', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    expect(states.some((s) => s.status === 'preparing')).toBe(true);
    expect(states.some((s) => s.status === 'recording')).toBe(true);
    expect(states[states.length - 1].codecLabel).toContain('VP9');
  });

  it('start without audio MediaRef → status=error, errorCode=no-audio', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => null,
      setExportState
    });
    await exp!.start();
    const last = states[states.length - 1];
    expect(last.status).toBe('error');
    expect(last.errorCode).toBe('no-audio');
  });

  it('start without an active image clip → status=error, errorCode=no-image', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(),
      getTimeline: () => timelineEmpty,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    const last = states[states.length - 1];
    expect(last.status).toBe('error');
    expect(last.errorCode).toBe('no-image');
  });

  it('start without an audio stream from the engine → status=error', async () => {
    const exp = createVideoExporter({
      canvas: makeCanvas(),
      audioEngine: makeAudioEngine(null),
      getTimeline: () => timelineWithImage,
      getAudioMediaRef: () => audioMediaRef,
      setExportState
    });
    await exp!.start();
    expect(states[states.length - 1].status).toBe('error');
  });

  it('codec-fallback picks vp8 when vp9 is unsupported', async () => {
    const orig = (
      globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } }
    ).MediaRecorder.isTypeSupported;
    (
      globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } }
    ).MediaRecorder.isTypeSupported = (t: string) => !t.includes('vp9');
    try {
      const exp = createVideoExporter({
        canvas: makeCanvas(),
        audioEngine: makeAudioEngine(),
        getTimeline: () => timelineWithImage,
        getAudioMediaRef: () => audioMediaRef,
        setExportState
      });
      await exp!.start();
      expect(states[states.length - 1].codecLabel).toContain('VP8');
    } finally {
      (
        globalThis as { MediaRecorder: { isTypeSupported: (t: string) => boolean } }
      ).MediaRecorder.isTypeSupported = orig;
    }
  });
});
