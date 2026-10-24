# Agent-facing web layer

This change establishes a deliberately conservative machine-readable front door for HBE.

## Phase 1
- `/llms.txt`: concise authoritative context for language-model consumers.
- `/agents.json`: experimental structured capability declaration.
- Existing `robots.txt` and Hugo sitemap remain the crawler/index layer.

## Security boundary
Public machine-readable resources contain no buyer records, D1 data, notes, uploads, credentials, MLS data, or privileged endpoints. They grant no authority to transact or represent a buyer.

## Next phase (separate review)
Add JSON-LD to key public pages, validate sitemap/robots behavior, and design an authenticated `/api/agent/` boundary. Any buyer-specific endpoint must preserve Cloudflare Access/OTP, least privilege, review-before-send, and existing MLS/data guards.

## Verification
After deployment, verify HTTP 200 and correct content type for `/llms.txt` and `/agents.json`, confirm no sensitive content is present, and run the existing site test suite.
