import { requireAdminPage } from '@/lib/auth/admin-guard';
import { getDashboardStats } from '@/lib/admin/stats';

export const dynamic = 'force-dynamic';

function Stat({
  label,
  value,
  subtext
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-xl font-semibold text-[var(--text)] tabular-nums mt-1">
        {value}
      </div>
      {subtext && (
        <div className="text-[10px] text-[var(--text-dim)] mt-1">{subtext}</div>
      )}
    </div>
  );
}

export default async function AdminDashboardPage() {
  await requireAdminPage();
  const stats = await getDashboardStats();
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Aktive User (30d)" value={String(stats.active_users_30d)} />
        <Stat
          label="Credits vergeben"
          value={stats.total_granted.toLocaleString()}
          subtext={usd(stats.total_granted)}
        />
        <Stat
          label="Credits verbraucht"
          value={stats.total_spent.toLocaleString()}
          subtext={usd(stats.total_spent)}
        />
        <Stat
          label="fal.ai Calls (30d)"
          value={String(stats.fal_calls_30d)}
        />
      </div>

      <section>
        <h2 className="text-sm font-bold mb-2">Letzte Transaktionen</h2>
        {stats.recent_transactions.length === 0 ? (
          <div className="text-xs text-[var(--text-dim)] py-4">
            Noch keine Transaktionen.
          </div>
        ) : (
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--surface-2)] text-[var(--text-dim)]">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">Balance After</th>
                  <th className="text-left px-3 py-2">Zeit</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]"
                  >
                    <td className="px-3 py-2">
                      <a
                        href={`/admin/users/${t.user_id}`}
                        className="text-[var(--a2)] hover:text-[var(--a1)]"
                      >
                        {t.email ?? t.user_id.slice(0, 8)}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-dim)]">
                      {t.action}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${t.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}
                    >
                      {t.amount > 0 ? '+' : ''}
                      {t.amount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.balance_after}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {new Date(t.created_at).toLocaleString('de-DE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
