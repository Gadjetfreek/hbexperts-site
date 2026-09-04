-- Showing Card / Property field dossier (additive).
-- Apply AFTER schema.sql and schema-issue29.sql on the target D1.
-- Seed IDs only — no private correspondence, answers, or media in git.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS showing_properties (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  mls TEXT NOT NULL DEFAULT '',
  ask_price INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS showing_visits (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  visited_at TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('planned','in_progress','complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES showing_properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS showing_answers (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  visit_id TEXT,
  field_id TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE(property_id, field_id),
  FOREIGN KEY (property_id) REFERENCES showing_properties(id) ON DELETE CASCADE,
  FOREIGN KEY (visit_id) REFERENCES showing_visits(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS showing_observations (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (property_id) REFERENCES showing_properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS showing_photos (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  field_id TEXT,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (property_id) REFERENCES showing_properties(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_showing_properties_case ON showing_properties(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_showing_visits_property ON showing_visits(property_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_showing_answers_property ON showing_answers(property_id, field_id);
CREATE INDEX IF NOT EXISTS idx_showing_observations_property ON showing_observations(property_id, section_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showing_photos_property ON showing_photos(property_id, field_id, created_at DESC);

-- Minimal operational seed (identifiers only). Runtime ensureSeed also upserts these.
-- Synthetic emails use @example.test — no real correspondence.
-- INSERT OR IGNORE INTO buyer_cases (id, created_at, updated_at, stage, completed_stages, status)
--   VALUES ('case-steinberger', datetime('now'), datetime('now'), 'possibilities', '[]', 'active');
-- INSERT OR IGNORE INTO buyers (...) VALUES ('buyer-steinberger-richard', ..., 'steinberger.buyer@example.test', ...);
-- INSERT OR IGNORE INTO showing_properties (...) VALUES ('prop-brigham-7511', 'case-steinberger', '7511 Brigham Rd', ...);
