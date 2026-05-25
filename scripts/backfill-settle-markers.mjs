// Backfill missing reserve_settle markers for stories where status-all
// completed scenes before the settle-bug fix landed. Idempotent — only
// inserts a settle row for a reserve that doesn't already have one.
//
// Pass storyId as argv[2] (or "all" for every story of the calling user).

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
  console.error('Usage: node scripts/backfill-settle-markers.mjs <storyId>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Find every reserve transaction on this story whose scene is now
  // status='done' with a video_url, and where no reserve_settle or
  // reserve_refund row already references this reserve.
  const { rows: open } = await pool.query(
    `SELECT
       r.id::text         AS reserve_id,
       r.user_id          AS user_id,
       r.scene_id         AS scene_id,
       r.amount           AS reserve_amount,
       s.type             AS scene_type,
       s.duration         AS scene_duration,
       st.lipsync_model   AS lipsync_model
     FROM public."VG_credit_transactions" r
     JOIN public."VG_story_scenes" s ON s.id::text = r.scene_id
     JOIN public."VG_stories" st     ON st.id = s.story_id
     WHERE r.story_id = $1
       AND r.action = 'reserve'
       AND s.status = 'done'
       AND s.video_url IS NOT NULL
       AND r.id::text NOT IN (
         SELECT jsonb_array_elements_text(t.meta->'settled_reserve_ids')
         FROM public."VG_credit_transactions" t
         WHERE t.story_id = $1
           AND t.action IN ('reserve_settle', 'reserve_refund')
           AND t.meta ? 'settled_reserve_ids'
       )`,
    [storyId]
  );

  console.log(`\nFound ${open.length} open reserve(s) on story ${storyId}:`);
  for (const r of open) {
    console.log(
      `  scene=${r.scene_id.slice(0, 8)}… type=${r.scene_type} reserved=${-r.reserve_amount}`
    );
  }
  if (open.length === 0) {
    await pool.end();
    return;
  }

  // For each reserve, compute the actual cost: action = kling, dialog =
  // kling + lipsync. Then emit a single reserve_settle that closes it.
  for (const r of open) {
    const klingPart = r.scene_duration <= 5 ? 90 : 155;
    const lipPart =
      r.scene_type === 'dialog'
        ? r.lipsync_model === 'fal-ai/musetalk'
          ? 55
          : r.scene_duration <= 5
            ? 40
            : 65
        : 0;
    const actual = klingPart + lipPart;
    const reserved = -r.reserve_amount;
    const diff = reserved - actual; // positive → refund difference

    const { rows: balRows } = await pool.query(
      `SELECT balance FROM public."VG_user_credits" WHERE user_id = $1`,
      [r.user_id]
    );
    const currentBal = balRows[0]?.balance ?? 0;

    if (diff > 0) {
      // refund difference + emit settle marker with the new balance
      const { rows: bumpRows } = await pool.query(
        `UPDATE public."VG_user_credits"
           SET balance = balance + $1, updated_at = now()
         WHERE user_id = $2
         RETURNING balance`,
        [diff, r.user_id]
      );
      const newBal = bumpRows[0].balance;
      await pool.query(
        `INSERT INTO public."VG_credit_transactions"
           (user_id, amount, balance_after, action, story_id, scene_id, meta)
         VALUES ($1, $2, $3, 'reserve_settle', $4, $5, $6::jsonb)`,
        [
          r.user_id,
          diff,
          newBal,
          storyId,
          r.scene_id,
          JSON.stringify({
            reserved_amount: reserved,
            settled_reserve_ids: [r.reserve_id],
            reason: 'backfill_post_settle_bug_fix'
          })
        ]
      );
      console.log(
        `  ↑ refund ${diff} for scene ${r.scene_id.slice(0, 8)}… (reserved ${reserved}, actual ${actual})`
      );
    } else {
      // actual === reserved → zero-amount marker, balance unchanged
      await pool.query(
        `INSERT INTO public."VG_credit_transactions"
           (user_id, amount, balance_after, action, story_id, scene_id, meta)
         VALUES ($1, 0, $2, 'reserve_settle', $3, $4, $5::jsonb)`,
        [
          r.user_id,
          currentBal,
          storyId,
          r.scene_id,
          JSON.stringify({
            reserved_amount: reserved,
            settled_reserve_ids: [r.reserve_id],
            reason: 'backfill_post_settle_bug_fix'
          })
        ]
      );
      console.log(
        `  ✓ marker for scene ${r.scene_id.slice(0, 8)}… (reserved=actual=${reserved})`
      );
    }
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
