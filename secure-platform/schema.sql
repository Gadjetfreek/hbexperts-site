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

CREATE TABLE IF NOT EXISTS buyer_notes (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  author_email TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'hbe',
  body TEXT NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buyer_tasks (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  stage TEXT,
  visible_to_buyer INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

-- Pilot household layer. Existing buyer records remain valid and are mapped lazily.
CREATE TABLE IF NOT EXISTS buyer_cases (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'consultation',
  completed_stages TEXT NOT NULL DEFAULT '["buyerExperience"]',
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS buyer_case_members (
  case_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'buyer',
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, buyer_id),
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

-- Consent-based co-buyer invitations. Raw invitation tokens are never stored.
CREATE TABLE IF NOT EXISTS buyer_case_invitations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  created_by_buyer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_buyer_id TEXT,
  revoked_at TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_buyer_id) REFERENCES buyers(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by_buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS buyer_person_profiles (
  buyer_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  buyer_confirmed_at TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

-- Loose internal measurement only during the pilot; not a buyer billing meter.
CREATE TABLE IF NOT EXISTS buyer_time_entries (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  buyer_id TEXT,
  professional_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  minutes INTEGER,
  category TEXT NOT NULL,
  stage TEXT,
  showing_ref TEXT,
  note TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS buyer_case_financials (
  case_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  projected_purchase_price INTEGER,
  final_purchase_price INTEGER,
  pilot_rate REAL NOT NULL DEFAULT 0.0275,
  actual_hbe_comp INTEGER,
  notes TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

-- HBE professional identity is deny-by-default. Google Workspace provisioning and
-- HBE application authorization are tracked separately so creating/requesting an
-- @hbexperts.com address never grants HBEUI access by itself.
CREATE TABLE IF NOT EXISTS hbe_professionals (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'professional' CHECK (role IN ('broker_admin','professional')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  workspace_status TEXT NOT NULL DEFAULT 'requested' CHECK (workspace_status IN ('requested','provisioned','suspended')),
  workspace_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Bootstrap the current broker-admin identity and stage Jennifer's requested HBE
-- identity without granting access until the Google Workspace account exists and
-- HBE explicitly activates her professional record.
INSERT OR IGNORE INTO hbe_professionals
  (id,email,display_name,role,status,workspace_status,created_at,updated_at)
VALUES
  ('hbe-pro-christopher-whitehead','cwhitehead@hbexperts.com','Christopher Whitehead','broker_admin','active','provisioned',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO hbe_professionals
  (id,email,display_name,role,status,workspace_status,created_at,updated_at)
VALUES
  ('hbe-pro-jennifer-jrose','jrose@hbexperts.com','Jennifer','professional','pending','requested',datetime('now'),datetime('now'));

CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers(email);
CREATE INDEX IF NOT EXISTS idx_buyers_submitted ON buyers(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_buyer ON buyer_sessions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON buyer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_notes_buyer ON buyer_notes(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_tasks_buyer ON buyer_tasks(buyer_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_case_members_case ON buyer_case_members(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_invites_token ON buyer_case_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_case_invites_creator ON buyer_case_invitations(created_by_buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_invites_case ON buyer_case_invitations(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_case ON buyer_person_profiles(case_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_time_case ON buyer_time_entries(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_professional ON buyer_time_entries(professional_email, ended_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hbe_professionals_status ON hbe_professionals(status, workspace_status, email);
