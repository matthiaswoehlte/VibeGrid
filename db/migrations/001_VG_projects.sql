-- VibeGrid Plan 7 — VG_projects table with RLS lockdown.
--
-- All tables, indexes, functions, triggers, policies are prefixed VG_
-- so the VibeGrid footprint stays isolated from the other apps sharing
-- this Supabase instance.
--
-- Authz model: Better-Auth (NOT Supabase Auth) — auth.uid() is always
-- NULL in this DB. anon/authenticated roles are REVOKE'd. The Next.js
-- API routes hit the DB via service_role through pg.Pool, scoped by
-- session.user.id in every WHERE clause. RLS policies below are
-- defense-in-depth only.

CREATE TABLE IF NOT EXISTS public."VG_projects" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Untitled Project',
  store_version INTEGER NOT NULL,
  state         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_projects_user_id_updated_at"
  ON public."VG_projects"(user_id, updated_at DESC);

ALTER TABLE public."VG_projects" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_projects_deny_anon" ON public."VG_projects";
CREATE POLICY "VG_policy_projects_deny_anon" ON public."VG_projects"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_projects" TO service_role;
REVOKE ALL ON public."VG_projects" FROM anon, authenticated;

-- updated_at maintenance trigger.
CREATE OR REPLACE FUNCTION public."VG_fn_touch_updated_at"()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "VG_trigger_projects_touch_updated_at" ON public."VG_projects";
CREATE TRIGGER "VG_trigger_projects_touch_updated_at"
  BEFORE UPDATE ON public."VG_projects"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();
