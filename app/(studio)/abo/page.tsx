import Link from 'next/link';
import type { Route } from 'next';

export const dynamic = 'force-dynamic';

export default function AboPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <Link
          href={'/' as Route}
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
        >
          ← Zurück zum Studio
        </Link>
        <h1 className="text-2xl font-bold">Abo</h1>
        <p className="text-sm text-[var(--text-dim)]">
          Abo-Verwaltung folgt in einem späteren Plan.
        </p>
      </div>
    </div>
  );
}
