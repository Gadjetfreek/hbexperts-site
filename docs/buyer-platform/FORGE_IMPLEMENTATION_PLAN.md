# Forge Implementation Plan

## Mission
Make HBE BuyerUI/HBEUI safe and fast to evolve while humans are actively using it.

Do not expand HBEUI feature depth until Phase 1 is working. BuyerUI platform reliability is the gate.

## Phase 0 - Discover the actual hosting contract
Before writing deployment code, determine and record:
- repository default branch
- GitHub Pages source/configuration, if Pages is the production host
- whether Pages is branch-based or Actions-based
- actual production publish path (`static/`, root, generated output, etc.)
- DNS/custom-domain behavior if any
- existing CI/CD hooks outside `.github/workflows`
- whether a preview host/service already exists

Deliverable: `docs/buyer-platform/HOSTING.md` with facts, not assumptions.

## Phase 1 - Reliable preview pipeline
Build a preview system that produces a verified browser URL from a PR/branch.

Acceptance:
- change shared BuyerUI CSS on a branch
- preview deploy starts automatically or through one documented command/action
- preview URL is discoverable
- HTTP verification passes
- page exposes commit SHA
- production remains unchanged
- Chris can open and interact with Donald exercise preview

Only after this passes should proposed visual changes use preview approval.

## Phase 2 - One release source of truth
Replace scattered manual asset versions with one generated release ID.

Acceptance:
- HTML/shared assets derive cache version from same release
- release manifest is generated/updated as part of production publish
- no developer has to remember to edit `?v=` values
- an active exercise session detects a new release and loads new CSS/JS without manual cache clearing

## Phase 3 - Shared BuyerUI template
Refactor buyer pages so buyer-specific files contain data/config, not copied application markup/logic.

Target conceptual structure:
```
static/
  buyer-portal/
    app/
      index.html
      buyerui.js
      buyerui.css
      roadmap.js
      checkpoint-sketches.js
      communications.js
      release.js
    buyers/
      <buyer-id>/
        profile.enc.json
        public-config.json
```
Exact paths may differ after repo inspection.

Acceptance:
- Donald and a second fixture buyer use the same app code
- changing one shared component changes both previews
- buyer-specific state stays isolated
- stable stage IDs preserve progress

## Phase 4 - Deployment verification and rollback
Automate smoke tests after preview and production deploy.

Acceptance:
- failed verification prevents a LIVE claim
- release/commit can be read from deployed page
- previous known-good UI release can be restored without touching buyer data

## Phase 5 - HBEUI foundation
Then implement the advisor hierarchy:
`Active Human Engagement -> Engagement Group -> Human -> Advisor Roadmap -> Task`

Groups:
1. New Form Submissions
2. Active Consults
3. Humans Hunting for Their Treasure
4. Successful Hunts

Every deeper screen gets reversible breadcrumbs/back navigation. HBE internal state and buyer-visible status are separate fields.

## Phase 6 - Interaction synchronization
Wire HBE actions to BuyerUI progression deliberately:
- form submitted -> HBE new submission
- HBE reviews -> buyer-facing status
- consultation completed/captured -> next buyer stop becomes available
- Hire HBE/agency agreement -> represented/search workflow
- showing/property evaluation -> post-appointment debrief
- later checkpoints follow the same event/state pattern

## Non-negotiable Forge rules
- Never use production as a preview surface when a preview pipeline exists.
- Never call a merge 'live'. Verify deployment.
- Never require buyers to clear cache as the normal upgrade mechanism.
- Never fork shared application code for a new buyer.
- Never overwrite buyer state merely to deploy UI.
- Never expose internal HBE notes in buyer-visible payloads.
- Prefer simple, reversible changes while the system is still being learned.
- Preserve the buyer-first design principle: technology should improve understanding and decision quality, not pressure movement through stages.

## Immediate next action
Implement Phase 0 only. Report the actual hosting/deployment facts and proposed preview implementation before changing production infrastructure.