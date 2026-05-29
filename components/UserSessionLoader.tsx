'use client';
import { useEffect } from 'react';
import { useUserSession } from '@/lib/hooks/useUserSession';

interface MePayload {
  email: string | null;
  role: string | null;
  banned: boolean;
}

/**
 * One-shot side-effect component that hydrates `useUserSession` from
 * `/api/me/role`. Mounted by the studio layout (sister of
 * AutoSaveMount / SoundManifestLoader).
 *
 * Replaces the old AdminLink-internal `useEffect + fetch` pattern,
 * which was prone to mid-flight unmount race conditions in dev's
 * StrictMode double-effect and could leave the Admin link hidden
 * intermittently. Now the fetch runs ONCE for the whole TopBar (and
 * anything else that wants user metadata), and the result is cached
 * in the Zustand store for the lifetime of the page.
 */
export function UserSessionLoader(): null {
  const setSession = useUserSession((s) => s.setSession);
  const setLoading = useUserSession((s) => s.setLoading);
  const setError = useUserSession((s) => s.setError);
  useEffect(() => {
    let cancelled = false;
    setLoading();
    fetch('/api/me/role', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<MePayload>;
      })
      .then((body) => {
        if (cancelled) return;
        setSession({
          email: body.email,
          role: body.role,
          banned: !!body.banned
        });
      })
      .catch(() => {
        if (cancelled) return;
        setError();
      });
    return () => {
      cancelled = true;
    };
  }, [setSession, setLoading, setError]);
  return null;
}
