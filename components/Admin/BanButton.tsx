'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BanButton({
  userId,
  currentlyBanned,
  isSelf
}: {
  userId: string;
  currentlyBanned: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (isSelf && !currentlyBanned) {
      setError('Du kannst Dich nicht selbst sperren.');
      return;
    }
    const wantBan = !currentlyBanned;
    if (wantBan && !window.confirm('Diesen User wirklich sperren?')) return;
    setBusy(true);
    setError(null);
    try {
      const reason = wantBan
        ? window.prompt('Grund für die Sperre (optional):') ?? undefined
        : undefined;
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/ban`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ banned: wantBan, reason })
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || (isSelf && !currentlyBanned)}
        onClick={toggle}
        className={`px-3 py-1 text-sm rounded disabled:opacity-30 ${
          currentlyBanned
            ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
            : 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
        }`}
        title={
          isSelf && !currentlyBanned
            ? 'Eigenes Konto kann nicht gesperrt werden'
            : undefined
        }
      >
        {busy ? '…' : currentlyBanned ? 'User entsperren' : 'User sperren'}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}
