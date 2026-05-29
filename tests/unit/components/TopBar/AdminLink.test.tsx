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
});
