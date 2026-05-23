import { describe, it, expect, vi } from 'vitest';

describe('pg pool module', () => {
  it('exports a singleton — repeated imports return the same Pool instance', async () => {
    const a = (await import('@/lib/db/pg')).pool;
    const b = (await import('@/lib/db/pg')).pool;
    expect(a).toBe(b);
  });

  it('throws if DATABASE_URL is missing', async () => {
    const orig = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    // Drop the global pool singleton so the module re-evaluates its
    // top-level env check. vi.resetModules clears Vitest's module cache;
    // deleting globalThis.__vgPgPool clears the HMR-resilient ref we keep
    // on globalThis so the constructor branch runs fresh.
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__vgPgPool;
    await expect(import('@/lib/db/pg')).rejects.toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = orig;
  });
});
