// Quick story diagnostics — pass storyId as argv[2]
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.+)"$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const storyId = process.argv[2];
if (!storyId) {
  console.error('Usage: node scripts/inspect-story.mjs <storyId>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(`\n=== Story ${storyId} ===`);
  const story = await pool.query(
    `SELECT id, user_id, title, status, characters,
            image_model, video_model, lipsync_model, credit_budget
     FROM public."VG_stories" WHERE id = $1`,
    [storyId]
  );
  if (story.rows.length === 0) {
    console.error('Story not found');
    await pool.end();
    return;
  }
  for (const [k, v] of Object.entries(story.rows[0])) {
    console.log(`  ${k.padEnd(15)} ${JSON.stringify(v)}`);
  }

  console.log(`\n=== Scenes ===`);
  const scenes = await pool.query(
    `SELECT scene_order, type, status, image_url IS NOT NULL AS has_image,
            audio_url IS NOT NULL AS has_audio,
            neutral_video_url IS NOT NULL AS has_neutral,
            video_url IS NOT NULL AS has_video,
            fal_request_ids,
            speaking_character_id IS NOT NULL AS has_speaker,
            error_message
     FROM public."VG_story_scenes"
     WHERE story_id = $1 ORDER BY scene_order`,
    [storyId]
  );
  for (const r of scenes.rows) {
    const flags = [
      r.has_image ? 'IMG' : '   ',
      r.has_audio ? 'AUD' : '   ',
      r.has_neutral ? 'NEU' : '   ',
      r.has_video ? 'VID' : '   '
    ].join(' ');
    const fal = r.fal_request_ids
      ? Object.entries(r.fal_request_ids).map(([k, v]) => `${k}=${v.slice(0, 8)}…`).join(' ')
      : '—';
    console.log(
      `  #${String(r.scene_order).padStart(2)} ${r.type.padEnd(7)} ` +
        `status=${r.status.padEnd(10)} ${flags} ` +
        (r.has_speaker ? 'speaker ' : '        ') +
        `fal:${fal}` +
        (r.error_message ? ` ERR:${r.error_message}` : '')
    );
  }

  console.log(`\n=== Recent transactions (last 15) ===`);
  const tx = await pool.query(
    `SELECT created_at, action, amount, balance_after, scene_id, meta
     FROM public."VG_credit_transactions"
     WHERE story_id = $1
     ORDER BY created_at DESC LIMIT 15`,
    [storyId]
  );
  for (const r of tx.rows) {
    const sceneShort = r.scene_id ? r.scene_id.slice(0, 8) + '…' : '       —';
    const metaBrief = r.meta
      ? Object.entries(r.meta)
          .filter(([k]) => k !== 'settled_reserve_ids')
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 12) : v}`)
          .join(' ')
      : '';
    console.log(
      `  ${r.created_at.toISOString().slice(11, 19)}  ` +
        `${r.action.padEnd(20)} ${String(r.amount).padStart(6)}  ` +
        `bal:${String(r.balance_after).padStart(6)}  ` +
        `${sceneShort}  ${metaBrief}`
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
