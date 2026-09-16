-- Acquisition aggregate counters (Issue #74). Additive and reversible.
-- Apply on the target D1 (BUYER_DB / hbe-buyer-journey-v2), e.g.:
--   npx wrangler d1 execute hbe-buyer-journey-v2 --remote --file=migrations/acquisition-aggregate.sql
-- Or for local:
--   npx wrangler d1 execute hbe-buyer-journey-v2 --local --file=migrations/acquisition-aggregate.sql
--
-- Stores COUNT-only funnel rows. NO identity foreign keys to buyers or cases.
-- Rollback: DROP TABLE IF EXISTS acquisition_daily_counts;

CREATE TABLE IF NOT EXISTS acquisition_daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'unknown',
  campaign TEXT NOT NULL DEFAULT '',
  entry_page TEXT NOT NULL DEFAULT '/',
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, event, channel, campaign, entry_page)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_daily_event_day
  ON acquisition_daily_counts (event, day);
