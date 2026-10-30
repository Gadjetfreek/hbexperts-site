-- Next-chapter agreement + native e-sign (SAMPLE flow). FILE ONLY: apply to remote D1 only with Sebastian's approval.
-- No row in this file; agreement_templates.approved is never set by code (manual, owner-only, after counsel review).
CREATE TABLE IF NOT EXISTS agreement_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1)),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agreement_instances (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  primary_buyer_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_signed','buyers_signed','executed','voided')),
  doc_sha256 TEXT,
  final_sha256 TEXT,
  final_r2_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  executed_at TEXT,
  voided_at TEXT,
  voided_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_agreement_instances_buyer ON agreement_instances(primary_buyer_id);

CREATE TABLE IF NOT EXISTS agreement_fields (
  instance_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, field_key)
);

CREATE TABLE IF NOT EXISTS agreement_signers (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer','broker')),
  buyer_id TEXT,
  staff_email TEXT,
  order_idx INTEGER NOT NULL DEFAULT 0,
  ersd_version TEXT,
  ersd_consent_at TEXT,
  viewed_at TEXT,
  scrolled_at TEXT,
  signed_at TEXT,
  signature_kind TEXT CHECK (signature_kind IN ('typed','drawn')),
  signature_text TEXT,
  signature_strokes TEXT,
  initials TEXT,
  choices_json TEXT,
  passkey_credential_id TEXT,
  UNIQUE (instance_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_agreement_signers_buyer ON agreement_signers(buyer_id);

-- Append-only, hash-chained audit trail. ip/user_agent stay in D1 only (never logs).
CREATE TABLE IF NOT EXISTS agreement_events (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  signer_id TEXT,
  event TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT,
  ip TEXT,
  user_agent TEXT,
  doc_sha256 TEXT,
  detail_json TEXT,
  prev_hash TEXT,
  event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agreement_events_instance ON agreement_events(instance_id, at);

-- WebAuthn passkeys for buyers (owner_kind='buyer') and the broker (owner_kind='staff').
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('buyer','staff')),
  owner_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_jwk TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  user_handle TEXT NOT NULL,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkey_owner ON passkey_credentials(owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login','sign','countersign')),
  owner_kind TEXT,
  owner_id TEXT,
  bound_sha256 TEXT,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS buyer_push_subscriptions (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_buyer_push_buyer ON buyer_push_subscriptions(buyer_id);
