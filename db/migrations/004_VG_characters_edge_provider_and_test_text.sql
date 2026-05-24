-- db/migrations/004_VG_characters_edge_provider_and_test_text.sql
--
-- Voice picker feature (post-Plan-8b):
--  - Extend voice_provider CHECK to include 'edge' (Microsoft Edge TTS — free,
--    same Neural voice IDs as Azure but no subscription key needed).
--    'azure' stays in the enum for a future paid-Azure-Speech path.
--  - Add voice_test_text column: per-character free-text sample sentence used
--    by the CharacterForm "Play" preview button. NULLable — the picker falls
--    back to a locale-aware default when null.

ALTER TABLE public."VG_characters"
  DROP CONSTRAINT IF EXISTS "VG_characters_voice_provider_check";

ALTER TABLE public."VG_characters"
  ADD CONSTRAINT "VG_characters_voice_provider_check"
  CHECK (voice_provider IS NULL OR voice_provider IN ('edge', 'azure', 'elevenlabs'));

ALTER TABLE public."VG_characters"
  ADD COLUMN IF NOT EXISTS voice_test_text TEXT;
