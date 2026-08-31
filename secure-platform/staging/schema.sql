-- Synthetic staging D1 only. Never execute against hbe-buyer-journey-v2
-- or any production Buyer Experience database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staging_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

INSERT OR IGNORE INTO staging_meta (k, v) VALUES
  ('mode', 'synthetic'),
  ('household', 'Alex and Sam Rivera'),
  ('production_data', 'false');
