-- db/migrations/006_VG_credits.sql
--
-- Plan 8.5 — Credit-System (vor 8c-Live).
-- Authz: Better-Auth (kein Supabase Auth, auth.uid() always NULL).
-- Pattern wie 001–005: deny anon/authenticated, grant service_role.
-- Per-User-Scope via WHERE user_id = $1 im API-Layer.

CREATE TABLE IF NOT EXISTS public."VG_user_credits" (
  user_id         TEXT        PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  balance         INTEGER     NOT NULL DEFAULT 500 CHECK (balance >= 0),
  lifetime_spent  INTEGER     NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."VG_credit_transactions" (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  -- positiv = Aufladung/Refund, negativ = Verbrauch/Reserve
  amount          INTEGER     NOT NULL,
  balance_after   INTEGER     NOT NULL,
  -- action enum:
  --   'flux_image' | 'kling_video_5s' | 'kling_video_10s'
  --   | 'sync_lipsync_5s' | 'sync_lipsync_10s' | 'musetalk'
  --   | 'elevenlabs_tts' | 'edge_tts'
  --   | 'reserve' | 'reserve_settle' | 'reserve_refund'
  --   | 'admin_grant' | 'onboarding_default'
  action          TEXT        NOT NULL,
  story_id        TEXT,
  scene_id        TEXT,
  -- meta JSONB schema:
  --   { fal_request_id, model_id, duration_sec, fal_cost_usd_cents,
  --     reserved_amount, overage_credits,
  --     settled_reserve_ids?: string[],  -- JSONB array der gesettleten reserve-Transaction-UUIDs
  --     reason?: string }                -- z.B. 'implicit_cancel_on_retry'
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_credit_transactions_user_id_idx"
  ON public."VG_credit_transactions"(user_id);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_created_at_idx"
  ON public."VG_credit_transactions"(created_at DESC);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_scene_id_idx"
  ON public."VG_credit_transactions"(scene_id)
  WHERE scene_id IS NOT NULL;

-- RLS — selbes Pattern wie 001_VG_projects.sql (deny-anon, service_role grant)
ALTER TABLE public."VG_user_credits"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VG_credit_transactions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_user_credits_deny_anon" ON public."VG_user_credits";
CREATE POLICY "VG_policy_user_credits_deny_anon"
  ON public."VG_user_credits"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "VG_policy_credit_transactions_deny_anon" ON public."VG_credit_transactions";
CREATE POLICY "VG_policy_credit_transactions_deny_anon"
  ON public."VG_credit_transactions"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_user_credits"        TO service_role;
GRANT ALL ON public."VG_credit_transactions" TO service_role;
REVOKE ALL ON public."VG_user_credits"        FROM anon, authenticated;
REVOKE ALL ON public."VG_credit_transactions" FROM anon, authenticated;

-- VG_story_scenes CHECK-Constraint unverändert — kein neuer Status-Enum.
-- Insufficient-Credits-Pfad nutzt status='error' + error_message='insufficient credits'.

-- Per-Story Budget-Cap
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS credit_budget INTEGER DEFAULT NULL;
  -- NULL = kein Limit. Positiver Wert = max Credits für diese Story.
