-- VibeGrid Plan 8a — SceneFlow Fundament tables.
--
-- Same security model as 001_VG_projects.sql: anon/authenticated REVOKE'd,
-- service_role GRANT'd, RLS deny-policy as defense-in-depth. API routes
-- scope by session.user.id in every WHERE clause.
--
-- VG_fn_touch_updated_at() is defined in 001_VG_projects.sql; CREATE OR REPLACE
-- there makes re-applying idempotent.

-- ---------- VG_characters ----------
CREATE TABLE IF NOT EXISTS public."VG_characters" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('person', 'group')),
  reference_image_url TEXT,
  voice_provider      TEXT CHECK (voice_provider IN ('azure', 'elevenlabs')),
  voice_id            TEXT,
  image_prompt        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_characters_user_id"
  ON public."VG_characters"(user_id);

ALTER TABLE public."VG_characters" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_characters_deny_anon" ON public."VG_characters";
CREATE POLICY "VG_policy_characters_deny_anon" ON public."VG_characters"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_characters" TO service_role;
REVOKE ALL ON public."VG_characters" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_characters_touch_updated_at" ON public."VG_characters";
CREATE TRIGGER "VG_trigger_characters_touch_updated_at"
  BEFORE UPDATE ON public."VG_characters"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_stories ----------
CREATE TABLE IF NOT EXISTS public."VG_stories" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled Story',
  format        TEXT NOT NULL DEFAULT '16:9'
                CHECK (format IN ('16:9', '9:16', '4:3')),
  visual_style  TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'generating', 'done', 'error')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_stories_user_id_updated_at"
  ON public."VG_stories"(user_id, updated_at DESC);

ALTER TABLE public."VG_stories" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_stories_deny_anon" ON public."VG_stories";
CREATE POLICY "VG_policy_stories_deny_anon" ON public."VG_stories"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_stories" TO service_role;
REVOKE ALL ON public."VG_stories" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_stories_touch_updated_at" ON public."VG_stories";
CREATE TRIGGER "VG_trigger_stories_touch_updated_at"
  BEFORE UPDATE ON public."VG_stories"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_story_scenes ----------
CREATE TABLE IF NOT EXISTS public."VG_story_scenes" (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id              UUID NOT NULL REFERENCES public."VG_stories"(id) ON DELETE CASCADE,
  scene_order           INTEGER NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('action', 'dialog', 'endcard')),
  image_prompt          TEXT,
  motion_prompt         TEXT,
  camera_control        JSONB,
  duration              INTEGER NOT NULL DEFAULT 5,
  audio_type            TEXT NOT NULL DEFAULT 'none'
                        CHECK (audio_type IN ('none', 'voiceover', 'lipsync')),
  tts_text              TEXT,
  speaking_character_id UUID REFERENCES public."VG_characters"(id) ON DELETE SET NULL,
  transition            TEXT NOT NULL DEFAULT 'last-frame'
                        CHECK (transition IN ('last-frame', 'crossfade', 'cut')),
  start_frame_mode      TEXT NOT NULL DEFAULT 'auto'
                        CHECK (start_frame_mode IN ('auto', 'from-previous', 'custom')),
  start_frame_url       TEXT,
  image_url             TEXT,
  video_url             TEXT,
  audio_url             TEXT,
  end_frame_url         TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'generating', 'done', 'error')),
  error_message         TEXT,
  fal_request_ids       JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_story_scenes_story_id"
  ON public."VG_story_scenes"(story_id, scene_order);

ALTER TABLE public."VG_story_scenes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_story_scenes_deny_anon" ON public."VG_story_scenes";
CREATE POLICY "VG_policy_story_scenes_deny_anon" ON public."VG_story_scenes"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_story_scenes" TO service_role;
REVOKE ALL ON public."VG_story_scenes" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_story_scenes_touch_updated_at" ON public."VG_story_scenes";
CREATE TRIGGER "VG_trigger_story_scenes_touch_updated_at"
  BEFORE UPDATE ON public."VG_story_scenes"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();
