// Plan 8.6 Schritt 0 — DB-Verifikation:
// 1. user-Tabelle: existieren role / banned / ban_reason?
// 2. Better-Auth Session-Tabelle: heißt sie "session" oder "sessions"?
// 3. Plugin-Check via package.json (parallel via Node fs)

import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const dotenvPath = '.env.local';
// Manuelles .env.local-Loading falls dotenv-Config nicht greift
try {
  const env = readFileSync(dotenvPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.+)"$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // ignore
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('\n=== 1. user-Tabelle Spalten ===');
  const userCols = await pool.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'user' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `);
  for (const c of userCols.rows) {
    console.log(
      `  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(15)} default=${c.column_default ?? 'NULL'}`
    );
  }
  const hasRole = userCols.rows.some((r) => r.column_name === 'role');
  const hasBanned = userCols.rows.some((r) => r.column_name === 'banned');
  const hasBanReason = userCols.rows.some((r) => r.column_name === 'ban_reason');
  const hasBanExpires = userCols.rows.some((r) => r.column_name === 'ban_expires');

  console.log('\n=== 2. Session-Tabellen ===');
  const sessionTables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ILIKE '%session%'
    ORDER BY table_name;
  `);
  for (const t of sessionTables.rows) console.log(`  ${t.table_name}`);

  console.log('\n=== 3. Plugin-Check (package.json) ===');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const adminPluginInstalled =
    '@better-auth/admin' in allDeps || 'better-auth/admin' in allDeps;
  console.log(`  @better-auth/admin installed: ${adminPluginInstalled ? 'YES' : 'NO'}`);
  if (!adminPluginInstalled) {
    console.log('  (will need own banUser/unbanUser SQL + session-revoke)');
  }

  console.log('\n=== 4. Aktuelle Admin-Kandidaten (User mit angeforderten Emails) ===');
  const targetEmails = [
    'demo-admin@example.com',
    'estonia.woehlte@gmail.com',
    'test.woehlte@gmail.com',
    'heidrun.woehlte@gmail.com'
  ];
  const adminQuery = hasRole
    ? `SELECT id, email, role, banned FROM public."user" WHERE email = ANY($1::text[])`
    : `SELECT id, email FROM public."user" WHERE email = ANY($1::text[])`;
  const adminRows = await pool.query(adminQuery, [targetEmails]);
  for (const r of adminRows.rows) {
    console.log(
      `  ${r.email.padEnd(30)} id=${r.id} ${hasRole ? `role=${r.role} banned=${r.banned}` : '(no role column)'}`
    );
  }

  console.log('\n=== Verdict ===');
  if (hasRole && hasBanned && hasBanReason) {
    console.log('  Variante A/B: Spalten vorhanden — keine Migration nötig.');
  } else if (hasRole && hasBanned && !hasBanReason) {
    console.log('  Variante B: role+banned vorhanden, ban_reason FEHLT → Migration 007 nur für ban_reason.');
  } else {
    const missing = [
      !hasRole ? 'role' : null,
      !hasBanned ? 'banned' : null,
      !hasBanReason ? 'ban_reason' : null,
      !hasBanExpires ? 'ban_expires' : null
    ].filter(Boolean);
    console.log(`  Variante C: Migration 007 nötig — fehlende Spalten: ${missing.join(', ')}`);
  }
  console.log(
    `  Session-Tabelle: ${sessionTables.rows.length === 0 ? 'KEINE GEFUNDEN (!)' : sessionTables.rows[0].table_name}`
  );

  await pool.end();
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
