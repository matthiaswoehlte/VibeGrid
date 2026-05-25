/**
 * Plan 8.5 — fal.ai cost table.
 *
 * Stand: 2026-05-25 · Quelle: fal.ai pricing page.
 * Konservativ gerundet (aufwärts auf nächsten vollen Cent).
 *
 * 1 Credit = $0.01 (Cent). INTEGER in DB — keine Floating-Point-Drift.
 */

export const COST_TABLE = {
  flux_image: 3, //        $0.025 / image    → 3¢
  kling_video_5s: 90, //   $0.85  / 5s-clip  → 90¢
  kling_video_10s: 155, // $1.50  / 10s-clip → 155¢
  sync_lipsync_5s: 40, //  $0.35  / 5s       → 40¢
  sync_lipsync_10s: 65, // $0.60  / 10s      → 65¢
  musetalk: 55, //         $0.50  / clip     → 55¢
  elevenlabs_tts: 2, //    $0.01  / call     → 2¢
  edge_tts: 0 //           free
} as const;

/**
 * Hard-Stop-Puffer: ein Run wird geblockt wenn
 * `balance < estimate + SAFETY_BUFFER` ($1.00).
 *
 * Fängt Kostenabweichungen bei langen Videos oder zwischenzeitlichen
 * Retries auf, ohne den User mit einem False-Positive zu blocken.
 */
export const SAFETY_BUFFER = 100;

export type CreditAction =
  | keyof typeof COST_TABLE
  | 'reserve'
  | 'reserve_settle'
  | 'reserve_refund'
  | 'admin_grant'
  | 'onboarding_default';
