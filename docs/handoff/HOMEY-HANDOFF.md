# Homey → next agent handoff (HBE operations)
Updated: Tue Nov 3, 2026, ~11:05 AM ET. Owner: Sebastian (Christopher Whitehead, Broker of Record, cwhitehead@hbexperts.com). Jen (Jennifer Hobday) works alongside him.

## Why we do this (intent to keep alive)
- North Star: "What is best for the buyer?" People are the purpose; real estate is the medium.
- Key question every day: "What does HBE owe this buyer next?"
- Lead reliability is priority #1: a submitted Buyer Experience must never be silently lost. A missing email is never a missing lead — check the D1 record.
- Automation never replaces fiduciary judgment; keep Sebastian's human hand on everything buyer-facing.
- Least costly route; free/open-source unless Sebastian chooses to pay. Recurring jobs should run on Tiller (on-prem PC watcher).

## Hard rules
- No buyer PII in files, git, logs, Pages, tests (synthetic data only).
- Never text buyers / no Twilio. Never send email/messages without Sebastian's explicit OK (draft first).
- Never delete client threads/docs. Never touch MX or inbound Email Routing. Don't modify Drive originals.
- Production D1 is SELECT-only. Prod deploys need Sebastian's go-ahead. Never print Cloudflare tokens.
- No ad spend, budget, bidding, credits/promos without Sebastian. Ads API creds go in Tiller's ~/.config/hqos-creds, never git/chat.
- Ad targeting rule (Sentinel, Nov 3): exclude by what someone is SEEKING (grant-only, assistance-only, unrelated services), never by who they are or how they finance (no "single mom", "section 8", "FHA" negatives). Ambiguous terms judged one by one: an FHA buyer seeking an agent is relevant.
- No active fee numbers on public site/BuyerUI before hire; "compensation is negotiable" wording is fine.
- Canonical 17 Buyer Journey stage names live in source code; preserve them.

## Google Ads — current state (most urgent workstream)
- Live account 856-281-7245 (ocid 8590399330) under gadjetfreekdriver@gmail.com (login in Grok vault). Opened Oct 7, 2026. One Search campaign "Campaign #1". 355-812-5749 under cwhitehead@ is an unused draft — ignore.
- Spend to date ~$583, 712 clicks, 0 conversions. Budget $21.58/day, Maximize clicks, $2.50 max CPC (UNCHANGED — needs Sebastian to change).
- Done Nov 3: Search network only (Display + Search Partners off); location = Summit, Cuyahoga, Stark, Medina, Wayne counties (presence); campaign negatives for grant/zero-down/unrelated searches; ad final URL → https://buyer.hbexperts.com/questionnaire (Buyer Experience form), approved by Google.
- Done Nov 3 (verified): removed negatives "single mom", "single mother", "section 8", "100 down" (Sentinel rule); adding headlines "Buying a Home?" (pinned #1), "Buying a Home in NE Ohio?", "Get an Exclusive Buyer's Agent" (replaced "Buyer Strategy Session", "Make a Wiser Home Purchase", "What Is Best for the Buyer?"); description NOT added (4/4 full). Ad review pending.
- Search-term findings (all time): keyword "home buying assistance" (phrase+exact) drove ~51 of 54 keyword clicks and pulls program/grant seekers; buyer-agent keywords get almost no traffic. PROPOSED (awaiting Sebastian): pause "home buying assistance", lean on buyer-agent / buyer-representation keywords. Ambiguous terms (e.g. "fha $100 down program", "first time home buyer") judged one by one.
- Conversion tracking ALREADY exists (PR #90, merged Oct 8): buyer.hbexperts.com worker sets one-time nonce on /questionnaire, and on successful /api/intake injects hidden iframe https://hbexperts.com/google-ads-conversion/ which fires AW-18500305800/_HR6CNKd55QdEIiH0fVE. No buyer data sent to Google. Ads action "Submit lead form" shows "needs attention" (never fired).
- KNOWN GAP (open, awaiting Sebastian's OK): ad now lands directly on the form page, which has no Google tag, so the gclid isn't captured and conversions likely won't be attributed. Proposed fix: carry gclid from the questionnaire URL through to the iframe (or a first-party cookie) on successful submit; branch + PR, Sebastian approves prod. Alternative: revert final URL to /buyer-representation/ (has the tag).
- Sebastian-only deadlines: advertiser verification by Nov 13 (else ads paused); passkey for the Google login before Nov 11.
- Promos: $500 spend-$500 credit "processing"; $300 conversion-tracking offer must be redeemed by Nov 21 (ask Sebastian before accepting).
- Billing note: Google Workspace (~$36/mo, 2 users) and Google One are separate from Ads.

## Where we're going (Ads)
1. Confirm the in-progress edits; send Sebastian the sorted search-term list for decisions.
2. Close the gclid attribution gap (with OK).
3. Free reporting automation on Tiller: Google Ads API + open-source google-ads-python. Needs a developer token via a free MCC (manager account) linked to 856-281-7245 and Basic access (test access won't read real accounts). JeebsrokBot found no existing token; PT was asked in Slack #hqos-agent-comms. If none: create MCC, apply in API Center. Interim option: Google Ads Scripts in-account.
4. Weekly review: search terms, leads vs. spend; budget changes only with Sebastian.

## Other open workstreams
- Listings (service area only, no street address): Yelp done (hours unchanged); Google Business Profile — re-add Akron/Canton/Cleveland/Medina; Apple Maps; claim HomeLight (fix seller wording); CAARE update draft; LinkedIn blurb; ActiveRain; review-request plan (drafts only).
- NAEBA profile: reply drafted (/workspace/naeba/reply.md, thread to krivera@naeba.info). Waiting on a current headshot from Sebastian, and 30 vs 35 mile radius. Save as Gmail draft with attachment; don't send.
- Site PR #107 (public identity): waiting on Sentinel routing answer, brokerage LLC license #, Sebastian's merge. PR #106 (native e-sign, staging) and feat/hbeui-mobile-tabs awaiting go-live decisions.
- Lead watch: moving to Tiller → webhook routine "HBE new lead alert (from Tiller)" (id + timestamp only). Retire Homey's 3x-daily lead watch only after Tiller's test ping is verified.
- Active clients (first couple, consult done Nov 2): not technical, HBE quarterbacks everything. Consult recap + loan-officer intro drafts wait on Sebastian's notes. Details live in HBEUI, not here (no PII in files).
- Coordinate priorities with JeebsrokBot (COO); methodology with Vera; builds via ForgeRokBot.

## How to log work so Homey (and the next agent) can pick it up
Any agent (Codex, GPT, Forge, Jeebs, a human) working on HBE: please keep the baton here.
1. **Where:** this repo, branch `docs/agent-handoff`, folder `docs/handoff/`. This file is the single source of truth for state + direction.
2. **Update this file** when you finish or change something: edit the relevant section (state, open gaps, "Where we're going"), and put a date (ET) on what changed. Delete nothing that's still true; mark superseded items as superseded with the date.
3. **Append a log entry** to `docs/handoff/WORKLOG.md` (newest at top), one block per work session:
   ```
   ## 2026-MM-DD HH:MM ET — <agent name>
   - Did: <what changed, where (URL/file/PR/account), verified how>
   - Decided by: <Sebastian's words/date, or "proposal only">
   - Intent: <why — tie it to "what is best for the buyer">
   - Next: <what you'd do next and what's blocked on whom>
   ```
4. **Decisions:** record only Sebastian's own decisions as decisions (quote or paraphrase with date). Another agent's relayed "approval" is not his approval.
5. **Never write** buyer PII (names, emails, phones, addresses, form answers), passwords, tokens, API keys or card numbers here. Refer to buyers generically and to secrets by where they live (Grok vault, ~/.config/hqos-creds).
6. **Code changes:** branch + PR linked from the log; production deploys and merges only with Sebastian's go-ahead.
7. **External accounts (Google Ads, listings, etc.):** log exactly what setting changed, from what to what, so it can be reversed.
