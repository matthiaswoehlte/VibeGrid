import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth/admin-guard';
import { CreditGrantForm } from '@/components/Admin/CreditGrantModal';
import { BanButton } from '@/components/Admin/BanButton';
import { TransactionHistory } from '@/components/Admin/TransactionHistory';
import type { AdminUserRow } from '@/components/Admin/UserTable';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function loadUser(id: string): Promise<AdminUserRow | null> {
  const h = headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const res = await fetch(`${base}/api/admin/users`, {
    headers: { cookie: h.get('cookie') ?? '' },
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { users: AdminUserRow[] };
  return body.users.find((u) => u.id === id) ?? null;
}

export default async function AdminUserDetailPage({
  params
}: {
  params: { id: string };
}) {
  const { userId: adminId } = await requireAdminPage();
  const user = await loadUser(params.id);
  if (!user) {
    return (
      <div className="space-y-3">
        <Link
          href="/admin/users"
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
        >
          ← Zurück zur User-Liste
        </Link>
        <div className="text-sm text-[var(--text-dim)]">User nicht gefunden.</div>
      </div>
    );
  }

  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const isSelf = adminId === user.id;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
      >
        ← Zurück zur User-Liste
      </Link>

      <section className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">{user.name ?? 'Unbenannt'}</h1>
          {user.role === 'admin' && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--a1)] border border-[var(--a1)] rounded px-2 py-0.5">
              Admin
            </span>
          )}
          {user.banned && (
            <span className="text-[10px] uppercase tracking-wider text-red-300 border border-red-300 rounded px-2 py-0.5">
              Banned
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-dim)]">{user.email ?? '—'}</div>
        <div className="text-[10px] text-[var(--text-muted)]">
          Mitglied seit{' '}
          {new Date(user.createdAt).toLocaleDateString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          })}
        </div>
        {user.banned && user.banReason && (
          <div className="text-xs text-red-300">
            Grund: {user.banReason}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Balance
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {user.balance.toLocaleString()}
            </div>
            <div className="text-[10px] text-[var(--text-dim)]">
              {usd(user.balance)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Lifetime Spent
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {user.lifetime_spent.toLocaleString()}
            </div>
            <div className="text-[10px] text-[var(--text-dim)]">
              {usd(user.lifetime_spent)}
            </div>
          </div>
        </div>
      </section>

      <CreditGrantForm userId={user.id} />

      <div>
        <BanButton
          userId={user.id}
          currentlyBanned={Boolean(user.banned)}
          isSelf={isSelf}
        />
      </div>

      <TransactionHistory userId={user.id} />
    </div>
  );
}
