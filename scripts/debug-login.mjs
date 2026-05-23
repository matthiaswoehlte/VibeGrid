#!/usr/bin/env node
// Plan 7 — debug why an existing die bestehende Instanz credential fails Better-Auth login.
// Usage: node -r dotenv/config scripts/debug-login.mjs <email> dotenv_config_path=.env.local
import 'dotenv/config';
import { Pool } from 'pg';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/debug-login.mjs <email>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  // 1) Does the user exist?
  const u = await pool.query(
    'SELECT id, email, "emailVerified", "createdAt", "twoFactorEnabled", banned FROM "user" WHERE email = $1',
    [email]
  );
  if (u.rows.length === 0) {
    console.log('NO USER FOUND with email:', email);
    process.exit(0);
  }
  const user = u.rows[0];
  console.log('USER:');
  console.log('  id            ', user.id);
  console.log('  email         ', user.email);
  console.log('  emailVerified ', user.emailVerified);
  console.log('  createdAt     ', user.createdAt);
  console.log('  twoFactorEnabled', user.twoFactorEnabled);
  console.log('  banned        ', user.banned);

  // 2) What accounts exist for this user? (provider list + password format)
  const a = await pool.query(
    'SELECT "providerId", "accountId", LENGTH(password) AS pw_len, SUBSTRING(password FROM 1 FOR 4) AS pw_prefix FROM account WHERE "userId" = $1',
    [user.id]
  );
  console.log('\nACCOUNT ROWS (' + a.rows.length + '):');
  for (const row of a.rows) {
    console.log('  providerId:', row.providerId, ' accountId:', row.accountId,
                ' pw_len:', row.pw_len, ' pw_prefix:', row.pw_prefix);
  }

  // 3) Is there a credential row at all?
  const cred = a.rows.find((r) => r.providerId === 'credential');
  if (!cred) {
    console.log('\nNO credential account — this user signed up via OAuth, not email/password.');
  } else if (!cred.pw_len) {
    console.log('\nCREDENTIAL row exists but password is NULL/empty.');
  } else {
    // Format check: Better-Auth scrypt is "salt:hash" = 32+1+128 = ~161 chars.
    console.log('\nCREDENTIAL row password length:', cred.pw_len,
                cred.pw_len === 161 ? '(standard scrypt salt:hash)' :
                cred.pw_len > 50 ? '(non-standard format)' : '(suspiciously short)');
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await pool.end();
}
