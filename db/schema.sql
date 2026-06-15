-- ============================================================================
-- VibeGrid — full PostgreSQL schema (single source of truth for a fresh DB)
-- ============================================================================
--
-- This file is the COMPLETE, idempotent schema for a brand-new database. It
-- folds every incremental migration in db/migrations/ (001..008) plus the
-- never-committed 007 (user role/banned/banReason) into one flat definition,
-- and it adds the Better-Auth tables (user/session/account/verification) that
-- the incremental migrations only ever referenced via foreign key but never
-- created.
--
-- APPLY IT WITH:   node scripts/setup-db.mjs
-- (or:            psql "$DIRECT_URL" -f db/schema.sql)
--
-- Idempotent by design — CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE, DROP ... IF EXISTS — so re-running it is safe and it also
-- upgrades a partially-provisioned database in place.
--
-- REGENERATING THIS FILE
--   * VG_* tables/columns are the final state of db/migrations/001..008.
--   * The auth tables follow the Better-Auth v1.6 default schema
--     (emailAndPassword, no extra plugins) as configured in
--     lib/auth/better-auth-server.ts, extended with the role/banned/banReason
--     columns the admin features read. Better-Auth uses quoted camelCase
--     identifiers in Postgres — keep them quoted exactly as below.
--
-- AUTHZ MODEL
--   Authentication is Better-Auth, NOT Supabase Auth — auth.uid() is always
--   NULL here. The Next.js API routes connect as a privileged role (service
--   role / DB owner) via pg.Pool and scope every query by session.user.id.
--   The VG_* tables enable RLS with deny-all policies for anon/authenticated
--   as defense-in-depth; the auth tables are left to Better-Auth's own access
--   through the privileged connection (matching the original deployment).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================================================
-- 1. Better-Auth tables  (created at the DB level here, NOT by the app)
-- ============================================================================

-- ---------- user ----------
CREATE TABLE IF NOT EXISTS public."user" (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  "emailVerified" BOOLEAN     NOT NULL DEFAULT false,
  image           TEXT,
  "createdAt"     TIMESTAMP   NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP   NOT NULL DEFAULT now(),
  -- VibeGrid admin extension (was planned as migration 007):
  role            TEXT        NOT NULL DEFAULT 'user',  -- CHECK added as named constraint below
  banned          BOOLEAN     NOT NULL DEFAULT false,
  "banReason"     TEXT
);

-- Idempotent upgrade for an already-existing Better-Auth user table that was
-- created before the admin extension (e.g. via the Better-Auth CLI).
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS role        TEXT    NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS banned      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "banReason" TEXT;

ALTER TABLE public."user" DROP CONSTRAINT IF EXISTS "user_role_check";
ALTER TABLE public."user"
  ADD CONSTRAINT "user_role_check" CHECK (role IN ('user', 'admin'));

-- ---------- session ----------
CREATE TABLE IF NOT EXISTS public."session" (
  id           TEXT       PRIMARY KEY,
  "userId"     TEXT       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  token        TEXT       NOT NULL UNIQUE,
  "expiresAt"  TIMESTAMP  NOT NULL,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP  NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "session_userId_idx"    ON public."session"("userId");
CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON public."session"("expiresAt");

-- ---------- account ----------
CREATE TABLE IF NOT EXISTS public."account" (
  id                       TEXT       PRIMARY KEY,
  "userId"                 TEXT       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  "accountId"              TEXT       NOT NULL,
  "providerId"             TEXT       NOT NULL,
  "accessToken"            TEXT,
  "refreshToken"           TEXT,
  "idToken"                TEXT,
  "accessTokenExpiresAt"   TIMESTAMP,
  "refreshTokenExpiresAt"  TIMESTAMP,
  scope                    TEXT,
  password                 TEXT,
  "createdAt"              TIMESTAMP  NOT NULL DEFAULT now(),
  "updatedAt"              TIMESTAMP  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON public."account"("userId");

-- ---------- verification ----------
CREATE TABLE IF NOT EXISTS public."verification" (
  id           TEXT       PRIMARY KEY,
  identifier   TEXT       NOT NULL,
  value        TEXT       NOT NULL,
  "expiresAt"  TIMESTAMP  NOT NULL,
  "createdAt"  TIMESTAMP  DEFAULT now(),
  "updatedAt"  TIMESTAMP  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON public."verification"(identifier);

-- ============================================================================
-- 2. Shared helper — updated_at maintenance trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION public."VG_fn_touch_updated_at"()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ============================================================================
-- 3. VibeGrid tables (final state of migrations 001..008)
-- ============================================================================

-- ---------- VG_projects (001, wiped by 008) ----------
CREATE TABLE IF NOT EXISTS public."VG_projects" (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT         NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name          TEXT         NOT NULL DEFAULT 'Untitled Project',
  store_version INTEGER      NOT NULL,
  state         JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VG_idx_projects_user_id_updated_at"
  ON public."VG_projects"(user_id, updated_at DESC);

DROP TRIGGER IF EXISTS "VG_trigger_projects_touch_updated_at" ON public."VG_projects";
CREATE TRIGGER "VG_trigger_projects_touch_updated_at"
  BEFORE UPDATE ON public."VG_projects"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_characters (002 + 004) ----------
CREATE TABLE IF NOT EXISTS public."VG_characters" (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT         NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name                TEXT         NOT NULL,
  type                TEXT         NOT NULL CHECK (type IN ('person', 'group')),
  reference_image_url TEXT,
  voice_provider      TEXT         CHECK (voice_provider IS NULL OR voice_provider IN ('edge', 'azure', 'elevenlabs')),
  voice_id            TEXT,
  voice_test_text     TEXT,
  image_prompt        TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VG_idx_characters_user_id"
  ON public."VG_characters"(user_id);

DROP TRIGGER IF EXISTS "VG_trigger_characters_touch_updated_at" ON public."VG_characters";
CREATE TRIGGER "VG_trigger_characters_touch_updated_at"
  BEFORE UPDATE ON public."VG_characters"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_stories (002 + 003 + 005 + 006 + 008) ----------
CREATE TABLE IF NOT EXISTS public."VG_stories" (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT         NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  title          TEXT         NOT NULL DEFAULT 'Untitled Story',
  format         TEXT         NOT NULL DEFAULT '16:9' CHECK (format IN ('16:9', '9:16', '4:3')),
  visual_style   TEXT,
  status         TEXT         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'done', 'error')),
  characters     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  story_text     TEXT,
  image_model    TEXT         DEFAULT 'fal-ai/flux/dev',
  video_model    TEXT         DEFAULT 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  lipsync_model  TEXT         DEFAULT 'fal-ai/sync-lipsync/v3',
  credit_budget  INTEGER      DEFAULT NULL,
  sync_audio_url TEXT,
  sync_audio_bpm INTEGER      CHECK (sync_audio_bpm IS NULL OR (sync_audio_bpm BETWEEN 40 AND 300)),
  snap_mode      TEXT         NOT NULL DEFAULT 'beat' CHECK (snap_mode IN ('beat', 'bar', 'off')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VG_idx_stories_user_id_updated_at"
  ON public."VG_stories"(user_id, updated_at DESC);

DROP TRIGGER IF EXISTS "VG_trigger_stories_touch_updated_at" ON public."VG_stories";
CREATE TRIGGER "VG_trigger_stories_touch_updated_at"
  BEFORE UPDATE ON public."VG_stories"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_story_scenes (002 + 005) ----------
CREATE TABLE IF NOT EXISTS public."VG_story_scenes" (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id              UUID         NOT NULL REFERENCES public."VG_stories"(id) ON DELETE CASCADE,
  scene_order           INTEGER      NOT NULL,
  type                  TEXT         NOT NULL CHECK (type IN ('action', 'dialog', 'endcard')),
  image_prompt          TEXT,
  motion_prompt         TEXT,
  camera_control        JSONB,
  duration              INTEGER      NOT NULL DEFAULT 5,
  audio_type            TEXT         NOT NULL DEFAULT 'none' CHECK (audio_type IN ('none', 'voiceover', 'lipsync')),
  tts_text              TEXT,
  speaking_character_id UUID         REFERENCES public."VG_characters"(id) ON DELETE SET NULL,
  transition            TEXT         NOT NULL DEFAULT 'last-frame' CHECK (transition IN ('last-frame', 'crossfade', 'cut')),
  start_frame_mode      TEXT         NOT NULL DEFAULT 'auto' CHECK (start_frame_mode IN ('auto', 'from-previous', 'custom')),
  start_frame_url       TEXT,
  image_url             TEXT,
  video_url             TEXT,
  neutral_video_url     TEXT,
  audio_url             TEXT,
  end_frame_url         TEXT,
  status                TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'done', 'error')),
  error_message         TEXT,
  fal_request_ids       JSONB,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VG_idx_story_scenes_story_id"
  ON public."VG_story_scenes"(story_id, scene_order);

DROP TRIGGER IF EXISTS "VG_trigger_story_scenes_touch_updated_at" ON public."VG_story_scenes";
CREATE TRIGGER "VG_trigger_story_scenes_touch_updated_at"
  BEFORE UPDATE ON public."VG_story_scenes"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_user_credits (006) ----------
CREATE TABLE IF NOT EXISTS public."VG_user_credits" (
  user_id        TEXT         PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  balance        INTEGER      NOT NULL DEFAULT 500 CHECK (balance >= 0),
  lifetime_spent INTEGER      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- VG_credit_transactions (006) ----------
CREATE TABLE IF NOT EXISTS public."VG_credit_transactions" (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT         NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  amount        INTEGER      NOT NULL,   -- positive = top-up/refund, negative = spend/reserve
  balance_after INTEGER      NOT NULL,
  action        TEXT         NOT NULL,
  story_id      TEXT,
  scene_id      TEXT,
  meta          JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_user_id_idx"
  ON public."VG_credit_transactions"(user_id);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_created_at_idx"
  ON public."VG_credit_transactions"(created_at DESC);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_scene_id_idx"
  ON public."VG_credit_transactions"(scene_id) WHERE scene_id IS NOT NULL;

-- ============================================================================
-- 4. Row-Level Security + grants for the VG_* tables (defense-in-depth)
--    Pattern: deny anon/authenticated entirely, grant only service_role.
-- ============================================================================
DO $$
DECLARE
  t              TEXT;
  has_anon       BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authed     BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_service    BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'VG_projects', 'VG_characters', 'VG_stories',
    'VG_story_scenes', 'VG_user_credits', 'VG_credit_transactions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Deny-all policy targets the Supabase anon/authenticated roles; only
    -- create it when they exist (Supabase) — skip on a vanilla Postgres.
    IF has_anon AND has_authed THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'VG_policy_' || t || '_deny_anon', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);',
        'VG_policy_' || t || '_deny_anon', t
      );
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
    END IF;

    IF has_service THEN
      EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
    END IF;
  END LOOP;
END $$;
