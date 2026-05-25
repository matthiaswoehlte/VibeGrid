// One-shot: apply migrations 005 + 006 to the live Supabase DB.
// Idempotent — uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.+)"$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FILES = [
  'db/migrations/005_VG_sceneflow_render.sql',
  'db/migrations/006_VG_credits.sql',
  'db/migrations/008_VG_sceneflow_timeline_integration.sql'
];

async function tableExists(name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function main() {
  console.log('\n=== Before ===');
  for (const t of ['VG_user_credits', 'VG_credit_transactions']) {
    console.log(`  ${t}: ${(await tableExists(t)) ? 'EXISTS' : 'MISSING'}`);
  }
  console.log(
    `  VG_story_scenes.neutral_video_url: ${
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'VG_story_scenes'
             AND column_name = 'neutral_video_url'`
        )
      ).rows.length
        ? 'EXISTS'
        : 'MISSING'
    }`
  );

  for (const f of FILES) {
    console.log(`\n=== Applying ${f} ===`);
    const sql = readFileSync(f, 'utf8');
    try {
      await pool.query(sql);
      console.log('  OK');
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
      process.exit(1);
    }
  }

  console.log('\n=== After ===');
  for (const t of ['VG_user_credits', 'VG_credit_transactions']) {
    console.log(`  ${t}: ${(await tableExists(t)) ? 'EXISTS' : 'MISSING'}`);
  }
  console.log(
    `  VG_story_scenes.neutral_video_url: ${
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'VG_story_scenes' AND column_name = 'neutral_video_url'`
        )
      ).rows.length
        ? 'EXISTS'
        : 'MISSING'
    }`
  );
  console.log(
    `  VG_stories.credit_budget: ${
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'VG_stories' AND column_name = 'credit_budget'`
        )
      ).rows.length
        ? 'EXISTS'
        : 'MISSING'
    }`
  );
  console.log(
    `  VG_stories.image_model: ${
      (
        await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'VG_stories' AND column_name = 'image_model'`
        )
      ).rows.length
        ? 'EXISTS'
        : 'MISSING'
    }`
  );

  await pool.end();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
