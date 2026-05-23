#!/usr/bin/env node
// Plan 7 — apply a .sql file against DATABASE_URL.
// Usage: node -r dotenv/config scripts/apply-migration.mjs <path-to-sql> dotenv_config_path=.env.local
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to-sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (load via -r dotenv/config dotenv_config_path=.env.local)');
  process.exit(1);
}

const sql = await readFile(file, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log('OK — applied', file);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 2;
} finally {
  await pool.end();
}
