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
    // Plan 7 debug instrumentation — surfaces hangs and silent throws.
    // Remove these console.logs once login is verified working.
    console.log('[login] submit start, baseURL=', process.env.NEXT_PUBLIC_BASE_URL);
    try {
      const res = await signIn.email({ email, password });
      console.log('[login] signIn.email returned', res);
      setBusy(false);
      if (res.error) {
        console.warn('[login] error path', res.error);
        toast.error(res.error.message ?? 'Login fehlgeschlagen');
        return;
      }
      // Studio is mounted at `/` (app/(studio) is a route group).
      const target = search.get('from') ?? '/';
      console.log('[login] success, pushing', target);
      router.push(target as Parameters<typeof router.push>[0]);
    } catch (err) {
      setBusy(false);
      console.error('[login] signIn.email threw', err);
      toast.error('Login error: ' + (err as Error).message);
    }
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
