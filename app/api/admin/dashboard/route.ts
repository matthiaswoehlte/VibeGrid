import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getDashboardStats } from '@/lib/admin/stats';

export const runtime = 'nodejs';

/**
 * Convenience endpoint for external consumers (admin CLI, future
 * webhook). The /admin Page imports getDashboardStats directly — no
 * fetch round-trip from server to its own API.
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;
  const stats = await getDashboardStats();
  return NextResponse.json(stats);
}
