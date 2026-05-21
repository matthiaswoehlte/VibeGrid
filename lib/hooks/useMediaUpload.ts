'use client';
import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import { extractImageMeta, extractAudioMeta } from '@/lib/storage/media-meta';
import {
  uploadVideoToR2,
  getVideoDuration,
  type VideoUploadProgress
} from '@/lib/storage/video-upload';
import type { MediaRef } from '@/lib/storage/types';

export interface UseMediaUpload {
  upload(file: File, kind: 'image' | 'audio'): Promise<MediaRef>;
  /** Plan-5.9b — video uploads use R2 presigned PUT (separate path)
   *  with a progress callback for the UI fortschrittsbalken. */
  uploadVideo(
    file: File,
    onProgress?: (p: VideoUploadProgress) => void
  ): Promise<MediaRef>;
}

const VIDEO_MAX_DURATION_SEC = 300; // 5 min
const VIDEO_ALLOWED_MIMES = ['video/mp4', 'video/webm'] as const;

/**
 * Plan-5.9b — captures a JPEG thumbnail from a video URL by seeking to
 * the 1-second mark (or half the clip, whichever is shorter) and
 * `canvas.toDataURL`-ing the frame. Returns null on failure (CORS,
 * decode error, etc.) — caller falls back to a generic ▶ icon.
 */
function generateVideoThumbnail(url: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    let resolved = false;
    const done = (thumb: string | undefined) => {
      if (resolved) return;
      resolved = true;
      resolve(thumb);
    };
    video.onloadeddata = () => {
      const target = Math.min(1, (video.duration || 2) / 2);
      video.currentTime = target;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done(undefined);
        ctx.drawImage(video, 0, 0, 160, 90);
        done(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        // SecurityError on cross-origin without CORS, or
        // InvalidStateError on a torn-down element.
        done(undefined);
      }
    };
    video.onerror = () => done(undefined);
  });
}

export function useMediaUpload(): UseMediaUpload {
  const adapter = useMemo(() => createR2StorageAdapter(), []);
  const addMediaRef = useAppStore((s) => s.mediaActions.addMediaRef);
  const addMediaRefMeta = useAppStore((s) => s.mediaActions.addMediaRefMeta);

  const upload = useCallback(
    async (file: File, kind: 'image' | 'audio'): Promise<MediaRef> => {
      const ref =
        kind === 'image' ? await adapter.uploadImage(file) : await adapter.uploadAudio(file);
      addMediaRef(ref);
      // Best-effort metadata fill — failure here does not fail the upload.
      try {
        const meta =
          kind === 'image' ? await extractImageMeta(file) : await extractAudioMeta(file);
        addMediaRefMeta(ref.id, meta);
      } catch {
        // swallow — meta is optional for v0.1 rendering
      }
      return ref;
    },
    [adapter, addMediaRef, addMediaRefMeta]
  );

  const uploadVideo = useCallback(
    async (
      file: File,
      onProgress?: (p: VideoUploadProgress) => void
    ): Promise<MediaRef> => {
      // 1. Client-side validation BEFORE we burn upload bandwidth.
      if (!VIDEO_ALLOWED_MIMES.includes(file.type as (typeof VIDEO_ALLOWED_MIMES)[number])) {
        throw new Error('Nur MP4 und WebM Videos werden unterstützt');
      }
      let duration: number;
      try {
        duration = await getVideoDuration(file);
      } catch {
        throw new Error('Konnte Video-Metadaten nicht lesen');
      }
      if (duration > VIDEO_MAX_DURATION_SEC) {
        throw new Error(
          `Video zu lang (${Math.round(duration)}s) — max. ${VIDEO_MAX_DURATION_SEC}s`
        );
      }

      // 2. Direct PUT to R2 with progress.
      const { publicUrl } = await uploadVideoToR2(file, onProgress);

      // 3. Thumbnail (best-effort).
      const thumbnailUrl = await generateVideoThumbnail(publicUrl);

      // 4. Register in the store.
      const ref: MediaRef = {
        id: crypto.randomUUID(),
        kind: 'video',
        url: publicUrl,
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        duration,
        thumbnailUrl
      };
      addMediaRef(ref);
      return ref;
    },
    [addMediaRef]
  );

  return { upload, uploadVideo };
}
