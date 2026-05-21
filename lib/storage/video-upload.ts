/**
 * Plan 5.9b — client-side video upload helper.
 *
 * Two-step flow:
 *  1. POST `/api/presign` with file metadata → server returns a signed
 *     PUT URL valid 1 h.
 *  2. PUT the file directly to R2 via XHR (so we get
 *     `upload.onprogress` events for the UI progress bar).
 *
 * Why XHR and not fetch: fetch has no upload-progress events in any
 * stable spec. XHR has had them since IE10. For a 100-500 MB upload,
 * a "98 %" progress bar is the user-visible feature.
 */

export interface VideoUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface VideoUploadResult {
  publicUrl: string;
  key: string;
}

interface PresignResponse {
  presignedUrl: string;
  publicUrl: string;
  key: string;
}

interface PresignError {
  error: string;
  code: string;
}

export async function uploadVideoToR2(
  file: File,
  onProgress?: (p: VideoUploadProgress) => void
): Promise<VideoUploadResult> {
  // Step 1 — presign
  const presignRes = await fetch('/api/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size
    })
  });
  if (!presignRes.ok) {
    const body: PresignError = await presignRes
      .json()
      .catch(() => ({ error: presignRes.statusText, code: 'UNKNOWN' }));
    throw new Error(`Presign failed: ${body.error}`);
  }
  const { presignedUrl, publicUrl, key } =
    (await presignRes.json()) as PresignResponse;

  // Step 2 — PUT to R2 with progress
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: (e.loaded / e.total) * 100
        });
      };
    }
    xhr.onload = () => {
      if (xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during R2 upload'));
    xhr.onabort = () => reject(new Error('R2 upload aborted'));
    xhr.send(file);
  });

  return { publicUrl, key };
}

/**
 * Reads `video.duration` once metadata loads. Returns seconds. Used by
 * the Mediathek upload UI to reject files > 300 s BEFORE we start
 * uploading them — saves the user from wasting bandwidth on a clip
 * that won't be accepted anyway.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = '';
    };
    video.onloadedmetadata = () => {
      const d = video.duration;
      cleanup();
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error('Video metadata reports no duration'));
        return;
      }
      resolve(d);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to read video metadata'));
    };
    video.src = url;
  });
}
