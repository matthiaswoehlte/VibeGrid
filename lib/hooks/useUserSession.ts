import { create } from 'zustand';

export interface UserSessionState {
  /** Email of the currently-logged-in user, or null when no session. */
  email: string | null;
  /** Better-Auth role ('admin' | 'user' | other). null when no session. */
  role: string | null;
  /** Better-Auth banned flag. */
  banned: boolean;
  /** Hydration status: 'idle' before first fetch, 'loading' during, 'ready' / 'error' after. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  setSession(session: { email: string | null; role: string | null; banned: boolean }): void;
  setLoading(): void;
  setError(): void;
  reset(): void;
}

/**
 * Lightweight session-metadata store for the TopBar (Admin link
 * visibility + UserMenu avatar/email + dropdown). Hydrated once on
 * app start by `UserSessionLoader`. Separate from `useAppStore` —
 * this is session-scope, not project-scope, and must survive across
 * project switches.
 *
 * Not persisted to localStorage on purpose: a stale cached role/email
 * could mislead the UI after a logout-then-login on the same browser.
 * The hydrator re-fetches on every mount.
 */
export const useUserSession = create<UserSessionState>()((set) => ({
  email: null,
  role: null,
  banned: false,
  status: 'idle',
  setSession: ({ email, role, banned }) =>
    set({ email, role, banned, status: 'ready' }),
  setLoading: () => set({ status: 'loading' }),
  setError: () => set({ status: 'error' }),
  reset: () =>
    set({ email: null, role: null, banned: false, status: 'idle' })
}));
