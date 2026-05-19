'use client';
import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import { extractImageMeta, extractAudioMeta } from '@/lib/storage/media-meta';
import type { MediaKind, MediaRef } from '@/lib/storage/types';

export interface UseMediaUpload {
  upload(file: File, kind: MediaKind): Promise<MediaRef>;
}

export function useMediaUpload(): UseMediaUpload {
  const adapter = useMemo(() => createR2StorageAdapter(), []);
  const addMediaRef = useAppStore((s) => s.mediaActions.addMediaRef);
  const addMediaRefMeta = useAppStore((s) => s.mediaActions.addMediaRefMeta);

  const upload = useCallback(
    async (file: File, kind: MediaKind): Promise<MediaRef> => {
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

  return { upload };
}
