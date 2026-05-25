import { describe, it, expect } from 'vitest';
import { computeNextGenerationStep } from '@/lib/sceneflow/scene-state';

interface PartialScene {
  type: 'action' | 'dialog' | 'endcard';
  audio_type: 'none' | 'voiceover' | 'lipsync';
  image_url: string | null;
  audio_url: string | null;
  video_url: string | null;
  neutral_video_url: string | null;
}

const action = (overrides: Partial<PartialScene> = {}): PartialScene => ({
  type: 'action',
  audio_type: 'none',
  image_url: null,
  audio_url: null,
  video_url: null,
  neutral_video_url: null,
  ...overrides
});

const dialog = (overrides: Partial<PartialScene> = {}): PartialScene => ({
  type: 'dialog',
  audio_type: 'lipsync',
  image_url: null,
  audio_url: null,
  video_url: null,
  neutral_video_url: null,
  ...overrides
});

describe('computeNextGenerationStep', () => {
  it('image_url === null → "image"', () => {
    expect(computeNextGenerationStep(action())).toBe('image');
  });

  it('audio_url === null AND audio_type !== "none" → "audio"', () => {
    const sc = dialog({
      image_url: 'https://r2.example/img.jpg',
      audio_type: 'voiceover'
    });
    expect(computeNextGenerationStep(sc)).toBe('audio');
  });

  it('audio_type === "none" skips the audio step entirely', () => {
    const sc = action({
      image_url: 'https://r2.example/img.jpg',
      audio_url: null,
      audio_type: 'none'
    });
    expect(computeNextGenerationStep(sc)).toBe('lipsync');
  });

  it('dialog with image + audio but no neutral_video → "neutral_video"', () => {
    const sc = dialog({
      image_url: 'https://r2.example/img.jpg',
      audio_url: 'https://r2.example/a.mp3',
      neutral_video_url: null,
      video_url: null
    });
    expect(computeNextGenerationStep(sc)).toBe('neutral_video');
  });

  it('dialog with neutral_video set but no video_url → "lipsync"', () => {
    const sc = dialog({
      image_url: 'https://r2.example/img.jpg',
      audio_url: 'https://r2.example/a.mp3',
      neutral_video_url: 'https://r2.example/nv.mp4',
      video_url: null
    });
    expect(computeNextGenerationStep(sc)).toBe('lipsync');
  });

  it('all URLs set → "done"', () => {
    const sc = dialog({
      image_url: 'https://r2.example/img.jpg',
      audio_url: 'https://r2.example/a.mp3',
      neutral_video_url: 'https://r2.example/nv.mp4',
      video_url: 'https://r2.example/v.mp4'
    });
    expect(computeNextGenerationStep(sc)).toBe('done');
  });

  it('endcard → "done" immediately, ignores all URL fields', () => {
    expect(
      computeNextGenerationStep({
        type: 'endcard',
        audio_type: 'none',
        image_url: null,
        audio_url: null,
        video_url: null,
        neutral_video_url: null
      })
    ).toBe('done');
  });
});
