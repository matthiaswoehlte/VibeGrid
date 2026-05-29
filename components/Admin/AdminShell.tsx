'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

/**
 * Plan 8.6 — Admin-Layout-Shell.
 * Renders nav links + page container. Logout reuses the studio's
 * existing Better-Auth signOut flow; for v0.1 a simple link back to
 * the studio root is sufficient (the studio handles its own logout).
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const links: Array<{
    href: '/admin' | '/admin/users' | '/admin/sounds';
    label: string;
  }> = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/users', label: 'User' },
    { href: '/admin/sounds', label: 'Sound Library' }
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface-1)]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-bold">VibeGrid Admin</span>
          <nav className="flex gap-3">
            {links.map((l) => {
              const active =
                l.href === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`text-xs px-2 py-1 rounded ${
                    active
                      ? 'bg-[var(--surface-3)] text-[var(--text)]'
                      : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          <Link
            href={'/' as Route}
            className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
          >
            ← Zurück zum Studio
          </Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
