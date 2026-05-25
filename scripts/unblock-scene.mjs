// Recovery for a dialog scene that has neutral_video_url set + an open
// 'reserve' but no lipsync request_id (the retry-video pre-fix bug):
// submit the lipsync job via fal.queue.submit, write request_id back,
// flip status to 'generating'.
//
// Pass sceneId as argv[2].

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { fal } from '@fal-ai/client';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(?:"(.*)"|(.*))$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2] ?? m[3] ?? '';
  }
} catch {}

if (!process.env.FAL_KEY) {
  console.error('FAL_KEY not set');
  process.exit(1);
}
fal.config({ credentials: process.env.FAL_KEY });

const sceneId = process.argv[2];
if (!sceneId) {
  console.error('Usage: node scripts/unblock-scene.mjs <sceneId>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT s.id, s.type, s.audio_url, s.neutral_video_url, s.video_url,
            s.fal_request_ids, s.status, st.lipsync_model
     FROM public."VG_story_scenes" s
     JOIN public."VG_stories" st ON st.id = s.story_id
     WHERE s.id = $1`,
    [sceneId]
  );
  if (rows.length === 0) {
    console.error('Scene not found');
    await pool.end();
    return;
  }
  const scene = rows[0];
  console.log(`Scene state:`);
  console.log(`  type:              ${scene.type}`);
  console.log(`  status:            ${scene.status}`);
  console.log(`  audio_url:         ${scene.audio_url ?? '—'}`);
  console.log(`  neutral_video_url: ${scene.neutral_video_url ?? '—'}`);
  console.log(`  video_url:         ${scene.video_url ?? '—'}`);
  console.log(`  fal_request_ids:   ${JSON.stringify(scene.fal_request_ids)}`);
  console.log(`  lipsync_model:     ${scene.lipsync_model}`);

  if (scene.video_url) {
    console.log('\nScene already has video_url — nothing to do.');
    await pool.end();
    return;
  }
  if (!scene.neutral_video_url) {
    console.error('\nNo neutral_video_url — needs Kling step first.');
    await pool.end();
    return;
  }
  if (!scene.audio_url) {
    console.error('\nNo audio_url — synthesize TTS first.');
    await pool.end();
    return;
  }
  if (scene.fal_request_ids?.lipsync) {
    console.error(
      `\nLipSync request_id already exists: ${scene.fal_request_ids.lipsync}. Status route should pick it up on next poll.`
    );
    await pool.end();
    return;
  }

  console.log(`\nSubmitting LipSync (${scene.lipsync_model})…`);
  const endpoint =
    scene.lipsync_model === 'fal-ai/musetalk'
      ? 'fal-ai/musetalk'
      : 'fal-ai/sync-lipsync/v3';
  const input =
    scene.lipsync_model === 'fal-ai/musetalk'
      ? { source_video_url: scene.neutral_video_url, audio_url: scene.audio_url }
      : {
          video_url: scene.neutral_video_url,
          audio_url: scene.audio_url,
          sync_mode: 'remap'
        };
  const submitted = await fal.queue.submit(endpoint, { input });
  console.log(`  request_id: ${submitted.request_id}`);

  await pool.query(
    `UPDATE public."VG_story_scenes"
       SET status = 'generating',
           fal_request_ids = COALESCE(fal_request_ids, '{}'::jsonb)
                             || jsonb_build_object('lipsync', $1::text),
           updated_at = now()
     WHERE id = $2`,
    [submitted.request_id, sceneId]
  );
  console.log(`\nScene unblocked. Polling will pick it up on next /status-all tick.`);

  await pool.end();
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
