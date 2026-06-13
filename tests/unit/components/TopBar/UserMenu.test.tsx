import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useUserSession } from '@/lib/hooks/useUserSession';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock })
}));

const signOutMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/auth/better-auth-client', () => ({
  signOut: () => signOutMock()
}));

import { UserMenu } from '@/components/TopBar/UserMenu';

beforeEach(() => {
  useUserSession.getState().reset();
  pushMock.mockReset();
  signOutMock.mockReset().mockResolvedValue(undefined);
});

describe('UserMenu', () => {
  it('renders a pulsing placeholder while session is loading', () => {
    useUserSession.getState().setLoading();
    const { container } = render(<UserMenu />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders nothing once ready but with no email (logged out)', () => {
    useUserSession.getState().setSession({ email: null, role: null, banned: false });
    const { container } = render(<UserMenu />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the email's first letter as the avatar initial", () => {
    useUserSession
      .getState()
      .setSession({ email: 'demo-admin@example.com', role: 'user', banned: false });
    render(<UserMenu />);
    const button = screen.getByRole('button', { name: /Konto/ });
    expect(button.textContent?.trim()).toBe('D');
    expect(button.getAttribute('title')).toBe('demo-admin@example.com');
  });

  it('opens the dropdown on click and exposes Profil / Abo / Logout items', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Konto/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Abo' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument();
  });

  it('Profil item navigates to /profile', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Konto/ }));
    const profil = screen.getByRole('menuitem', { name: 'Profil' });
    expect(profil.getAttribute('href')).toBe('/profile');
  });

  it('Abo item navigates to /abo', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Konto/ }));
    const abo = screen.getByRole('menuitem', { name: 'Abo' });
    expect(abo.getAttribute('href')).toBe('/abo');
  });

  it('Logout item calls signOut, resets session, pushes /login', async () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    render(<UserMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Konto/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    // Resolve the microtask queue so the async logout's tail runs.
    await new Promise((r) => setTimeout(r, 0));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/login');
    expect(useUserSession.getState().status).toBe('idle');
    expect(useUserSession.getState().email).toBeNull();
  });

  // Regression — Mai 2026: navigation /admin → / re-mounted the studio
  // layout which set status='loading'. The old guard showed a pulse
  // placeholder for any non-ready status, so the avatar briefly turned
  // into a skeleton on every such navigation. Fix: keep the avatar as
  // long as we have an email, regardless of status.
  it('keeps the avatar visible when status flips to loading on top of a known email (re-mount)', () => {
    useUserSession
      .getState()
      .setSession({ email: 'demo-admin@example.com', role: 'user', banned: false });
    useUserSession.getState().setLoading();
    const { container } = render(<UserMenu />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Konto/ }).textContent?.trim()
    ).toBe('D');
  });

  it('keeps the avatar visible if the re-fetch errors after a known email', () => {
    useUserSession
      .getState()
      .setSession({ email: 'demo-admin@example.com', role: 'user', banned: false });
    useUserSession.getState().setError();
    const { container } = render(<UserMenu />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByRole('button', { name: /Konto/ })).toBeInTheDocument();
  });
});
