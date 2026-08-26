PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  stage TEXT NOT NULL DEFAULT 'consultation',
  completed_stages TEXT NOT NULL DEFAULT '["buyerExperience"]',
  answers_json TEXT NOT NULL,
  access_code_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buyer_sessions (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  remembered INTEGER NOT NULL DEFAULT 0,
  elevated_until TEXT,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers(email);
CREATE INDEX IF NOT EXISTS idx_buyers_submitted ON buyers(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_buyer ON buyer_sessions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON buyer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at, created_at DESC);
