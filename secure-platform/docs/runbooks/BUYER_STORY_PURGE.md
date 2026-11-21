# Runbook: purge a shared Buyer Story on request

Use this when a buyer asks HBE to delete the Buyer Story they shared (the "Share my story with HBE"
path, PR #113). Downloaded stories never reach HBE, so there is nothing to purge for those.

> **APPROVAL GATE.** Every write in this runbook (any `UPDATE` or `DELETE`, and deleting email) needs
> **Sebastian's explicit approval, in his own words, for that specific request**, recorded as the
> approval ref in the log below. Standing rule: Forge and other agents run D1 **SELECT-only**. A
> human operator runs the write commands. Agents may prepare the commands and run the SELECT previews.

Database: `hbe-buyer-journey-v2` (binding `BUYER_DB`, `secure-platform/wrangler.toml`).
Commands below are run from `secure-platform/` with an authenticated `wrangler`.

## Where a shared story lives (from the code)

| Place | What | Written by |
|---|---|---|
| `notifications.payload_json` (row with `type='buyer_experience_submitted'`) | `story_text` (the full story as the buyer approved and possibly edited it), plus `source='buyer_story'` and `story_consent=true` | `src/worker.js` `createBuyer` |
| `buyers.answers_json` | `source='buyer_story'` flag only. The story text is **not** here, but this column holds all of the buyer's questionnaire answers (including free text) | `src/portal-worker.js` |
| `notification_deliveries` (keyed by `notification_id`) | Delivery status only, no story text | `src/worker.js`, `src/submission-alerts.js` |
| Alert email "New HBE Buyer Experience submitted" | Buyer name, email, phone, submitted time, `Source: Buyer Story`, then the full story text | `src/submission-alerts.js` |
| D1 Time Travel history | Point-in-time copies of the rows above | Cloudflare |

Not affected: `hbe_push_alerts` (action label only), `hbe_lead_status` / `hbe_lead_events` (status and
actor only), Worker logs (the story is never logged; covered by tests), and Google Tag Manager/Ads
(none on the questionnaire, story step or portal). `hbe_buyer_journeys.body` is an owner-built journey
draft generated from answers, not the Buyer Story. It matters only for a full-record deletion (Option B).

## Option A: purge the story only (default)

Use this when the buyer asks to delete their story but not their whole record.

### A1. Identify the buyer (no PII export)

Run this with the email the buyer gave. The output shows only opaque IDs, dates and flags, never names
or answers. Do not copy the email into the log. Record the buyer ID only in the secure HBE system, not
in the log below.

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "SELECT b.id AS buyer_id, substr(b.submitted_at,1,10) AS submitted_on, json_extract(b.answers_json,'$.source') AS answers_source, n.id AS notification_id, json_extract(n.payload_json,'$.source') AS payload_source, length(json_extract(n.payload_json,'$.story_text')) AS story_chars FROM buyers b LEFT JOIN notifications n ON n.buyer_id=b.id AND n.type='buyer_experience_submitted' WHERE lower(b.email)=lower('BUYER_EMAIL_HERE') ORDER BY b.submitted_at DESC"
```

- More than one row can come back (one per submission). Purge every row with `payload_source='buyer_story'`.
- If a request arrives by buyer ID instead, replace the `WHERE` clause with `WHERE b.id='BUYER_ID'`.
- Clear your shell history entry afterwards if your shell keeps one, since the command contains the email.

### A2. Preview (SELECT, agents may run)

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "SELECT n.id, n.type, json_extract(n.payload_json,'$.source') AS source, json_extract(n.payload_json,'$.story_consent') AS consent, length(json_extract(n.payload_json,'$.story_text')) AS story_chars, d.status AS delivery_status FROM notifications n LEFT JOIN notification_deliveries d ON d.notification_id=n.id WHERE n.buyer_id='BUYER_ID' AND n.type='buyer_experience_submitted'"
```

### A3. Redact (WRITE: needs Sebastian's approval)

This keeps the lead (`buyers`, `notifications`, `notification_deliveries` rows) so the lead watch and
history still work, and removes only the story and its flags. No foreign-key order matters because no
rows are deleted.

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "UPDATE notifications SET payload_json=json_remove(payload_json,'$.story_text','$.story_consent','$.source') WHERE buyer_id='BUYER_ID' AND type='buyer_experience_submitted' AND json_extract(payload_json,'$.source')='buyer_story'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "UPDATE buyers SET answers_json=json_remove(answers_json,'$.source'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='BUYER_ID' AND json_extract(answers_json,'$.source')='buyer_story'"
```

`notification_deliveries` has no story content, so it is left as is in Option A.

## Option B: delete the whole buyer record

Use this only if the buyer asks to delete everything. It is wider than the Buyer Story, so confirm the
scope with Sebastian first. The schema declares `ON DELETE CASCADE` from `buyers` to `buyer_sessions`,
`notifications` (and from there `notification_deliveries`), `buyer_activity_alerts`, `buyer_notes`,
`buyer_tasks`, `buyer_case_members`, `buyer_person_profiles` and other buyer-keyed tables. The tables
below have **no** foreign key and must be cleared by hand. To avoid relying on cascade behavior, delete
children first, in this order.

Preview counts first (SELECT):

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "SELECT (SELECT COUNT(*) FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE buyer_id='BUYER_ID')) AS deliveries, (SELECT COUNT(*) FROM notifications WHERE buyer_id='BUYER_ID') AS notifications, (SELECT COUNT(*) FROM hbe_lead_events WHERE buyer_id='BUYER_ID') AS lead_events, (SELECT COUNT(*) FROM hbe_lead_status WHERE buyer_id='BUYER_ID') AS lead_status, (SELECT COUNT(*) FROM hbe_push_alerts WHERE buyer_id='BUYER_ID') AS push_alerts, (SELECT COUNT(*) FROM hbe_buyer_journeys WHERE buyer_id='BUYER_ID') AS journeys, (SELECT COUNT(*) FROM hbe_buyer_journey_generations WHERE buyer_id='BUYER_ID') AS journey_gens, (SELECT COUNT(*) FROM buyer_sessions WHERE buyer_id='BUYER_ID') AS sessions, (SELECT COUNT(*) FROM buyers WHERE id='BUYER_ID') AS buyers"
```

Then delete (WRITE: needs Sebastian's approval), one statement per command, in this order:

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE buyer_id='BUYER_ID')"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM notifications WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM hbe_lead_events WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM hbe_lead_status WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM hbe_push_alerts WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM hbe_buyer_journeys WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM hbe_buyer_journey_generations WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM buyer_sessions WHERE buyer_id='BUYER_ID'"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "DELETE FROM buyers WHERE id='BUYER_ID'"
```

If the buyer belongs to a shared case (`buyer_case_members`), the case tables (`buyer_cases`,
`household_*`, `bimatrix_*`, `showing_*`) hold the other buyer's data too. Do not delete the case without
a separate decision from Sebastian.

## Alert email copies

The alert goes from `buyer-alerts@hbexperts.com` to the `send_email` allow-list in `wrangler.toml`:
`buyers@hbexperts.com` and `cwhitehead@hbexperts.com` (via `HBE_ALERT_TO`). In **each** of those
mailboxes (WRITE: needs Sebastian's approval):

1. Search Gmail:
   `subject:"New HBE Buyer Experience submitted" "Source: Buyer Story" "BUYER_EMAIL_HERE"`
2. Open each result and confirm it is the right buyer, then delete it.
3. Empty Trash (or search `in:trash` with the same query and choose **Delete forever**).

Also check:
- **Forwarding or groups.** If `buyers@hbexperts.com` is a Google Group or forwards to other people
  (for example Jen's mailbox), repeat the search in every recipient mailbox, and in the group archive
  if the group keeps one.
- **Replies and forwards** that quote the story: search the same mailboxes for the buyer's email plus
  `"THEIR BUYER STORY"`.
- **Google Workspace retention (Vault).** If a Vault retention rule or hold covers these mailboxes, a
  deleted message is kept until the rule allows it. Check in the Admin console and note it in the log.
- The Worker sends through Cloudflare, so there is no copy in a "Sent" folder for `buyer-alerts@`.

## Other places

- **D1 Time Travel.** D1 keeps point-in-time history for restores. Per Cloudflare's docs (developers.cloudflare.com/d1/reference/time-travel/) it is 30 days on
  the Workers Paid plan and 7 days on Free. Check the account's plan and the current docs. Purged data
  can still be restored from that history until the window passes, so a purge is only complete after it.
  Do not restore to a point before the purge.
- **Manual exports.** Any `wrangler d1 export` files or other backups someone made must be found and
  deleted, or noted in the log if they can't be.
- **GTM / Google Ads.** None on the questionnaire, the story step or the portal (tested), so nothing to
  purge. The #108 conversion frame only ever carries a click ID.
- **The buyer's device.** HBE cannot reach it. The story step never writes it to localStorage or
  sessionStorage, and after a download it clears the questionnaire draft from sessionStorage. Any PDF the
  buyer saved or printed is theirs. Tell them so in the confirmation.

## Verification

Option A (each must return 0):

```sh
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "SELECT COUNT(*) AS story_rows FROM notifications WHERE buyer_id='BUYER_ID' AND (json_extract(payload_json,'$.story_text') IS NOT NULL OR json_extract(payload_json,'$.source')='buyer_story')"
wrangler d1 execute hbe-buyer-journey-v2 --remote --command "SELECT COUNT(*) AS flagged FROM buyers WHERE id='BUYER_ID' AND json_extract(answers_json,'$.source')='buyer_story'"
```

Option B: rerun the Option B preview counts. Every column must be 0.

Email: the Gmail searches above, including `in:trash`, return nothing in every mailbox checked.

## Log template (no buyer PII)

Use an opaque request ref (for example `BSP-2026-001`). Never put the buyer's name, email, phone or
buyer ID in this log.

```
Request ref:            BSP-YYYY-NNN
Date received:          YYYY-MM-DD
Operator:               (initials)
Approval ref:           (where Sebastian's approval is recorded, with date)
Scope:                  A (story only) / B (whole record)
Steps done:             [ ] A1 identify  [ ] A2/B preview  [ ] A3/B write  [ ] email: buyers@  [ ] email: cwhitehead@
                        [ ] forwards/group checked  [ ] Vault checked  [ ] exports checked
Row counts:             before: ____   affected: ____   after: ____
Time Travel window ends: YYYY-MM-DD
Verified:               yes / no (notes)
Confirmation to buyer:  YYYY-MM-DD
```
