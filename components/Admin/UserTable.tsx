'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
  createdAt: string;
  balance: number;
  lifetime_spent: number;
}

export function UserTable({ users }: { users: AdminUserRow[] }) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return users;
    return users.filter(
      (u) =>
        (u.email ?? '').toLowerCase().includes(f) ||
        (u.name ?? '').toLowerCase().includes(f)
    );
  }, [users, filter]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Suche Name / Email …"
        className="w-full max-w-md bg-[var(--surface-2)] border border-[var(--border)] rounded px-3 py-1 text-sm text-[var(--text)]"
      />
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[var(--surface-2)] text-[var(--text-dim)]">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-right px-3 py-2">Balance</th>
              <th className="text-left px-3 py-2">Banned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--text-dim)] py-4">
                  Keine User gefunden.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]"
                >
                  <td className="px-3 py-2">{u.name ?? '—'}</td>
                  <td className="px-3 py-2 text-[var(--text-dim)]">
                    {u.email ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        u.role === 'admin'
                          ? 'text-[var(--a1)]'
                          : 'text-[var(--text-muted)]'
                      }
                    >
                      {u.role ?? 'user'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {u.balance.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {u.banned ? (
                      <span className="text-red-300">✗ Banned</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/users/${u.id}` as never}
                      className="text-[var(--a2)] hover:text-[var(--a1)]"
                    >
                      →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
