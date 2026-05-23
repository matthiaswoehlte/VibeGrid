'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { signIn } from '@/lib/auth/better-auth-client';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const expired = search.get('expired') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? 'Login fehlgeschlagen');
      return;
    }
    // `from` is a runtime-supplied URL — typed routes expect a literal
    // route string. Cast: middleware only ever writes safe in-app paths.
    const target = search.get('from') ?? '/studio';
    router.push(target as Parameters<typeof router.push>[0]);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-bold text-[var(--text)]">VibeGrid Login</h1>
      {expired && (
        <p className="text-xs text-[var(--text-dim)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1">
          Session abgelaufen — bitte erneut anmelden.
        </p>
      )}
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-[var(--a1)] text-white py-2 rounded disabled:opacity-50"
      >
        {busy ? '...' : 'Sign In'}
      </button>
      <p className="text-[11px] text-[var(--text-muted)] text-center">
        Bestehende Accounts. Kein Signup in v0.1.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-xs text-[var(--text-dim)]">Lädt...</div>}>
      <LoginForm />
    </Suspense>
  );
}
