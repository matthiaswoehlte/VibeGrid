import type { MediaKind, MediaRef, StorageAdapter } from './types';

interface CreateAdapterOptions {
  /** Override the endpoint — used by tests. */
  endpoint?: string;
}

export function createR2StorageAdapter(options: CreateAdapterOptions = {}): StorageAdapter {
  const endpoint = options.endpoint ?? '/api/upload';

  async function upload(file: File, kind: MediaKind): Promise<MediaRef> {
    const id = crypto.randomUUID();
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    fd.append('id', id);

    const res = await fetch(endpoint, { method: 'POST', body: fd });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; code?: string };
        if (body.code) detail = body.code;
        else if (body.error) detail = body.error;
      } catch {
        // ignore — keep the HTTP detail
      }
      throw new Error(`Upload failed: ${detail}`);
    }
    return (await res.json()) as MediaRef;
  }

  return {
    uploadImage: (file) => upload(file, 'image'),
    uploadAudio: (file) => upload(file, 'audio')
  };
}
