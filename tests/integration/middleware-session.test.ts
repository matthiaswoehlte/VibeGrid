import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function nextReq(path: string, cookies?: Record<string, string>): NextRequest {
  const req = new NextRequest(`http://localhost:3000${path}`);
  if (cookies) {
    for (const [k, v] of Object.entries(cookies)) {
      req.cookies.set(k, v);
    }
  }
  return req;
}

describe('middleware cookie guard (Edge-compatible)', () => {
  it('redirects /studio to /login when no session cookie present', async () => {
    const res = await middleware(nextReq('/studio'));
    expect(res?.status).toBe(307);
    const loc = res!.headers.get('location') ?? '';
    expect(loc).toContain('/login');
    expect(loc).toContain('from=%2Fstudio');
  });

  it('passes through /studio when vibegrid.session_token cookie present', async () => {
    const res = await middleware(
      nextReq('/studio', { 'vibegrid.session_token': 'cookie-value-not-validated-here' })
    );
    // NextResponse.next() returns a response with no redirect location.
    expect(res?.headers.get('location')).toBeNull();
  });

  it('accepts the chunked-cookie variant (Better-Auth splits large cookies)', async () => {
    const res = await middleware(nextReq('/studio', { 'vibegrid.session_token.0': 'chunk-0' }));
    expect(res?.headers.get('location')).toBeNull();
  });
});
