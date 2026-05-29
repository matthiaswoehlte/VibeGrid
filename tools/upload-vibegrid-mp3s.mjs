#!/usr/bin/env node
/**
 * Bulk-seed the Sound Library from `tools/VibeGrid_MP3/`.
 *
 * - Walks the directory recursively.
 * - For each .mp3 file: probes duration via ffprobe, slugifies the
 *   filename, uploads to `library/sfx/<category-slug>/<id>.mp3` in R2.
 * - Rebuilds `library/manifest.json` from scratch every run — re-running
 *   keeps things in sync with the directory tree, including deletions.
 * - Category = subdirectory name (as-is for the label, slugified for id).
 * - License = "Evenant (free library)" on every entry.
 * - Label = derived from filename minus the .mp3 extension.
 * - Tags / BPM are intentionally empty (per Matthias' spec).
 *
 * Concurrency: 10 parallel uploads. Sequential would take 10+ minutes
 * for ~200 files on a typical residential connection.
 *
 * Usage: `node tools/upload-vibegrid-mp3s.mjs`
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import {
  S3Client,
  PutObjectCommand
} from '@aws-sdk/client-s3';

loadEnv({ path: '.env.local' });

const SOURCE_ROOT = 'tools/VibeGrid_MP3';
const LICENSE = 'Evenant (free library)';
const CONCURRENCY = 10;

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// dotenv does NOT expand `${VAR}` references in .env files. Our R2_ENDPOINT
// is templated with ${R2_ACCOUNT_ID} — expand manually before consuming.
function expandRefs(s) {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, k) => process.env[k] ?? '');
}

const cfg = {
  bucket: envOrDie('R2_BUCKET'),
  endpoint: expandRefs(envOrDie('R2_ENDPOINT')),
  accessKeyId: envOrDie('R2_ACCESS_KEY_ID'),
  secretAccessKey: envOrDie('R2_SECRET_ACCESS_KEY'),
  publicUrl: envOrDie('R2_PUBLIC_URL')
};

const client = new S3Client({
  region: 'auto',
  endpoint: cfg.endpoint,
  credentials: {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey
  },
  requestChecksumCalculation: 'WHEN_REQUIRED'
});

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'sound';
}

async function walkMp3s(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.mp3')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

function probeDuration(path) {
  const res = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path
    ],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`ffprobe failed for ${path}: ${res.stderr || res.error}`);
  }
  const d = Number(res.stdout.trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${path}: ${res.stdout}`);
  }
  return d;
}

async function uploadOne(filePath) {
  const rel = relative(SOURCE_ROOT, filePath);
  const parts = rel.split(sep);
  if (parts.length < 2) {
    throw new Error(`expected a subdirectory under ${SOURCE_ROOT}: ${rel}`);
  }
  const categoryLabel = parts[0];
  const categoryId = slugify(categoryLabel);
  const filename = parts[parts.length - 1];
  const stem = filename.replace(/\.mp3$/i, '');
  const entryId = slugify(stem);
  const r2RelativePath = `sfx/${categoryId}/${entryId}.mp3`;
  const r2Key = `library/${r2RelativePath}`;

  const [bytes, duration] = await Promise.all([
    readFile(filePath),
    Promise.resolve(probeDuration(filePath))
  ]);

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: r2Key,
      Body: bytes,
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable'
    })
  );

  return {
    categoryId,
    categoryLabel,
    entry: {
      id: entryId,
      label: stem,
      url: r2RelativePath,
      duration,
      license: LICENSE
    }
  };
}

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { __error: e instanceof Error ? e.message : String(e) };
      }
      done++;
      if (done % 10 === 0 || done === items.length) {
        process.stdout.write(`\r  ${done}/${items.length} uploaded`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => pump())
  );
  process.stdout.write('\n');
  return results;
}

async function main() {
  console.log(`Scanning ${SOURCE_ROOT}...`);
  await stat(SOURCE_ROOT).catch(() => {
    console.error(`Directory not found: ${SOURCE_ROOT}`);
    process.exit(1);
  });
  const files = await walkMp3s(SOURCE_ROOT);
  console.log(`Found ${files.length} MP3 files.`);
  if (files.length === 0) {
    console.error('Nothing to upload — abort.');
    process.exit(1);
  }

  console.log(`Uploading with concurrency ${CONCURRENCY}...`);
  const results = await withConcurrency(files, CONCURRENCY, uploadOne);

  const succeeded = results.filter((r) => !r.__error);
  const failed = results.filter((r) => r.__error);
  console.log(`✓ ${succeeded.length} uploaded${failed.length ? `, ✗ ${failed.length} failed` : ''}.`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (let i = 0; i < results.length; i++) {
      if (results[i]?.__error) console.log(`  - ${files[i]}: ${results[i].__error}`);
    }
  }

  // Build manifest grouped by category.
  const byCat = new Map();
  for (const r of succeeded) {
    let bucket = byCat.get(r.categoryId);
    if (!bucket) {
      bucket = { id: r.categoryId, label: r.categoryLabel, sounds: [] };
      byCat.set(r.categoryId, bucket);
    }
    bucket.sounds.push(r.entry);
  }
  // Stable ordering: categories alphabetical, sounds alphabetical within.
  const categories = [...byCat.values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
  for (const c of categories) {
    c.sounds.sort((a, b) => a.label.localeCompare(b.label));
  }

  // Read existing manifest version (if any) so we bump cleanly.
  let prevVersion = 0;
  try {
    const res = await fetch(`${cfg.publicUrl}/library/manifest.json`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const prev = await res.json();
      if (typeof prev?.version === 'number') prevVersion = prev.version;
    }
  } catch {
    /* no previous manifest, treat as version 0 */
  }

  const manifest = {
    version: prevVersion + 1,
    updatedAt: new Date().toISOString(),
    categories
  };
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2)
  );
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: 'library/manifest.json',
      Body: manifestBytes,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600'
    })
  );
  console.log(
    `Manifest written — version ${manifest.version}, ` +
      `${categories.length} categories, ${succeeded.length} entries.`
  );
  for (const c of categories) {
    console.log(`  • ${c.label.padEnd(20)} ${c.sounds.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
