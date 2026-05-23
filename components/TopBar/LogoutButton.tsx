'use client';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth/better-auth-client';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await signOut();
    // Clear local project pointer so a different account that logs in
    // on the same browser doesn't accidentally inherit the previous
    // session's projectId/name.
    useCurrentProject.getState().setProject(null);
    router.push('/login');
  }
  return (
    <button
      type="button"
      onClick={logout}
      className="hidden md:inline-flex h-7 px-2 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors border border-[var(--border)]"
      title="Sign out"
    >
      Logout
    </button>
  );
}
