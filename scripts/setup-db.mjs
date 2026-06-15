#!/usr/bin/env node
// ============================================================================
// VibeGrid — one-shot database setup.
//
// Applies the complete schema in db/schema.sql to a fresh (or existing)
// database in a single run. Idempotent: safe to re-run, and it upgrades a
// partially-provisioned database in place.
//
//   npm run db:setup
//   # or: node scripts/setup-db.mjs
//
// Connection: prefers DIRECT_URL (Supabase session mode, port 5432) because
// the transaction pooler (pgbouncer, port 6543) rejects multi-statement DDL.
// Falls back to DATABASE_URL when DIRECT_URL is unset.
// ============================================================================

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// --- Load env (.env.local overrides .env) without a hard dotenv dependency ---
function loadEnvFile(name) {
  const p = join(repoRoot, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^["']|["']$/g, ''); // strip surrounding quotes
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('✗ Neither DIRECT_URL nor DATABASE_URL is set (check .env.local).');
  process.exit(1);
}
const usingDirect = Boolean(process.env.DIRECT_URL);
console.log(`→ Connecting via ${usingDirect ? 'DIRECT_URL' : 'DATABASE_URL'}`);

const EXPECTED_TABLES = [
  'user', 'session', 'account', 'verification',
  'VG_projects', 'VG_characters', 'VG_stories',
  'VG_story_scenes', 'VG_user_credits', 'VG_credit_transactions'
];

const pool = new Pool({ connectionString });

async function tableExists(name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function main() {
  const schemaPath = join(repoRoot, 'db', 'schema.sql');
  const sql = await readFile(schemaPath, 'utf8');

  console.log('\n=== Applying db/schema.sql ===');
  try {
    await pool.query(sql);
    console.log('  OK');
  } catch (e) {
    console.error(`  FAIL: ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  console.log('\n=== Verify ===');
  let allPresent = true;
  for (const t of EXPECTED_TABLES) {
    const ok = await tableExists(t);
    if (!ok) allPresent = false;
    console.log(`  ${ok ? '✓' : '✗ MISSING'}  public."${t}"`);
  }

  await pool.end();
  if (!allPresent) {
    console.error('\n✗ Some expected tables are missing — see above.');
    process.exit(1);
  }
  console.log('\n✓ Database ready.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
