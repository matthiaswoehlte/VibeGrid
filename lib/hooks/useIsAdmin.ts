'use client';
import { useEffect, useState } from 'react';

/**
 * Client-side admin flag derived from /api/me/role. Mirrors the
 * AdminLink TopBar component's lookup but returns the boolean for
 * any component that needs to conditionally render an admin-only UI.
 *
 * `null` while loading so the caller can keep the UI hidden until the
 * role is known (no flicker for normal users).
 */
export function useIsAdmin(): boolean | null {
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
  return isAdmin;
}
