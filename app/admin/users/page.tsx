import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth/admin-guard';
import { UserTable, type AdminUserRow } from '@/components/Admin/UserTable';

export const dynamic = 'force-dynamic';

async function loadUsers(): Promise<AdminUserRow[]> {
  // Server-component fetch — forward cookies so requireAdminApi sees the session.
  const h = headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const res = await fetch(`${base}/api/admin/users`, {
    headers: { cookie: h.get('cookie') ?? '' },
    cache: 'no-store'
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { users: AdminUserRow[] };
  return body.users;
}

export default async function AdminUsersPage() {
  await requireAdminPage();
  const users = await loadUsers();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">User</h1>
      <UserTable users={users} />
    </div>
  );
}
