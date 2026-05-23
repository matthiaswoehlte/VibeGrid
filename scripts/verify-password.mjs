#!/usr/bin/env node
// Plan 7 — verify a candidate password against the stored hash WITHOUT
// going through better-auth's full HTTP/session machinery. Isolates
// "is the password wrong?" from "is the auth flow broken?".
//
// Usage: node -r dotenv/config scripts/verify-password.mjs <email> <password> dotenv_config_path=.env.local
import 'dotenv/config';
import { Pool } from 'pg';
import { verifyPassword } from '@better-auth/utils/password';

const email = process.argv[2];
const candidate = process.argv[3];
if (!email || !candidate) {
  console.error('Usage: node scripts/verify-password.mjs <email> <password>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query(
    'SELECT a.password FROM account a JOIN "user" u ON a."userId" = u.id WHERE u.email = $1 AND a."providerId" = $2',
    [email, 'credential']
  );
  if (r.rows.length === 0) {
    console.log('No credential account row found.');
    process.exit(0);
  }
  const hash = r.rows[0].password;
  console.log('Hash length:', hash.length);
  console.log('Hash format:', /^[0-9a-f]+:[0-9a-f]+$/.test(hash) ? 'scrypt salt:hash hex' : 'OTHER');
  // @better-auth/utils/password takes positional args (hash, password).
  // better-auth's own re-export wraps them into { hash, password } object —
  // both wind up calling the same scrypt loop.
  const ok = await verifyPassword(hash, candidate);
  console.log('verifyPassword result:', ok);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await pool.end();
}
