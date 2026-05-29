import { describe, it, expect, beforeEach } from 'vitest';
import { useUserSession } from '@/lib/hooks/useUserSession';

beforeEach(() => {
  useUserSession.getState().reset();
});

describe('useUserSession', () => {
  it('starts in idle status with empty session', () => {
    const s = useUserSession.getState();
    expect(s.status).toBe('idle');
    expect(s.email).toBeNull();
    expect(s.role).toBeNull();
    expect(s.banned).toBe(false);
  });

  it('setLoading marks status as loading without clearing prior data', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    useUserSession.getState().setLoading();
    const s = useUserSession.getState();
    expect(s.status).toBe('loading');
    expect(s.email).toBe('a@b.c'); // prior data survives a re-fetch
  });

  it('setSession populates email/role/banned and marks ready', () => {
    useUserSession
      .getState()
      .setSession({ email: 'admin@x.com', role: 'admin', banned: false });
    const s = useUserSession.getState();
    expect(s.status).toBe('ready');
    expect(s.email).toBe('admin@x.com');
    expect(s.role).toBe('admin');
    expect(s.banned).toBe(false);
  });

  it('setError marks status as error without clearing prior data', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'user', banned: false });
    useUserSession.getState().setError();
    expect(useUserSession.getState().status).toBe('error');
    expect(useUserSession.getState().email).toBe('a@b.c');
  });

  it('reset wipes everything back to idle', () => {
    useUserSession
      .getState()
      .setSession({ email: 'a@b.c', role: 'admin', banned: true });
    useUserSession.getState().reset();
    const s = useUserSession.getState();
    expect(s.status).toBe('idle');
    expect(s.email).toBeNull();
    expect(s.role).toBeNull();
    expect(s.banned).toBe(false);
  });
});
