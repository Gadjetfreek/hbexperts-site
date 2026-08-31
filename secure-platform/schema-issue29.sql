-- Issue #29 convergence schema (additive).
-- Apply AFTER schema.sql and schema-stage4.sql on the target D1.
-- database_id is never stored here. Do not bind this migration to production
-- D1 with real Buyer Experience rows from an unreviewed deploy.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS household_stories (
  case_id TEXT PRIMARY KEY,
  shared_story TEXT NOT NULL DEFAULT '',
  hbe_synthesis TEXT NOT NULL DEFAULT '',
  wants TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  tradeoffs TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  decision_style TEXT NOT NULL DEFAULT '',
  unresolved_questions TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  what_changed TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buyer_private_context (
  buyer_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_compass (
  case_id TEXT PRIMARY KEY,
  optimizing_for TEXT NOT NULL DEFAULT '',
  tradeoffs TEXT NOT NULL DEFAULT '',
  uncertainty TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  next_conversation TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_checklist_items (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('buyer','shared','hbe')),
  sort_order INTEGER NOT NULL,
  creates_action_kind TEXT,
  creates_action_title TEXT,
  creates_due_offset_days INTEGER,
  creates_priority TEXT,
  UNIQUE(case_id, stage_id, item_key),
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_checklist_completions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  completed_by_kind TEXT NOT NULL CHECK (completed_by_kind IN ('hbe','buyer','system')),
  completed_by_id TEXT NOT NULL,
  scope_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES household_checklist_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  buyer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  stage TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('buyer','shared','hbe')),
  source TEXT NOT NULL DEFAULT 'manual',
  source_item_id TEXT,
  is_whats_next INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS household_audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_view_permissions (
  case_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  can_view_shared INTEGER NOT NULL DEFAULT 1,
  can_view_private_self INTEGER NOT NULL DEFAULT 1,
  can_view_other_private INTEGER NOT NULL DEFAULT 0,
  can_view_hbe_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (case_id, buyer_id),
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hh_items_case_stage ON household_checklist_items(case_id, stage_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_hh_complete_case ON household_checklist_completions(case_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_hh_tasks_case ON household_tasks(case_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_hh_audit_case ON household_audit_events(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_ctx_case ON buyer_private_context(case_id);
