import { describe, it, expect } from 'vitest';

describe('better-auth server', () => {
  it('exports an `auth` instance with callable handler()', async () => {
    const { auth } = await import('@/lib/auth/better-auth-server');
    expect(typeof auth.handler).toBe('function');
  });

  it('emailAndPassword route is mounted (no other providers in v0.1)', async () => {
    const { auth } = await import('@/lib/auth/better-auth-server');
    // Better-Auth doesn't expose its config object, but routes reflect
    // enabled providers. Empty-body POST to /sign-in/email yields 400
    // from validation, NOT 404. That confirms the route exists.
    const req = new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' })
    });
    const res = await auth.handler(req);
    expect(res.status).not.toBe(404);
  });
});
