# Runbook: purge a shared Buyer Story on request

Use this when a buyer asks HBE to delete the Buyer Story they shared (the "Share my story with HBE"
path, PR #113). Downloaded stories never reach HBE, so there is nothing to purge for those.

> **APPROVAL GATE.** Every write in this runbook (any `UPDATE` or `DELETE`, and deleting email) needs
> **Sebastian's explicit approval, in his own words, for that specific request**, recorded as the
> approval ref in the log below. Standing rule: Forge and other agents run D1 **SELECT-only**. A
> human operator runs the write commands. Agents may prepare the commands and run the SELECT previews.

Database: `hbe-buyer-journey-v2` (binding `BUYER_DB`, `secure-platform/wrangler.toml`).
Commands below are run from `secure-platform/` with an authenticated `wrangler`, following the safe
command pattern below.

## Open items (confirm before the first real request)

- [ ] **buyers@ forwarding and group membership.** Confirm in the Google Admin console whether
  `buyers@hbexperts.com` is a user mailbox, an alias or a Google Group, who receives its mail (for
  example Jen), and whether the group keeps an archive. Every recipient mailbox is in scope for the
  email steps.
- [ ] **Cloudflare plan / D1 Time Travel window.** The account was on the **Free** plan as of Oct 27, 2026,
  and that hasn't been reconfirmed. Check it in the dashboard. Until it's checked, **assume a 30-day
  window** (the longer, Paid-plan figure).

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

## Safe command pattern (read this first)

Never paste a buyer's email or ID into a double-quoted `--command "..."`. Every query, reads included,
goes in a SQL file written from a **single-quoted heredoc** and runs with `--file`.

**Buyer IDs are UUID v4.** `createBuyer` in `src/worker.js` sets `id=crypto.randomUUID()`, which is
always lowercase `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`. So the ID is validated with a strict v4 regex.

Set up once per session (bash or zsh):

```sh
set +o history 2>/dev/null || true   # keep IDs out of shell history for this session
UUID_V4='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
read -r ID                           # paste the buyer ID from the lookup (step A1), then Enter
[[ $ID =~ $UUID_V4 ]] && echo "ID ok" || { echo "NOT a buyer ID. Stop."; unset ID; }

run_purge_sql() {                    # fills the placeholder in purge.sql, runs it, deletes it
  [[ $ID =~ $UUID_V4 ]] || { echo "ID not validated. Stop." >&2; rm -f purge.sql; return 1; }
  sed "s/__BUYER_ID__/$ID/g" purge.sql > purge.run.sql && mv purge.run.sql purge.sql
  wrangler d1 execute hbe-buyer-journey-v2 --remote --file purge.sql
  rm -f purge.sql purge.run.sql
}
```

Then each step below is: write `purge.sql` with `cat > purge.sql <<'SQL' ... SQL`, then run `run_purge_sql`.

**Why this blocks injection:**
- With the quoted delimiter (`<<'SQL'`), the shell expands nothing in the body. `$(...)`, backticks,
  `$VAR` and quotes are written to the file literally.
- The SQL only says `'__BUYER_ID__'`. The real ID goes in through `sed`, and only after the regex
  passes. The regex allows only `0-9`, `a-f` and `-`. That means no quote can close the SQL literal,
  no `/`, `&` or `\` can break the `sed` expression, and no shell metacharacter can appear.
- `--file` means the SQL never passes through shell quoting at all.
- `purge.sql` holds an ID, so `run_purge_sql` deletes it after every run. Check `ls purge*.sql` at the
  end, and delete anything left over.

If you would rather type the ID by hand, open `purge.sql` in an editor and replace `__BUYER_ID__`
yourself. Still run the regex check on it first. A valid ID contains no `'`, but if you ever edit any
other literal by hand, write each `'` as `''`.

## Option A: purge the story only (default)

Use this when the buyer asks to delete their story but not their whole record.

### A1. Find the buyer ID (read-only, no PII export)

Preferred: in the Cloudflare dashboard, open D1 > `hbe-buyer-journey-v2` > Console and run the lookup
there, so the email never touches a shell.

If you must use the CLI, use the file method. Write the template, then open `purge.sql` in an editor
and replace `__BUYER_EMAIL__` with the address the buyer gave. If it contains `'`, write it as `''`.
Do **not** substitute an email with `sed` or the shell.

```sh
cat > purge.sql <<'SQL'
SELECT b.id AS buyer_id,
       substr(b.submitted_at,1,10) AS submitted_on,
       json_extract(b.answers_json,'$.source') AS answers_source,
       n.id AS notification_id,
       json_extract(n.payload_json,'$.source') AS payload_source,
       length(json_extract(n.payload_json,'$.story_text')) AS story_chars
FROM buyers b
LEFT JOIN notifications n ON n.buyer_id=b.id AND n.type='buyer_experience_submitted'
WHERE lower(b.email)=lower('__BUYER_EMAIL__')
ORDER BY b.submitted_at DESC;
SQL
# edit purge.sql by hand now (replace __BUYER_EMAIL__), then:
wrangler d1 execute hbe-buyer-journey-v2 --remote --file purge.sql
rm -f purge.sql
```

- The output is only IDs, dates, flags and lengths. Don't copy it into the log.
- More than one buyer row can come back (one per submission). Repeat the steps below for each
  `buyer_id` whose `payload_source` is `buyer_story`.
- Then `read -r ID` and validate it, as in the safe pattern above.

### A2. Preview (SELECT, agents may prepare and run it)

```sh
cat > purge.sql <<'SQL'
SELECT n.id, n.type,
       json_extract(n.payload_json,'$.source') AS source,
       json_extract(n.payload_json,'$.story_consent') AS consent,
       length(json_extract(n.payload_json,'$.story_text')) AS story_chars,
       d.status AS delivery_status
FROM notifications n
LEFT JOIN notification_deliveries d ON d.notification_id=n.id
WHERE n.buyer_id='__BUYER_ID__' AND n.type='buyer_experience_submitted';
SQL
run_purge_sql
```

### A3. Redact (WRITE: needs Sebastian's approval)

This keeps the lead (`buyers`, `notifications`, `notification_deliveries` rows) so the lead watch and
history still work, and removes only the story and its flags. No rows are deleted, so foreign-key order
doesn't matter. `notification_deliveries` has no story content and is left alone.

```sh
cat > purge.sql <<'SQL'
UPDATE notifications
   SET payload_json=json_remove(payload_json,'$.story_text','$.story_consent','$.source')
 WHERE buyer_id='__BUYER_ID__' AND type='buyer_experience_submitted'
   AND json_extract(payload_json,'$.source')='buyer_story';
UPDATE buyers
   SET answers_json=json_remove(answers_json,'$.source'),
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id='__BUYER_ID__' AND json_extract(answers_json,'$.source')='buyer_story';
SQL
run_purge_sql
```

## Option B: delete the whole buyer record

Use this only if the buyer asks to delete everything. It is wider than the Buyer Story, so confirm the
scope with Sebastian first. D1 enforces foreign keys by default.

What happens when the `buyers` row is deleted (from `schema*.sql` and `migrations/`):

- **CASCADE (rows deleted):** `buyer_sessions`, `notifications` (then `notification_deliveries`),
  `buyer_activity_alerts`, `buyer_notes`, `buyer_tasks`, `buyer_case_members`,
  `buyer_case_invitations` (`created_by_buyer_id`), `buyer_person_profiles`,
  `buyer_representation_choices`, `buyer_private_context`, `household_view_permissions`,
  `buyer_search_confirmations`.
- **SET NULL (rows stay, the buyer reference is cleared):** `household_tasks.buyer_id`,
  `buyer_time_entries.buyer_id`, `bimatrix_screenings.opted_in_by_buyer_id`,
  `bimatrix_facts.source_buyer_id`, `bimatrix_freshness_checks.requested_by_buyer_id`,
  `buyer_case_invitations.accepted_by_buyer_id`. These rows belong to the case, so their content stays.
  Decide with Sebastian whether any of it needs separate redaction.
- **No foreign key (delete by hand first):** `hbe_lead_events`, `hbe_lead_status`, `hbe_push_alerts`,
  `hbe_buyer_journeys`, `hbe_buyer_journey_generations`.

Some tables come from optional schema files (`schema-issue29.sql`, `schema-issue33.sql`,
`schema-stage4.sql`). If a query fails with `no such table`, delete that line and rerun, and note it in
the log.

**B1. Preview and verify counts** (SELECT). Run this before the delete, and again after it.

```sh
cat > purge.sql <<'SQL'
SELECT
 (SELECT COUNT(*) FROM buyers WHERE id='__BUYER_ID__') AS buyers,
 (SELECT COUNT(*) FROM buyer_sessions WHERE buyer_id='__BUYER_ID__') AS sessions,
 (SELECT COUNT(*) FROM notifications WHERE buyer_id='__BUYER_ID__') AS notifications,
 (SELECT COUNT(*) FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE buyer_id='__BUYER_ID__')) AS deliveries,
 (SELECT COUNT(*) FROM buyer_activity_alerts WHERE buyer_id='__BUYER_ID__') AS activity_alerts,
 (SELECT COUNT(*) FROM buyer_notes WHERE buyer_id='__BUYER_ID__') AS notes,
 (SELECT COUNT(*) FROM buyer_tasks WHERE buyer_id='__BUYER_ID__') AS tasks,
 (SELECT COUNT(*) FROM buyer_case_members WHERE buyer_id='__BUYER_ID__') AS case_members,
 (SELECT COUNT(*) FROM buyer_case_invitations WHERE created_by_buyer_id='__BUYER_ID__') AS invitations_created,
 (SELECT COUNT(*) FROM buyer_case_invitations WHERE accepted_by_buyer_id='__BUYER_ID__') AS invitations_accepted_setnull,
 (SELECT COUNT(*) FROM buyer_person_profiles WHERE buyer_id='__BUYER_ID__') AS person_profiles,
 (SELECT COUNT(*) FROM buyer_representation_choices WHERE buyer_id='__BUYER_ID__') AS representation_choices,
 (SELECT COUNT(*) FROM buyer_private_context WHERE buyer_id='__BUYER_ID__') AS private_context,
 (SELECT COUNT(*) FROM household_view_permissions WHERE buyer_id='__BUYER_ID__') AS view_permissions,
 (SELECT COUNT(*) FROM buyer_search_confirmations WHERE buyer_id='__BUYER_ID__') AS search_confirmations,
 (SELECT COUNT(*) FROM household_tasks WHERE buyer_id='__BUYER_ID__') AS household_tasks_setnull,
 (SELECT COUNT(*) FROM buyer_time_entries WHERE buyer_id='__BUYER_ID__') AS time_entries_setnull,
 (SELECT COUNT(*) FROM bimatrix_screenings WHERE opted_in_by_buyer_id='__BUYER_ID__') AS bimatrix_screenings_setnull,
 (SELECT COUNT(*) FROM bimatrix_facts WHERE source_buyer_id='__BUYER_ID__') AS bimatrix_facts_setnull,
 (SELECT COUNT(*) FROM bimatrix_freshness_checks WHERE requested_by_buyer_id='__BUYER_ID__') AS bimatrix_freshness_setnull,
 (SELECT COUNT(*) FROM hbe_lead_events WHERE buyer_id='__BUYER_ID__') AS lead_events,
 (SELECT COUNT(*) FROM hbe_lead_status WHERE buyer_id='__BUYER_ID__') AS lead_status,
 (SELECT COUNT(*) FROM hbe_push_alerts WHERE buyer_id='__BUYER_ID__') AS push_alerts,
 (SELECT COUNT(*) FROM hbe_buyer_journeys WHERE buyer_id='__BUYER_ID__') AS journeys,
 (SELECT COUNT(*) FROM hbe_buyer_journey_generations WHERE buyer_id='__BUYER_ID__') AS journey_generations;
SQL
run_purge_sql
```

**B2. Delete** (WRITE: needs Sebastian's approval). Tables without a foreign key go first, then the
notification children, then `buyers` (the cascade and SET NULL rules handle the rest).

```sh
cat > purge.sql <<'SQL'
DELETE FROM hbe_lead_events WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_lead_status WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_push_alerts WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_buyer_journeys WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_buyer_journey_generations WHERE buyer_id='__BUYER_ID__';
DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE buyer_id='__BUYER_ID__');
DELETE FROM notifications WHERE buyer_id='__BUYER_ID__';
DELETE FROM buyers WHERE id='__BUYER_ID__';
SQL
run_purge_sql
```

After B2, rerun B1. Every column must be 0. The `_setnull` columns are 0 because those rows now have
NULL in place of the buyer ID.

If the buyer belongs to a shared case (`buyer_case_members`), the case tables (`buyer_cases`,
`household_*`, `bimatrix_*`, `showing_*`) hold the other buyer's data too. Don't delete the case without
a separate decision from Sebastian.

## Alert email copies

The alert goes from `buyer-alerts@hbexperts.com` to the `send_email` allow-list in `wrangler.toml`:
`buyers@hbexperts.com` and `cwhitehead@hbexperts.com` (via `HBE_ALERT_TO`). In **each** of those
mailboxes (WRITE: needs Sebastian's approval):

1. Search Gmail, including Spam and Trash (`in:anywhere` covers both):
   `in:anywhere subject:"New HBE Buyer Experience submitted" "Source: Buyer Story" "BUYER_EMAIL_HERE"`
2. Open each result and confirm it is the right buyer, then delete it.
3. Empty Trash, or search `in:trash` with the same query and choose **Delete forever**. Do the same for
   `in:spam`: messages in Spam are deleted forever from there.

Also check:
- **Forwarding or groups** (see Open items). If `buyers@hbexperts.com` is a Google Group or forwards
  to other people (for example Jen's mailbox), repeat the search in every recipient mailbox, and in the
  group archive if the group keeps one.
- **Replies and forwards** that quote the story: search the same mailboxes for the buyer's email plus
  `"THEIR BUYER STORY"`.
- **Google Workspace retention (Vault).** If a Vault retention rule or hold covers these mailboxes, a
  deleted message is kept until the rule allows it. Check in the Admin console and note it in the log.
- The Worker sends through Cloudflare, so there is no copy in a "Sent" folder for `buyer-alerts@`.

## Other places

- **D1 Time Travel.** D1 keeps point-in-time history for restores. Per Cloudflare's docs (developers.cloudflare.com/d1/reference/time-travel/) it is 30 days on
  the Workers Paid plan and 7 days on Free. The plan was Free as of Oct 27, 2026, and that hasn't been
  reconfirmed, so **assume 30 days** until someone checks. Purged data
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

Option A (both counts must be 0):

```sh
cat > purge.sql <<'SQL'
SELECT
 (SELECT COUNT(*) FROM notifications WHERE buyer_id='__BUYER_ID__'
    AND (json_extract(payload_json,'$.story_text') IS NOT NULL OR json_extract(payload_json,'$.source')='buyer_story')) AS story_rows,
 (SELECT COUNT(*) FROM buyers WHERE id='__BUYER_ID__' AND json_extract(answers_json,'$.source')='buyer_story') AS flagged;
SQL
run_purge_sql
```

Option B: rerun B1. Every column must be 0.

Email: the `in:anywhere` Gmail searches above, plus `in:trash` and `in:spam`, return nothing in every
mailbox checked.

Files: `ls purge*.sql` shows nothing. Then `unset ID` and `set -o history`.

## Log template (no buyer PII)

Use an opaque request ref (for example `BSP-2026-001`). Never put the buyer's name, email, phone or
buyer ID in this log.

```
Request ref:            BSP-YYYY-NNN
Date received:          YYYY-MM-DD
Operator:               (initials)
Approval ref:           (where Sebastian's approval is recorded, with date)
Scope:                  A (story only) / B (whole record)
Steps done:             [ ] A1 identify  [ ] ID regex-checked  [ ] A2/B1 preview  [ ] A3/B2 write  [ ] purge.sql deleted
                        [ ] email: buyers@  [ ] email: cwhitehead@  [ ] Spam + Trash emptied
                        [ ] forwards/group checked  [ ] Vault checked  [ ] exports checked
Row counts:             before: ____   affected: ____   after: ____
Time Travel window ends: YYYY-MM-DD (plan confirmed? yes/no; assume 30 days if no)
Verified:               yes / no (notes)
Confirmation to buyer:  YYYY-MM-DD
```
