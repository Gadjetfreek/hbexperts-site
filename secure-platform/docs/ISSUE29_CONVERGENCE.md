# Issue 29 — HBEUI + Buyer Portal convergence

Owner: ForgeRokBot. Branch: `forge/issue-29-hbeui-convergence`. Do not merge or deploy until Sentinel review and owner go-ahead.

## Objective

Production-ready convergence of HBEUI + Buyer Portal from current `main`, using ideas from staging PRs #26/#27 without copying either prototype wholesale. Preserve the live canonical 16 stages through Get the Keys and add Stage 17: After the Keys. Post-closing 30/90/365/anniversary/warranty items are checklist entries inside Stage 17 — not stages 18–21.

## Architecture

Worker chain (outermost first):

`issue29-convergence-worker.js` → `value-brand-worker.js` → `journey-state-worker.js` → `search-worker.js` → `representation-worker.js` → `consultation-worker.js` → `hbe-access-worker.js` → `co-buyer-consent-worker.js` → `pilot-worker.js` → `hbe-portal-sync-worker.js` → `hbe-worker.js` → `access-code-worker.js` → `portal-worker.js` → `ui-worker.js` → `worker.js`

Persistence is D1 (`BUYER_DB`). Cookies/localStorage are not source of truth for stage, checklist, task, story, compass, invitation, or membership. Buyer sessions remain hashed `hbe_session` cookies: `Path=/; HttpOnly; Secure; SameSite=Lax`.

Co-buyer invitations continue to use production `co-buyer-consent-worker.js`: 32-byte random token, SHA-256 hash stored, 7-day expiry, single-use, revocable. Prototype seed-replayable tokens from PR #27 are not shipped.

HBE preview of buyer UI (`/hbe/preview`) is fail-closed: Cloudflare Access email required (`authorizePreview`), plus the existing `/hbe` Access gate.

## Schema

Additive file: `schema-issue29.sql`

- `household_stories` — shared story vs `hbe_synthesis` (HBE-only)
- `buyer_private_context` — per-buyer private JSON; never shown on Shared Household View
- `household_compass` — optimizing / tradeoffs / uncertainty / evidence / next conversation (never empty)
- `household_checklist_items` — `visibility` IN (`buyer`,`shared`,`hbe`); completing may create a task
- `household_checklist_completions` — who/when (`completed_by_kind`, `completed_by_id`, `completed_at`)
- `household_tasks` — `visibility`, `source`, `is_whats_next`
- `household_audit_events` — append-only who/when/what
- `household_view_permissions` — shared vs private vs HBE-only flags

Existing `buyer_cases`, `buyer_case_members`, `buyer_case_invitations` remain the household/membership/invite source of truth.

## Migration plan

1. Do **not** bind this branch to production D1 from an unreviewed deploy.
2. On a **new** D1 (or a reviewed production window): apply `schema.sql`, `schema-stage4.sql`, then `schema-issue29.sql`.
3. Keep `database_id = "REPLACE_AFTER_D1_CREATE"` in git.
4. First dashboard load seeds checklist items / compass / story for a case (`ensureHouseholdState`). Seeding is idempotent.
5. Rollback: point Worker `main` back to `src/value-brand-worker.js` and leave the new tables unused. New tables are additive.

## Production surfaces touched

- `secure-platform/wrangler.toml` — `main` only (name, route, `workers_dev`, `database_id` unchanged)
- `secure-platform/src/worker.js` — Stage 17, thank-you voice, compensation language, stagepeek CSS/markup
- `secure-platform/src/ui-worker.js` — Stage 17, peek `:focus-visible` / `.open` / tap marker
- `secure-platform/src/hbe-worker.js` — Stage 17, split HBE/Buyer cards, never-empty What’s Next copy
- `secure-platform/src/hbe-portal-sync-worker.js` — Stage 17 label
- `secure-platform/src/representation-worker.js` — pre-hire compensation: negotiable, no published rates, seller-paid not automatic
- New: `journey-stages.js`, `household-state.js`, `issue29-ui.js`, `issue29-convergence-worker.js`
- New: `schema-issue29.sql`, tests, HTML/PNG evidence under `docs/issue29/`

Not changed: production route `buyer.hbexperts.com`, Worker name `hbe-buyer-platform`, `workers_dev=false`, D1 name, `database_id` placeholder.

## Synthetic fixtures

Alex and Sam Rivera (`alex.rivera@example.test`, `sam.rivera@example.test`) exist only in tests and HTML evidence. No real client PII.

## Local evidence

```bash
cd secure-platform && node --test tests/issue29.test.mjs
```

HTML snapshots: `docs/issue29/*.html`
PNGs: `docs/issue29/*.png` and `/workspace/docs/issue29/`
