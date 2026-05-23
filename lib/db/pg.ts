import 'server-only';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — required for VG_projects persistence');
}

// globalThis singleton survives Next.js dev HMR — without it every
// Hot-Module-Reload spawns a fresh Pool and connections leak until the
// Postgres pgbouncer hits its `default_pool_size` ceiling.
type PoolHolder = { __vgPgPool?: Pool };
const holder = globalThis as PoolHolder;

export const pool: Pool =
  holder.__vgPgPool ??
  (holder.__vgPgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  }));
