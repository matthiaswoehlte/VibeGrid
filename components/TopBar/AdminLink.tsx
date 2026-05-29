'use client';
import Link from 'next/link';
import { useUserSession } from '@/lib/hooks/useUserSession';

/**
 * Renders an "Admin" link in the TopBar when the current session is
 * an admin. Reads from the user-session store (hydrated once on app
 * start by `UserSessionLoader`) instead of doing its own fetch.
 *
 * Last-known-good rule: we render based on `role` alone, regardless of
 * loader `status`. After the first successful hydration the store's
 * `role` slot holds `'admin'` (for an admin) and stays there across
 * navigations until either `setSession` overwrites it with a different
 * role or `reset()` wipes it on logout. The status field flips back
 * to `'loading'` when the studio layout re-mounts (e.g. /admin → /),
 * but admins should NOT lose the button during that brief re-fetch —
 * we already know they're admin. Previously the AdminLink hid itself
 * on every re-mount and only reappeared once the re-fetch settled,
 * which made the button "weg" whenever Matthias navigated /admin → /
 * faster than the network round-trip.
 *
 * A non-admin user starts with `role === null` and only flips to
 * `'user'` after the first fetch — the button stays hidden either way.
 */
export function AdminLink() {
  const role = useUserSession((s) => s.role);

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
