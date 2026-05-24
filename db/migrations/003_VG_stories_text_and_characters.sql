-- db/migrations/003_VG_stories_text_and_characters.sql
--
-- Plan 8b — VG_stories um zwei Spalten erweitern:
--  - `characters`: JSONB-Array von Character-UUIDs (welche Charaktere
--    sind in der Story eingebunden)
--  - `story_text`: Freitext-Beschreibung der Story (vor Sonnet-Aufteilung)
--
-- Beide Spalten sind NOT NULL nur in der applikatorischen Logik —
-- die DB akzeptiert NULL für story_text bei rückwärtskompatiblen Pre-8b-
-- Records. DEFAULT '[]'::jsonb für `characters` damit listStories einen
-- vorhersagbaren Wert liefert.

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS story_text TEXT;
