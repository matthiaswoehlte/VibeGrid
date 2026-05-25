'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreditGrantForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Betrag muss eine positive Zahl sein');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/grant-credits`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount: Math.floor(n),
            reason: reason.trim() || undefined
          })
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        const body = (await res.json()) as { balance: number };
        setSuccess(
          `+${Math.floor(n)} Credits vergeben — neues Guthaben: ${body.balance}`
        );
        setAmount('');
        setReason('');
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 space-y-2"
    >
      <h3 className="text-sm font-bold">Credits vergeben</h3>
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          step={100}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Betrag"
          className="w-32 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm tabular-nums"
        />
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Grund (optional)"
          className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1 text-sm rounded bg-[var(--a1)] text-white disabled:opacity-30"
        >
          {busy ? '…' : 'Vergeben'}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {success && <p className="text-xs text-emerald-300">{success}</p>}
    </form>
  );
}
