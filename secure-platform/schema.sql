CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  stage TEXT NOT NULL DEFAULT 'consultation',
  completed_stages TEXT NOT NULL DEFAULT '["buyerExperience"]',
  answers_json TEXT NOT NULL,
  buyer_token_hash TEXT NOT NULL UNIQUE,
  access_code_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buyers_email ON buyers(email);
CREATE INDEX IF NOT EXISTS idx_buyers_updated ON buyers(updated_at DESC);
