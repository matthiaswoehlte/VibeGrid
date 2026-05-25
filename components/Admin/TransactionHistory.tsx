'use client';
import { useEffect, useState } from 'react';

interface TransactionRow {
  id: string;
  amount: number;
  balance_after: number;
  action: string;
  story_id: string | null;
  scene_id: string | null;
  meta: { admin_id?: string; reason?: string } | null;
  created_at: string;
}

export function TransactionHistory({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/admin/users/${encodeURIComponent(userId)}/transactions?page=${page}`
    )
      .then((r) => r.json() as Promise<{
        transactions: TransactionRow[];
        page: number;
        pageSize: number;
        total: number;
      }>)
      .then((body) => {
        if (cancelled) return;
        setRows(body.transactions);
        setTotal(body.total);
        setPageSize(body.pageSize);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold">Transaktions-History</h3>
      {loading && rows.length === 0 ? (
        <div className="text-xs text-[var(--text-dim)]">Lädt …</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-[var(--text-dim)]">
          Keine Transaktionen.
        </div>
      ) : (
        <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--surface-2)] text-[var(--text-dim)]">
              <tr>
                <th className="text-left px-3 py-2">Datum</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-right px-3 py-2">Balance After</th>
                <th className="text-left px-3 py-2">Admin</th>
                <th className="text-left px-3 py-2">Story / Scene</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]"
                >
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {new Date(t.created_at).toLocaleString('de-DE')}
                  </td>
                  <td className="px-3 py-2">{t.action}</td>
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
                    {t.meta?.admin_id
                      ? `${t.meta.admin_id.slice(0, 8)}…`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {t.story_id ? `${t.story_id.slice(0, 8)}…` : '—'}
                    {t.scene_id ? ` / ${t.scene_id.slice(0, 8)}…` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-[var(--text-dim)]">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-2 py-0.5 disabled:opacity-30 hover:text-[var(--text)]"
        >
          ← prev
        </button>
        <span>
          Seite {page} von {totalPages} ({total} Einträge)
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="px-2 py-0.5 disabled:opacity-30 hover:text-[var(--text)]"
        >
          next →
        </button>
      </div>
    </div>
  );
}
