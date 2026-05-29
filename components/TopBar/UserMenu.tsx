'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUserSession } from '@/lib/hooks/useUserSession';
import { signOut } from '@/lib/auth/better-auth-client';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';

/**
 * Compact circular avatar + dropdown menu in the TopBar.
 *
 * - **Avatar**: shows the email's first letter (uppercase). `title`
 *   attribute exposes the full email on hover. Hidden entirely when
 *   no email is known (e.g. session expired) — caller (TopBar) chooses
 *   whether to render a login link in that case.
 * - **Dropdown**: opens on click, closes on outside-pointerdown or
 *   Escape. Three items: Profil, Abo, Logout.
 *
 * Replaces the standalone `LogoutButton` in the TopBar so the logout
 * action is grouped with the user identity (less visual clutter,
 * matches the convention of every modern web app).
 */
export function UserMenu() {
  const email = useUserSession((s) => s.email);
  const status = useUserSession((s) => s.status);
  const resetSession = useUserSession((s) => s.reset);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function onLogout() {
    setOpen(false);
    await signOut();
    // Clear the local project pointer so a different account that logs
    // in on the same browser doesn't inherit the previous session's
    // projectId/name. Also reset the in-memory session metadata so
    // the loader re-fetches on the next mount.
    useCurrentProject.getState().setProject(null);
    resetSession();
    router.push('/login');
  }

  // Render nothing until the session fetch has resolved (or errored).
  // The studio layout's UserSessionLoader fires within the first paint;
  // for the brief 'idle' / 'loading' window we'd rather show a tiny
  // skeleton circle than flash the menu in/out.
  if (status === 'idle' || status === 'loading') {
    return (
      <div
        className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse"
        aria-hidden
      />
    );
  }
  if (!email) {
    // No session — UserMenu cannot render. Caller can show a login link
    // in this slot if desired; for the studio TopBar a logged-out user
    // never reaches this view (middleware redirects to /login).
    return null;
  }

  const initial = email.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-label={`Konto: ${email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
          open
            ? 'bg-[var(--a1)] text-white'
            : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]'
        }`}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[180px] bg-[var(--surface-2)] border border-[var(--border)] rounded shadow-lg z-30 py-1"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] truncate">
            {email}
          </div>
          <div className="my-1 border-t border-[var(--border)]" />
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
          >
            Profil
          </Link>
          <Link
            href="/abo"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
          >
            Abo
          </Link>
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="block w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
