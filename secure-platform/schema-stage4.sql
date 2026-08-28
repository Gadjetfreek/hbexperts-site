PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS buyer_search_profiles (
  case_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  price_min INTEGER,
  price_max INTEGER,
  cities TEXT,
  counties TEXT,
  postal_codes TEXT,
  property_types_json TEXT NOT NULL DEFAULT '[]',
  beds_min INTEGER,
  baths_min INTEGER,
  sqft_min INTEGER,
  lot_min_acres REAL,
  garage_min INTEGER,
  year_built_min INTEGER,
  hard_constraints TEXT,
  preferences TEXT,
  tradeoffs TEXT,
  search_notes TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buyer_search_confirmations (
  buyer_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buyer_search_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  run_by TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  feed_mode TEXT,
  objective_query TEXT,
  result_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success','error')),
  error_text TEXT,
  FOREIGN KEY (case_id) REFERENCES buyer_cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_profiles_updated ON buyer_search_profiles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_confirmations_case ON buyer_search_confirmations(case_id, profile_version, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_runs_case ON buyer_search_runs(case_id, created_at DESC);
