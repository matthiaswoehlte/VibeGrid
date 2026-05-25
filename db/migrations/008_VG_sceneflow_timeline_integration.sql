-- db/migrations/008_VG_sceneflow_timeline_integration.sql
--
-- Plan 8d — Timeline-Integration.
--
-- BEWUSSTE ENTSCHEIDUNG (User-confirmed, 2026-05-25): die bestehenden
-- VG_projects-Snapshots werden gewipet statt migriert. Wir führen zwei
-- neue TrackKind-Werte ein ('main-video', 'sync-audio'), und die alten
-- JSONB-Snapshots in VG_projects.state haben die alten Werte. Eine
-- Migrate-Hook im Zustand-Store würde das auf-runtime fangen, aber wir
-- haben aktuell <5 Test-Projekte und keine Production-User — Wipe ist
-- schneller und vermeidet Migrate-Bug-Surface.

DELETE FROM public."VG_projects";

-- VG_stories: optional sync audio (music track) + BPM + snap mode.
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS sync_audio_url TEXT;

-- BPM client-side detected, persistiert beim Upload — Transfer-Route
-- liest direkt, kein nachträgliches Detect zur Submit-Zeit. CHECK
-- spiegelt BPM_MIN/BPM_MAX aus lib/audio/types.ts (60..200) — locker
-- nach oben hin auf 300, falls jemand ein Drum'n'Bass-Sample mit
-- detected 280 BPM hochlädt.
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS sync_audio_bpm INTEGER
    CHECK (sync_audio_bpm IS NULL OR (sync_audio_bpm BETWEEN 40 AND 300));

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS snap_mode TEXT
    NOT NULL DEFAULT 'beat'
    CHECK (snap_mode IN ('beat', 'bar', 'off'));
