'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Conditionally renders an "Admin" link in the TopBar when the
 * current session is an admin. Fetches /api/me/role once on mount.
 * Hidden until the role is known to avoid a flicker for normal users.
 */
export function AdminLink() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me/role')
      .then((r) => r.json() as Promise<{ role: string | null }>)
      .then((body) => {
        if (!cancelled) setIsAdmin(body.role === 'admin');
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isAdmin !== true) return null;

  return (
    <Link
      href="/admin"
      className="hidden md:inline-flex h-7 px-2 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--a1)]/15 text-[var(--a1)] hover:bg-[var(--a1)]/25 transition-colors border border-[var(--a1)]/30"
      title="Admin-Bereich"
    >
      Admin
    </Link>
  );
}
