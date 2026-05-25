-- db/migrations/005_VG_sceneflow_render.sql
--
-- Plan 8c — fal.ai Render-Pipeline:
--  - VG_story_scenes.neutral_video_url: für die Dialog-3-Schritt-Pipeline
--    (Kling neutral portrait → sync-lipsync). Wird gesetzt nachdem Schritt 2
--    (Kling neutrales Video) abgeschlossen ist; bleibt erhalten bei Retry des
--    LipSync-Schritts, damit Schritt 2 nicht doppelt bezahlt wird.
--  - VG_stories.image_model / video_model / lipsync_model: pro Story
--    konfigurierbare fal.ai-Modell-IDs. DEFAULTs sorgen dafür dass alte Rows
--    nach der Migration nicht crashen. Tolerant gegen unbekannte IDs (UI
--    fällt auf Default zurück, kein Crash).

ALTER TABLE public."VG_story_scenes"
  ADD COLUMN IF NOT EXISTS neutral_video_url TEXT;

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS image_model TEXT
    DEFAULT 'fal-ai/flux/dev';

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS video_model TEXT
    DEFAULT 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS lipsync_model TEXT
    DEFAULT 'fal-ai/sync-lipsync/v3';
