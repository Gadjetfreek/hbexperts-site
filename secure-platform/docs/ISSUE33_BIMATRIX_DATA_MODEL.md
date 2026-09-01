# Issue #33 — Buyer Incentive Matrix data + rule contract

> **Status:** Phase 1 design contract. No production deployment authorized by this document.
>
> **Source issue:** `Gadjetfreek/hbexperts-site#33`

## Mission

Add the Buyer Incentive Matrix (BIMatrix) inside the existing authenticated `secure-platform` without weakening the current BuyerUI/HBEUI security boundary.

The design must make useful assistance visible before asking a buyer for additional personal eligibility information, then perform deterministic and auditable screening only after explicit opt-in.

## Non-negotiable boundaries

1. **Browse first.** Logged-in buyers can browse general program information without starting an eligibility screen.
2. **Explicit opt-in.** Buyer-specific screening begins only after the buyer chooses an action such as **Check My Eligibility**.
3. **Reuse known facts.** After opt-in, the system may derive/copy facts already present in Buyer Experience or household data so the buyer is not asked to repeat them.
4. **No LLM eligibility decisions.** Classification is produced by deterministic rules tied to authoritative sources.
5. **Buyer data stays in D1.** Screening consent, facts, results, and household-specific HBE annotations never belong in GitHub.
6. **Canonical program data may be versioned in GitHub.** Public program facts, source references, and deterministic rules contain no household data and benefit from code review/history.
7. **No silent research writes.** RokBot/research may propose changes, but a human/Jeebs review must approve canonical rule changes.
8. **Keep current protections.** Preserve household isolation, authenticated/per-device sessions, separate HBEUI protection, `no-store`, `noindex`, restrictive response headers, and Cloudflare boundaries.

## Proposed repository layout

```text
secure-platform/
  bimatrix/
    catalog/
      <program-id>.json
    program.schema.json
    CHANGELOG.md
  docs/
    ISSUE33_BIMATRIX_DATA_MODEL.md
  src/
    bimatrix/
      evaluator.js
      catalog.js
      facts.js
  tests/
    bimatrix.test.mjs
  schema-issue33.sql
```

`catalog/*.json` is canonical only after review. Research output should arrive as an issue, PR, or change report and must not overwrite an approved program record automatically.

## Canonical program record

Each program record should be immutable by version. A material change creates a new `version` rather than silently editing history.

Minimum fields:

- `program_id` — stable machine ID, e.g. `ohfa-down-payment-assistance`
- `version` — monotonically increasing integer or deterministic content version
- `name`
- `administrator`
- `summary_plain_english`
- `status` — `open | closed | paused | exhausted | unknown | retired`
- `benefit`
  - `type` — `grant | forgivable_assistance | deferred_loan | repayable_loan | tax_credit | tax_abatement | mortgage_rate_program | other`
  - public amount/range/formula where available
- `geography`
  - state/county/municipality/target-area/census-tract constraints
- `criteria`
  - first-time definition
  - household/income limits
  - purchase-price limits
  - credit requirements
  - occupancy
  - property type
  - new/existing construction
  - financing restrictions
  - lender participation
  - veteran/military conditions
  - profession conditions
  - graduate conditions
  - bankruptcy/foreclosure or liquid-asset limits only where actually relevant
- `terms`
  - repayment/forgiveness/deferment details
- `tradeoffs`
  - rate, payment, cash-to-close, recapture, resale, refinance, lien, long-term cost, or other material buyer considerations
- `rules[]` — deterministic screening rules
- `authoritative_sources[]`
- `last_verified_date`
- `last_materially_changed_date`
- `human_caveats[]`

### Authoritative source object

Each source should have:

- `source_id`
- `label`
- `url`
- `publisher/administrator`
- `document_title` when applicable
- `effective_date` when known
- `retrieved_date`
- optional source fingerprint/version note

Every eligibility rule must reference one or more `source_id` values.

## Deterministic rule contract

The evaluator receives only:

1. an approved canonical program version; and
2. a normalized household/property fact map created after screening opt-in.

It does **not** call an LLM to determine the result.

Each atomic rule should contain:

```json
{
  "rule_id": "income-limit",
  "fact_keys": ["household.size", "household.gross_income"],
  "operator": "lte_lookup",
  "comparison": {"table": "income_limits", "key_fact": "household.size"},
  "failure_effect": "not_match",
  "missing_effect": "info_missing",
  "external_dependency": false,
  "source_ids": ["source-1"],
  "buyer_reason_fail": "Published household income limit appears to be exceeded.",
  "buyer_reason_missing": "Household size and an approximate income band are needed to screen this limit."
}
```

The initial evaluator should deliberately support a **small, testable operator set** rather than arbitrary executable expressions:

- `equals`
- `not_equals`
- `in`
- `not_in`
- `gte`
- `lte`
- `between_inclusive`
- `present`
- `date_on_or_after`
- `date_on_or_before`
- `years_since_date_lte`
- `lte_lookup`
- `gte_lookup`
- `geography_in`

Adding a new operator requires tests and review.

## Classification precedence

For an `open` program:

1. If any known hard published requirement fails → **`not_match`**.
2. Else if any fact required to resolve a hard published requirement is missing → **`info_missing`**.
3. Else if all screenable hard requirements pass but one or more external dependencies remain (underwriting, lender participation, target-area verification, funding confirmation, administrator interpretation, etc.) → **`worth_checking`**.
4. Else if all screenable published requirements pass and no unresolved material dependency remains → **`likely`**.

Program availability is evaluated before household fit:

- `retired` or definitively `closed` → do not describe as currently available; engine records an availability reason.
- `paused`, `exhausted`, or `unknown` → preserve the program in the catalog but surface current availability uncertainty and generally prevent a plain `likely` presentation until availability is verified.

The buyer-facing explanation must make clear that `likely` is a screening result, not an underwriting or administrator determination.

## Machine-readable result contract

A current result should contain at least:

```json
{
  "program_id": "example",
  "program_version": "3",
  "classification": "worth_checking",
  "evaluated_at": "2026-09-01T00:00:00Z",
  "reasons": [
    {"rule_id": "county", "outcome": "pass", "fact_keys": ["target.county"]},
    {"rule_id": "lender-participation", "outcome": "external", "fact_keys": ["financing.lender_participates"]}
  ],
  "missing_fact_keys": [],
  "external_checks": ["financing.lender_participates"],
  "input_fingerprint": "sha256:..."
}
```

The result must retain the exact program version used so HBE can explain why a historical result was produced.

## Screening fact model

Facts are normalized keys, for example:

- `target.municipality`
- `target.county`
- `household.size`
- `household.gross_income_band`
- `household.primary_residence_owned_within_3_years`
- `buyer.veteran_status`
- `buyer.qualifying_profession`
- `buyer.graduation_date`
- `credit.score_band`
- `occupancy.intended`
- `property.type`
- `property.construction_type`
- `property.purchase_price_band`
- `financing.type`
- `financing.lender_selected`
- `financing.lender_participates`
- `property.census_tract`

Facts should record provenance such as:

- `buyer_experience`
- `eligibility_opt_in`
- `property_derived`
- `hbe_confirmed`
- `system`

A fact copied from existing Buyer Experience data should be shown to the buyer as already known/derived where appropriate, with an easy way to correct it.

## Opt-in lifecycle

### Browse mode

- No BIMatrix screening row is required.
- Do not create eligibility answers merely because the buyer opened the catalog.
- Show general program cards and the catalog's weekly review date.

### Screening mode

After explicit opt-in:

1. Create a `bimatrix_screenings` row for the household case.
2. Populate reusable facts from existing D1 household/buyer data.
3. Ask only unresolved facts that are actually relevant to one or more programs.
4. Recompute results deterministically when facts change.
5. Record an audit event for opt-in and material result recomputations using the existing household audit mechanism.

## D1 responsibilities

`schema-issue33.sql` should remain additive and should store only buyer/case-specific BIMatrix state:

- screening opt-in/state
- normalized screening facts
- current deterministic results
- HBE notes/dispositions

The migration must attach household-specific data to `buyer_cases(id)` and preserve cascade behavior.

## HBE notes and override semantics

HBE may need to record a judgment such as "call administrator before relying on this" or "buyer has a lender contact who may resolve this."

That is an **annotation/disposition**, not a mutation of canonical program rules.

Rules:

- HBE annotations live in D1.
- The engine's computed classification remains separately visible.
- A manual HBE disposition never edits `catalog/*.json`, never erases the engine result, and never becomes a published eligibility rule.
- If a manual finding reveals that the canonical program rule is wrong/stale, open a program-change review instead.

## Weekly update workflow

1. RokBot/research revisits authoritative sources.
2. Produce a change report for each program:
   - verified unchanged
   - material change
   - funding opened
   - funding closed/exhausted
   - program retired
   - new program
   - source unavailable/stale
3. Unchanged programs update the research evidence with minimal noise.
4. Material changes become a proposed catalog diff/PR or explicit review item.
5. Jeebs/HBE reviews.
6. Approved changes create a new canonical program version.
7. Only then may production use the new version.

## Testing contract

Before BuyerUI/HBEUI rollout, tests must cover at least:

- browse does not create screening data
- opt-in creates screening state
- known Buyer Experience facts are reused after opt-in
- buyer is not asked for already-known facts
- positive/`likely`
- external dependency/`worth_checking`
- hard exclusion/`not_match`
- missing fact/`info_missing`
- geography and target-area logic
- first-time/repeat-buyer logic
- stale/paused/exhausted program handling
- historical program version retained on results
- one household cannot read another household's facts/results
- HBE annotation does not change engine classification or canonical rule version
- all authenticated BIMatrix responses retain the platform security headers

## Phase 1 exit criteria

Phase 1 is complete when:

- this contract is reviewed;
- `schema-issue33.sql` is reviewed but **not yet applied to production**;
- the canonical program JSON schema/operator contract is fixed enough to research the seed programs consistently; and
- RokBot has a bounded research work item for the initial program set and five-county expansion.
