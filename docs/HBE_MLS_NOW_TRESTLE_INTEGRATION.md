# HBE MLS Now / Trestle Integration Plan

## Purpose

Connect Stage 4 — Build Your Home Search — to licensed MLS Now listing data without turning MLS filters into the buyer's decision model.

## Product rule

The household search profile has two layers:

1. **Meaning layer** — hard constraints, preferences, tradeoffs, and context. This helps HBE and the buyer reason about the choice.
2. **Objective MLS layer** — price, geography, property type, bedrooms, bathrooms, living area, lot size, garage, and year built. Only these objective fields compile into automated listing queries.

Matching an MLS query is not an HBE recommendation.

## Expected license path

MLS Now currently offers IDX and VOW licenses through its WebAPI/Trestle path.

For HBE's authenticated Buyer Portal, the expected fit is **VOW** because the listing experience is intended for registered buyers in a broker-consumer relationship rather than public anonymous display.

Do not activate listing queries until MLS Now/Trestle has approved the actual use case and feed license.

## Provider boundary

The application talks to MLS data only through:

`secure-platform/src/mls-adapter.js`

That isolates vendor/provider specifics from Stage 4 business logic. If MLS Now or Trestle changes authentication, endpoint, or field mappings, update the adapter without rewriting Buyer Journey logic.

## Secrets

Never commit feed credentials to GitHub.

Expected Worker secrets after approval:

- `MLS_CLIENT_ID`
- `MLS_CLIENT_SECRET`

Non-secret configuration:

- `MLS_FEED_MODE=VOW`
- `MLS_API_BASE` (override only if approved Trestle environment requires it)

## Activation checklist

1. Confirm HomeBuyer Experts / Christopher Whitehead MLS Now participant status and the appropriate agreement path.
2. Submit the technology-provider / software request through Trestle for the approved VOW use case.
3. Review and approve the broker agreement sent through Trestle/AuthentiSign.
4. Wait for MLS Now final approval.
5. Obtain provider credentials and authoritative endpoint/field documentation.
6. Verify the adapter field map against the approved RESO metadata before production queries.
7. Store credentials only as encrypted Cloudflare Worker secrets.
8. Run a bounded HBE-only test query.
9. Verify required listing-firm attribution and any VOW-specific disclosure/display rules.
10. Run Sentinel privacy/Fair Housing/license review before buyer-visible MLS results are enabled.

## Data handling

- Current Stage 4 does not persist listing payloads in D1.
- It persists only search-run audit metadata: profile version, provider, feed mode, objective query, result count, status, and error text.
- If we later cache or persist MLS listing content, implement retention/deletion rules only after confirming the approved license permits it.
- Confidential MLS fields must never be requested for buyer display.

## Fair Housing / steering guardrail

Automated filters should remain objective and buyer-selected. Do not create automated filters based on protected-class characteristics or proxies for protected classes. Subjective lifestyle meaning should stay in the decision-support layer and be discussed without steering buyers toward or away from protected populations or neighborhoods.
