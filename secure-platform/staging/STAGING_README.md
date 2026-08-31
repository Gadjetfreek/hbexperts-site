# ForgeRokBot staging slice — HBEUI + Buyer Portal

Independent Grok/ForgeRokBot rendition of the 2026-08-31 HBEUI + Buyer Portal brief.

This is **not** ForgePT PR #26. Do not copy `forgept-demo-worker.js`, `forgept-demo-wrangler.toml`, or `FORGEPT_STAGING_README.md`. Do not deploy Worker `hbe-buyer-platform`. Do not attach `buyer.hbexperts.com`. Do not bind production D1 `hbe-buyer-journey-v2`.

## What this is

An isolated Cloudflare Worker under `secure-platform/staging/` that demonstrates the synthetic Rivera household:

- Split buyer card: half HBE Dashboard / half Buyer Dashboard
- 21 clickable stages with checklists (see stage assumption)
- Buyer map hover peek (`.stagepeek`), not click-only
- Dedicated What's next, seeded from the current stage — never "No tasks yet."
- Evolving household story: HBE synthesis vs buyer voice + shared facts
- Thank-you page in HBE voice (navy / green / warm, Georgia headings, Inter body)
- Two people, two logins; shared vs private view
- Household box filled with useful journey content
- Private invitation for Sam (production invite pattern, staging-seeded token)
- Commission hidden pre-hire; after hire, negotiable arrangement options, no numbers

Voice: People are the purpose. Real estate is the medium. What is best for the buyer? Education before transaction. No pressure hire.

## Stage assumption (labeled)

Live currently has **16** stages ending at **Get the Keys**.

This rendition does **not** replace Get the Keys. It adds post-closing care as stages 17-21:

- 16 closing — Get the Keys
- 17 afterKeys — After the keys
- 18 care30 — 30-day care
- 19 care90 — 90-day care
- 20 care365 — One-year review
- 21 anniversary — Anniversary follow-up

ForgePT PR #26 used a different post-keys count. Compare on purpose.

## Demo logins (synthetic only)

- Alex Rivera: `ALEX-RIVERA-DEMO` — private buyer view; can preview Sam's invitation
- Sam Rivera: `SAM-RIVERA-DEMO` — private buyer view, separate session
- HBE staff (staging): `HBE-STAGING-DEMO` — HBE Dashboard (not Cloudflare Access)
- Sam invite token: `forge-rivera-sam-invite` at `/invite/forge-rivera-sam-invite`
- Identify as `Sam Rivera` or `sam.rivera@example.test`

Emails are `.test` only: `alex.rivera@example.test`, `sam.rivera@example.test`.

Query-param login also works: `/login?code=ALEX-RIVERA-DEMO`.

Staging questionnaire submit does **not** send email.


## Run locally

From this directory only. Install packages, then start local Worker with the staging config. Do not use the production config. Node 20; CLI pinned at 3.114.17.

## Deploy (staging Worker only)

Worker name: hbe-buyer-platform-staging. workers_dev is true. No production routes. Use the staging config only.
If cloud auth is missing, stop. Do not invent credentials or create a token.
After a workers.dev URL exists, remaining human step: Access restricted to cwhitehead@hbexperts.com only. Never attach buyer.hbexperts.com.
If an Access email header is present and is not that address, /hbe returns 403. If absent, staging still serves the page.

## D1

schema.sql is synthetic staging_meta only. Keep any real database id out of git. This Worker does not require D1. Checklist toggles, view mode, and Sam joined flag are cookies.

## Known gaps / what is faked

- No production data, no client PII, no secrets
- No D1 persistence — cookies only, per browser
- Invitation is seed-replayable (not hashed single-use D1 rows)
- No email, no Access gate until a human attaches one
- No MLS, no P1.1, no Order #6
- Staging questionnaire is a short thank-you path, not the full eight-part Buyer Experience

## Files in this slice

- worker.js — self-contained staging Worker
- data.js — synthetic household, 21 stages, post-hire compensation options
- wrangler.toml — staging Worker config only
- schema.sql — synthetic staging_meta
- package.json
- STAGING_README.md — this file
