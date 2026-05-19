-- VibeGrid D1 schema (prepared, not applied in v0.1).
-- Applied in v0.2 via `wrangler d1 execute vibegrid --file=db/schema.sql`.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  duration_beats INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT CHECK (kind IN ('image','audio')) NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  width INTEGER, height INTEGER, duration_ms INTEGER,
  uploaded_at INTEGER NOT NULL
);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  track_kind TEXT NOT NULL,
  fx_id TEXT,
  media_id TEXT REFERENCES media(id),
  start_beat REAL NOT NULL,
  length_beats REAL NOT NULL,
  params_json TEXT,        -- serialized Record<string, unknown> matching FxPlugin.paramSchema
  trigger TEXT
);

CREATE INDEX idx_clips_project ON clips(project_id);
CREATE INDEX idx_media_project ON media(project_id);
