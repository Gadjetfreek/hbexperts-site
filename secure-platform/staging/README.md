# HBEUI + Buyer Portal synthetic staging

Isolated Cloudflare Worker for the 2026-08-31 HBEUI / Buyer Portal product notes.

Worker name: `hbe-buyer-platform-staging`
Household: Alex and Sam Rivera only
Not production. Do not bind live D1. Do not add `buyer.hbexperts.com`.

## Isolation

- Separate Worker name from `hbe-buyer-platform`
- `workers_dev = true`, no custom domain, no production routes
- No `BUYER_DB` binding
- Staging D1, if created, uses placeholder `database_id = "REPLACE_AFTER_D1_CREATE"` in git
- `/api/intake` redirects to thank-you and does not email anyone
- Robots: `noindex,nofollow,noarchive`

## Product assumptions (labeled)

- Live currently has 16 stages ending at **Get the Keys**. Those 16 ids/names are preserved.
- Stage 17 is post-closing care: **After the keys**.
- Stages 18–21 are 30-day, 90-day, 365-day, and anniversary follow-up.
- Rivera household is already hired so the portal can show post-hire negotiable arrangement options. Public / pre-hire pages do not publish commission numbers.
- Checklist mutations live in browser `localStorage` for this prototype (faked persistence).
- Alex and Sam use separate HttpOnly cookies (`hbe_stage_person`). They are not a shared session. Invite ports the production private-invite idea without writing production D1.

## Deploy (staging Worker only)

From this directory, with an authenticated Cloudflare CLI session:

```text
wrangler deploy --config wrangler.toml
```

Optional later:

```text
wrangler d1 create hbe-buyer-journey-staging
wrangler d1 execute hbe-buyer-journey-staging --remote --file=schema.sql
```

Keep the returned `database_id` in the dashboard / local wrangler state. Do not commit a live id.

## Access remaining step

Attach Cloudflare Access for `cwhitehead@hbexperts.com` to:

- `https://hbe-buyer-platform-staging.<account>.workers.dev/hbe*`
- `https://hbe-buyer-platform-staging.<account>.workers.dev/api/hbe/*` (none in this prototype)
- Prefer covering the whole unlisted hostname until it is no longer needed.

If Access is absent, the Worker still serves the unlisted `workers.dev` hostname and honors an Access email header when present (wrong email → 403).

## Explicitly not done

- Production Worker / `buyer.hbexperts.com` / production D1 / production Access
- Merge to main
- Order #6
- P1.1 history
- MLS
- Real client identities or questionnaire answers

## Tooling note

This box has Node v20. Wrangler 4 requires Node 22, so the staging folder pins `wrangler@3.114.17`.

Cloudflare CLI authentication is required for D1 create and Worker deploy. If `wrangler whoami` says you are not authenticated, stop. Do not invent credentials. Do not create a PAT.

## Synthetic login (staging only)

- Alex: `alex.rivera@example.test` / `ALEX-RIVERA-DEMO`
- Sam: `sam.rivera@example.test` / `SAM-RIVERA-DEMO`
- Invite token: `forge-rivera-sam-invite`

These are labeled demo values, not production access codes.
