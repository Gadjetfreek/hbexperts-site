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
goes in a SQL file written from a **single-quoted heredoc**. Writes run with `--file`; SELECT previews
pass the same file's content with `--command` (see the note under the helpers).

**Buyer IDs are UUID v4.** `createBuyer` in `src/worker.js` sets `id=crypto.randomUUID()`, which is
always lowercase `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`. So the ID is validated with a strict v4 regex.

Set up once per session (bash or zsh):

```sh
set +o history 2>/dev/null || true   # keep IDs out of shell history for this session
UUID_V4='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
# Private temp dir for the SQL file (never a fixed name in the repo); removed when the shell exits.
PURGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hbe-purge.XXXXXX") && chmod 700 "$PURGE_DIR"
PURGE_SQL="$PURGE_DIR/purge.sql"
trap 'rm -rf "$PURGE_DIR"' EXIT INT TERM HUP

read -r ID                           # paste the buyer ID from the lookup (step A1), then Enter
[[ $ID =~ $UUID_V4 ]] && echo "ID ok" || { echo "NOT a buyer ID. Stop."; unset ID; }

run_purge_sql() {                    # fills the placeholder in $PURGE_SQL, runs it, deletes it
  [[ $ID =~ $UUID_V4 ]] || { echo "ID not validated. Stop." >&2; rm -f "$PURGE_SQL"; return 1; }
  sed "s/__BUYER_ID__/$ID/g" "$PURGE_SQL" > "$PURGE_SQL.run" && mv "$PURGE_SQL.run" "$PURGE_SQL"
  wrangler d1 execute hbe-buyer-journey-v2 --remote --file "$PURGE_SQL"
  rm -f "$PURGE_SQL" "$PURGE_SQL.run"
}

select_only_sql() {                  # prints the file as ONE normalized SELECT, or refuses (exit 1)
  local q
  q=$(sed -E 's/^[[:space:]]*--.*$//' "$1" | tr '\r\n\t' '   ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')
  q=$(printf '%s' "$q" | sed -E 's/ ?;$//')     # drop ONE trailing semicolon
  case $q in
    *';'*)               echo "Refused: more than one statement (';')." >&2; return 1;;
    *'--'*|*'/*'*|*'*/'*) echo "Refused: inline comment." >&2; return 1;;
  esac
  printf '%s' "$q" | grep -Eiq '^select ' || { echo "Refused: not a single SELECT." >&2; return 1; }
  if printf '%s' "$q" | grep -Eiq '(^|[^a-z0-9_])(insert|update|delete|drop|alter|attach|detach|pragma|replace|create|vacuum)([^a-z0-9_]|$)'; then
    echo "Refused: write keyword in a SELECT preview." >&2; return 1
  fi
  printf '%s\n' "$q"
}

run_select_sql() {                   # like run_purge_sql, for SELECT previews: prints the result rows
  [[ $ID =~ $UUID_V4 ]] || { echo "ID not validated. Stop." >&2; rm -f "$PURGE_SQL"; return 1; }
  sed "s/__BUYER_ID__/$ID/g" "$PURGE_SQL" > "$PURGE_SQL.run" && mv "$PURGE_SQL.run" "$PURGE_SQL"
  local q
  q=$(select_only_sql "$PURGE_SQL") || { rm -f "$PURGE_SQL" "$PURGE_SQL.run"; return 1; }   # fails closed: wrangler never runs
  wrangler d1 execute hbe-buyer-journey-v2 --remote --command "$q"
  rm -f "$PURGE_SQL" "$PURGE_SQL.run"
}
```

**Why two helpers:** `wrangler d1 execute --remote --file` runs the file as an import and prints only a
summary (queries run, rows read and written), **not the result rows**. That is fine for writes, and the
summary's rows-written figure is useful there, but a SELECT preview run with `--file` shows no counts. So
SELECT previews use `run_select_sql`, which passes the **same template content** with `--command`. This is
still safe: `"$q"` hands the SQL to wrangler as one argument, and the shell does not re-expand text that
comes out of a command substitution. The content is the quoted-heredoc template with only a regex-checked
ID filled in. (Observed on the Nov 21, 2026 ZZTEST smoke-test purge.)

**`--command` runs every statement it is given, so `run_select_sql` is SELECT-only by construction.**
`select_only_sql` checks the SQL before wrangler is called and fails closed (prints `Refused: …`, deletes
the file, runs nothing):
1. It drops whole-line `--` comments, turns tabs and newlines into spaces, collapses whitespace, and drops
   **one** trailing `;`. The normalized text is exactly what is sent to wrangler.
2. It refuses any remaining `;` (so only a single statement gets through), and any inline comment
   (`--`, `/*`, `*/`).
3. It requires the text to start with `SELECT ` (any case). `WITH ... SELECT` is refused on purpose.
4. It refuses the whole words `INSERT UPDATE DELETE DROP ALTER ATTACH DETACH PRAGMA REPLACE CREATE VACUUM`
   anywhere, in any case. Column names such as `updated_at` or `created_at` are not whole words, so they pass.

Tested cases (bash, Nov 21, 2026):
- **Refused:** `DELETE FROM buyers WHERE id='x'; SELECT 1;`, `SELECT 1; DELETE FROM buyers;`, `SELECT 1;;`,
  `select 1; select 2`, `WITH t AS (SELECT 1) SELECT * FROM t`, `SELECT 1 -- x`, `SELECT /* x */ 1`,
  `SELECT replace(a,'b','c') FROM t`, `select * from buyers where 1=1 or delete`, `PRAGMA table_list`,
  `ATTACH DATABASE 'x' AS y`, `UPDATE buyers SET email=null`, an empty file. In each refused case, wrangler
  was not called.
- **Accepted:** every SELECT block in this runbook (A1, A2, B1, Option A verification), `select 1;`,
  `SELECT updated_at, created_at FROM buyers`, and a SELECT with whole-line `--` comments above it.
- Side effect: an email containing `--` (A1) or the words above (for example `delete@…`) is refused. Use
  the dashboard for those, as for `'` and `;`.

Then each step below is: write the file with `cat > "$PURGE_SQL" <<'SQL' ... SQL`, then run
`run_select_sql` (SELECT) or `run_purge_sql` (UPDATE/DELETE), as the step says.
The repo's `.gitignore` also ignores `purge*.sql`, as a backstop in case a file is ever made by hand.

**Why this blocks injection:**
- With the quoted delimiter (`<<'SQL'`), the shell expands nothing in the body. `$(...)`, backticks,
  `$VAR` and quotes are written to the file literally.
- The SQL only says `'__BUYER_ID__'`. The real ID goes in through `sed`, and only after the regex
  passes. The regex allows only `0-9`, `a-f` and `-`. That means no quote can close the SQL literal,
  no `/`, `&` or `\` can break the `sed` expression, and no shell metacharacter can appear.
- `--file` (writes) means the SQL never passes through shell quoting at all. `--command "$q"`
  (SELECT previews) passes it as a single argument without re-expansion, after `select_only_sql` has
  confirmed it is one SELECT.
- The SQL file holds an ID, so it lives in a private `mktemp -d` directory, each helper deletes it
  after every run, and the `trap` removes the whole directory when the shell exits or is interrupted.

Don't hand-edit IDs into the file. Always go through `read -r ID`, the regex check and `run_select_sql` / `run_purge_sql`.

## Option A: purge the story only (default)

Use this when the buyer asks to delete their story but not their whole record.

### A1. Find the buyer ID (read-only, no PII export)

Preferred: in the Cloudflare dashboard, open D1 > `hbe-buyer-journey-v2` > Console and run the lookup
there, so the email never touches a shell. **If the email contains `'` or `;`, use the dashboard only.**

CLI alternative, only with this guard. It **stops** on `'` or `;`, and otherwise only accepts a plain
address made of letters, digits and `. _ % + -`, which can't break the SQL literal or the `sed`
expression:

```sh
read -r EMAIL                        # type the buyer's email, then Enter
case $EMAIL in *"'"*|*";"*) echo "Email contains ' or ;. Stop and use the dashboard."; unset EMAIL;; esac
EMAIL_RE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
[[ -n $EMAIL && $EMAIL =~ $EMAIL_RE ]] && echo "email ok" || { echo "Unusual email. Stop and use the dashboard."; unset EMAIL; }

cat > "$PURGE_SQL" <<'SQL'
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
[[ -n $EMAIL && $EMAIL =~ $EMAIL_RE ]] || { echo "Email not validated. Stop."; rm -f "$PURGE_SQL"; }
[[ -f $PURGE_SQL ]] && sed "s/__BUYER_EMAIL__/$EMAIL/g" "$PURGE_SQL" > "$PURGE_SQL.run" && mv "$PURGE_SQL.run" "$PURGE_SQL" \
  && Q=$(select_only_sql "$PURGE_SQL") && wrangler d1 execute hbe-buyer-journey-v2 --remote --command "$Q"
rm -f "$PURGE_SQL" "$PURGE_SQL.run"; unset EMAIL Q
```

- The output is only IDs, dates, flags and lengths. Don't copy it into the log.
- More than one buyer row can come back (one per submission). Repeat the steps below for each
  `buyer_id` whose `payload_source` is `buyer_story`.
- Then `read -r ID` and validate it, as in the safe pattern above.

### A2. Preview (SELECT, agents may prepare and run it)

```sh
cat > "$PURGE_SQL" <<'SQL'
SELECT n.id, n.type,
       json_extract(n.payload_json,'$.source') AS source,
       json_extract(n.payload_json,'$.story_consent') AS consent,
       length(json_extract(n.payload_json,'$.story_text')) AS story_chars,
       d.status AS delivery_status
FROM notifications n
LEFT JOIN notification_deliveries d ON d.notification_id=n.id
WHERE n.buyer_id='__BUYER_ID__' AND n.type='buyer_experience_submitted';
SQL
run_select_sql
```

### A3. Redact (WRITE: needs Sebastian's approval)

This keeps the lead (`buyers`, `notifications`, `notification_deliveries` rows) so the lead watch and
history still work, and removes only the story and its flags. No rows are deleted, so foreign-key order
doesn't matter. `notification_deliveries` has no story content and is left alone.

```sh
cat > "$PURGE_SQL" <<'SQL'
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
  `hbe_buyer_journeys`, `hbe_buyer_journey_generations`, and `hbe_push_dispatch_log`, which links to the
  buyer only through `hbe_push_dispatch_log.alert_id` = `hbe_push_alerts.id` (`schema.sql`). Delete the
  dispatch log rows **before** `hbe_push_alerts`, because the subquery finds them through the buyer's alert
  IDs. The log holds delivery outcome and subscription ID only, no buyer content.
- **`buyer_sessions`, as observed:** the schema declares `ON DELETE CASCADE`, so B2 leaves it to the
  `buyers` delete. On the Nov 21, 2026 ZZTEST smoke-test purge, the operator also ran
  `DELETE FROM buyer_sessions WHERE buyer_id='__BUYER_ID__';` just before the `buyers` delete. It removed 1
  row per buyer, and B1 afterwards showed 0 sessions. So that run did not exercise the cascade itself.
  Either way is fine: rerun B1 and confirm `sessions` is 0.

Some tables come from optional schema files (`schema-issue29.sql`, `schema-issue33.sql`,
`schema-stage4.sql`) and migrations (`migrations/hbe-*.sql`), and may not exist in production.
**Nothing skips a missing table automatically.** If B1 fails with `no such table: X`, the operator must
**manually** remove every line that mentions table `X` from the SQL, rerun B1, and note the skipped
table in the log. Do this with B1 before B2, so B2 is edited the same way before any delete runs.

**B1. Preview and verify counts** (SELECT). Run this before the delete, and again after it.

```sh
cat > "$PURGE_SQL" <<'SQL'
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
 (SELECT COUNT(*) FROM hbe_push_dispatch_log WHERE alert_id IN (SELECT id FROM hbe_push_alerts WHERE buyer_id='__BUYER_ID__')) AS push_dispatch_log,
 (SELECT COUNT(*) FROM hbe_push_alerts WHERE buyer_id='__BUYER_ID__') AS push_alerts,
 (SELECT COUNT(*) FROM hbe_buyer_journeys WHERE buyer_id='__BUYER_ID__') AS journeys,
 (SELECT COUNT(*) FROM hbe_buyer_journey_generations WHERE buyer_id='__BUYER_ID__') AS journey_generations;
SQL
run_select_sql
```

**B2. Delete** (WRITE: needs Sebastian's approval). Tables without a foreign key go first, then the
notification children, then `buyers` (the cascade and SET NULL rules handle the rest).

```sh
cat > "$PURGE_SQL" <<'SQL'
DELETE FROM hbe_lead_events WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_lead_status WHERE buyer_id='__BUYER_ID__';
DELETE FROM hbe_push_dispatch_log WHERE alert_id IN (SELECT id FROM hbe_push_alerts WHERE buyer_id='__BUYER_ID__');
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
cat > "$PURGE_SQL" <<'SQL'
SELECT
 (SELECT COUNT(*) FROM notifications WHERE buyer_id='__BUYER_ID__'
    AND (json_extract(payload_json,'$.story_text') IS NOT NULL OR json_extract(payload_json,'$.source')='buyer_story')) AS story_rows,
 (SELECT COUNT(*) FROM buyers WHERE id='__BUYER_ID__' AND json_extract(answers_json,'$.source')='buyer_story') AS flagged;
SQL
run_select_sql
```

Option B: rerun B1. Every column must be 0.

Email: the `in:anywhere` Gmail searches above, plus `in:trash` and `in:spam`, return nothing in every
mailbox checked.

Files: `ls "$PURGE_DIR"` shows nothing. Then `unset ID`, `set -o history`, and close the shell (the trap
removes `$PURGE_DIR`).

## Log template (no buyer PII)

Use an opaque request ref (for example `BSP-2026-001`). Never put the buyer's name, email, phone or
buyer ID in this log.

```
Request ref:            BSP-YYYY-NNN
Date received:          YYYY-MM-DD
Operator:               (initials)
Approval ref:           (where Sebastian's approval is recorded, with date)
Scope:                  A (story only) / B (whole record)
Steps done:             [ ] A1 identify  [ ] ID regex-checked  [ ] A2/B1 preview  [ ] A3/B2 write  [ ] temp SQL dir removed
                        [ ] email: buyers@  [ ] email: cwhitehead@  [ ] Spam + Trash emptied
                        [ ] forwards/group checked  [ ] Vault checked  [ ] exports checked
Row counts:             before: ____   affected: ____   after: ____
Time Travel window ends: YYYY-MM-DD (plan confirmed? yes/no; assume 30 days if no)
Verified:               yes / no (notes)
Confirmation to buyer:  YYYY-MM-DD
```
