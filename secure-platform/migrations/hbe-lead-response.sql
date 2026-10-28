-- Oct 27 2026 audit fixes: lead acknowledgment / response tracking, unsent-alert
-- escalation bookkeeping, intake spam flags, and persistent last_error on alert emails.
-- Apply once: wrangler d1 execute hbe-buyer-journey-v2 --remote --file migrations/hbe-lead-response.sql
CREATE TABLE IF NOT EXISTS hbe_lead_status (
  buyer_id TEXT PRIMARY KEY,
  notification_id TEXT,
  assigned_to TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  first_response_at TEXT,
  responded_by TEXT,
  escalated_at TEXT,
  spam_flag INTEGER NOT NULL DEFAULT 0,
  spam_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hbe_lead_status_ack ON hbe_lead_status(acknowledged_at);
CREATE TABLE IF NOT EXISTS hbe_lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('acknowledged','assigned','responded','escalated','spam_flagged')),
  actor TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hbe_lead_events_buyer ON hbe_lead_events(buyer_id, created_at);
ALTER TABLE notification_deliveries ADD COLUMN last_error TEXT;
ALTER TABLE notification_deliveries ADD COLUMN last_error_at TEXT;
