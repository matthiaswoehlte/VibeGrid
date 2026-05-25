'use client';

/**
 * Plan 8.5 — credit balance indicator in the SceneFlow header.
 *
 * Reads from the status-all-Poll payload's balance field — no separate
 * endpoint, no own fetch. Renders `💳 N Credits` or a dash when the
 * value isn't known yet (first poll hasn't returned).
 */
export function CreditDisplay({ balance }: { balance: number | null }) {
  const label = balance === null ? '—' : balance.toLocaleString();
  return (
    <span
      className="text-xs text-[var(--text-dim)] tabular-nums"
      title={
        balance === null
          ? 'Credit-Stand lädt …'
          : `Aktuelles Guthaben: ${balance} Credits ($${(balance / 100).toFixed(2)})`
      }
    >
      <span aria-hidden="true">💳</span> {label} Credits
    </span>
  );
}
