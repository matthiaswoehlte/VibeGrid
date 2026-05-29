import { headers } from 'next/headers';
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
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Sound Library</h1>
      <SoundsAdminClient initialManifest={initialManifest} />
    </div>
  );
}
