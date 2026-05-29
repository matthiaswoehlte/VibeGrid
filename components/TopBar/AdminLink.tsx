'use client';
import Link from 'next/link';
import { useUserSession } from '@/lib/hooks/useUserSession';

/**
 * Renders an "Admin" link in the TopBar when the current session is
 * an admin. Reads from the user-session store (hydrated once on app
 * start by `UserSessionLoader`) instead of doing its own fetch —
 * stable across re-mounts, no race with the StrictMode double-effect
 * that previously caused the button to flicker / disappear.
 */
export function AdminLink() {
  const role = useUserSession((s) => s.role);
  const status = useUserSession((s) => s.status);

  // Wait for the loader to settle. We deliberately render NOTHING in
  // the loading state to avoid showing the Admin link to a normal
  // user during the brief hydration window.
  if (status !== 'ready') return null;
  if (role !== 'admin') return null;

  return (
    <Link
      href="/admin"
      className="inline-flex h-7 px-2 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--a1)]/15 text-[var(--a1)] hover:bg-[var(--a1)]/25 transition-colors border border-[var(--a1)]/30"
      title="Admin-Bereich"
    >
      Admin
    </Link>
  );
}
