import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUserSession } from '@/lib/hooks/useUserSession';
import { AdminLink } from '@/components/TopBar/AdminLink';

beforeEach(() => {
  useUserSession.getState().reset();
});

describe('AdminLink', () => {
  it('renders nothing while the session is still loading', () => {
    useUserSession.getState().setLoading();
    const { container } = render(<AdminLink />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a non-admin session', () => {
    useUserSession
      .getState()
      .setSession({ email: 'user@x.com', role: 'user', banned: false });
    const { container } = render(<AdminLink />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an Admin link for an admin session', () => {
    useUserSession
      .getState()
      .setSession({ email: 'admin@x.com', role: 'admin', banned: false });
    render(<AdminLink />);
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link.getAttribute('href')).toBe('/admin');
  });

  it('renders nothing when the loader errors out (session unknown)', () => {
    useUserSession.getState().setError();
    const { container } = render(<AdminLink />);
    expect(container.firstChild).toBeNull();
  });

  // Regression — Mai 2026: Matthias navigated /admin → / and the Admin
  // button disappeared because the studio layout's re-mount called
  // setLoading() and the old AdminLink hid itself on any non-'ready'
  // status. Fix: render based on `role` alone — once we know the user
  // is admin, keep the link visible even during a re-fetch.
  it('stays visible after setLoading() runs on top of a previously-ready admin session (re-mount)', () => {
    useUserSession
      .getState()
      .setSession({ email: 'admin@x.com', role: 'admin', banned: false });
    useUserSession.getState().setLoading();
    render(<AdminLink />);
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });

  it('stays visible if the re-fetch errors after a previously-ready admin session', () => {
    useUserSession
      .getState()
      .setSession({ email: 'admin@x.com', role: 'admin', banned: false });
    useUserSession.getState().setError();
    render(<AdminLink />);
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });
});
