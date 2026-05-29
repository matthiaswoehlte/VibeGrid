import { headers } from 'next/headers';
import { getR2Config } from '@/lib/storage/env';
import type { SoundManifest } from '@/lib/sounds/types';
import { SoundsAdminClient } from './SoundsAdminClient';

export const dynamic = 'force-dynamic';

async function loadManifest(): Promise<SoundManifest> {
  const h = headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const res = await fetch(`${base}/api/admin/sounds/manifest`, {
    headers: { cookie: h.get('cookie') ?? '' },
    cache: 'no-store'
  });
  if (!res.ok) {
    return { version: 0, updatedAt: new Date().toISOString(), categories: [] };
  }
  return (await res.json()) as SoundManifest;
}

export default async function AdminSoundsPage() {
  // requireAdminPage() runs in the admin layout — no need to repeat.
  const initialManifest = await loadManifest();
  // R2_PUBLIC_URL is server-only (lib/storage/env.ts is 'server-only').
  // We read it here in the server-component and hand it down as a prop
  // so the client can construct `<audio src>` URLs without a separate
  // NEXT_PUBLIC_ env var. Exposing the CDN host to the admin-only client
  // bundle is fine — it's a public URL anyway.
  const { publicUrl } = getR2Config();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Sound Library</h1>
      <SoundsAdminClient
        initialManifest={initialManifest}
        r2PublicUrl={publicUrl}
      />
    </div>
  );
}
