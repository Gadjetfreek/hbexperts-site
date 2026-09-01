-- Issue #33 Buyer Incentive Matrix schema (additive).
-- Apply AFTER schema.sql and schema-issue29.sql on the target D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bimatrix_screenings (
  case_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','revoked')),
  opted_in_at TEXT NOT NULL,
  opted_in_by_buyer_id TEXT,
  updated_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  catalog_review_date TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (opted_in_by_buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bimatrix_facts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('buyer_experience','eligibility_opt_in','property_derived','hbe_confirmed','system')),
  source_buyer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(case_id, fact_key),
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (source_buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bimatrix_results (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  program_version TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('likely','worth_checking','not_match','info_missing')),
  availability_status TEXT NOT NULL CHECK (availability_status IN ('open','closed','paused','exhausted','unknown','retired')),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  missing_fact_keys_json TEXT NOT NULL DEFAULT '[]',
  external_checks_json TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE(case_id, program_id),
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bimatrix_hbe_annotations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author_email TEXT NOT NULL,
  disposition TEXT CHECK (disposition IN ('none','review','contact_program','contact_lender','likely_helpful','likely_not_helpful')),
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bimatrix_freshness_checks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  requested_by_buyer_id TEXT,
  checked_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('current','review_pending','unavailable')),
  details_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_buyer_id) REFERENCES buyers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bimatrix_screenings_status ON bimatrix_screenings(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bimatrix_facts_case ON bimatrix_facts(case_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_bimatrix_results_case_class ON bimatrix_results(case_id, classification, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bimatrix_results_program ON bimatrix_results(program_id, program_version);
CREATE INDEX IF NOT EXISTS idx_bimatrix_annotations_case ON bimatrix_hbe_annotations(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bimatrix_freshness_case ON bimatrix_freshness_checks(case_id, checked_at DESC);
