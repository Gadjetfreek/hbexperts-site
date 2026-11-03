# HBE agent work log (newest first)
See HOMEY-HANDOFF.md for the format and rules. No PII or secrets.

## 2026-11-03 11:16 ET — Homey (executor)
- Did: Opened PR #108 https://github.com/Gadjetfreek/hbexperts-site/pull/108 (branch feat/ads-gclid-passthrough). buyer.hbexperts.com now captures a strictly validated gclid/gbraid/wbraid from any landing URL into a first-party cookie `hbe_ad_click` (Secure, SameSite=Lax, HttpOnly, 90 days, host-only), and on a successful, once-only /api/intake claim passes it to the hidden frame as hbexperts.com/google-ads-conversion/?gclid=… and clears the cookie. Frame conversion event now sends value 1.0 / currency USD. Verified: conversion suite 20/20 (7 new tests, synthetic data, includes no-PII checks), all other secure-platform tests pass, wrangler dry-run bundles, Hugo build OK. No staging config exists in the repo, so not deployed. No D1 schema change.
- Decided by: Sebastian, Nov 3 2026 ("Yes sir, fix it." re: gclid attribution gap).
- Intent: let Google Ads see which ad clicks become Buyer Experience submissions, so spend goes toward buyers who actually ask for help. Buyer data never goes to Google, and lead submission/alerts can't be broken by the tag.
- Next: Sebastian reviews/merges PR #108; then deploy BOTH the Worker (secure-platform/deploy.ps1) and the Hugo public site (frame page value/currency) with his go-ahead. After the first real lead, check the "Submit lead form" action status in Google Ads.

## 2026-11-03 11:10 ET — Homey
- Did: Google Ads 856-281-7245 Campaign #1: networks Search only (Display + Search Partners off); location Ohio → Summit, Cuyahoga, Stark, Medina, Wayne counties (presence); added campaign phrase negatives for grant/zero-down/unrelated searches; removed "single mom", "single mother", "section 8", "100 down" per Sentinel rule; ad final URL /buyer-representation/ → buyer.hbexperts.com/questionnaire; headlines "Buying a Home?" (pinned 1), "Buying a Home in NE Ohio?", "Get an Exclusive Buyer's Agent" replaced "Buyer Strategy Session", "Make a Wiser Home Purchase", "What Is Best for the Buyer?"; paused keywords "home buying assistance" (phrase + exact), verified 11:08 ET; 29 buyer-agent keywords remain eligible, 4 Canton/NE Ohio ones show "Not..." (likely low search volume). Budget/bids unchanged.
- Decided by: Sebastian, Nov 3 2026 (approved fixes 1–4, simpler ad "Buying a home?", pausing "home buying assistance").
- Intent: pay only for people looking to buy a home in our five counties who might want a buyer's agent; stop paying for grant/assistance-only searches.
- Next: close gclid attribution gap (needs OK); Sebastian must do advertiser verification by Nov 13 and passkey by Nov 11; developer token / MCC for Tiller reporting; review search terms weekly.
