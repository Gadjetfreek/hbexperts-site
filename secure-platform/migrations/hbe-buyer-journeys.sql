-- Owner-only buyer journey drafts (HBEUI "Build buyer's journey"). Additive.
CREATE TABLE IF NOT EXISTS hbe_buyer_journeys (
  buyer_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  stage_at_generation TEXT,
  generated_at TEXT NOT NULL,
  edited_at TEXT,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS hbe_buyer_journey_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hbe_journey_gen_created ON hbe_buyer_journey_generations(created_at);
