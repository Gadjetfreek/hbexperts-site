# HBE Buyer Platform Architecture

## Target model
One platform, many humans.

`/buyers/<buyer-id>/` should load a shared BuyerUI application and then load/decrypt that buyer's data. A buyer should not become a fork of the application.

## Proposed layers

### 1. Buyer data layer
Contains buyer-specific state only:
- stable buyer ID
- display name and login identity
- encrypted profile/discovery answers
- current stage and completed stages
- stage summaries and HBE status
- buyer WHY
- ideal-home sketch reference
- property/debrief records
- photo annotations and information requests
- communication preferences and links

This data must survive every UI deployment unchanged unless an intentional data migration is required.

### 2. Shared BuyerUI layer
Contains behavior and presentation shared by every buyer:
- authentication shell
- roadmap stage definitions
- trail geometry and checkpoint sketches
- locked/current/completed visual states
- hover expectation bubbles
- HBE activity/status bubble
- stage dialogs/pages
- texting/communication launcher
- release watcher
- accessibility/responsive behavior

### 3. Shared HBEUI layer
Contains advisor-facing workflow:
- Active Human Engagement dashboard
- New Form Submissions
- Active Consults
- Humans Hunting for Their Treasure
- Successful Hunts
- human profile/advisor roadmap
- consultation brief
- post-interaction capture
- task/status controls
- reversible breadcrumb navigation

HBE actions can produce buyer-facing status, but internal notes must not leak into BuyerUI.

### 4. Deployment/release layer
Owns:
- preview build per branch/PR
- production deploy from approved main
- release identifier
- cache invalidation
- active-session upgrade detection
- deployment verification
- rollback

## State contract
UI code reads buyer state; it does not redefine buyer state. Stage IDs must be stable. Human-readable labels may evolve without invalidating stored progress.

Recommended stable stage IDs:
`headquarters`, `buyerDiscovery`, `consultation`, `representation`, `search`, `market`, `possibilities`, `evaluation`, `offer`, `terms`, `negotiation`, `diligence`, `inspection`, `value`, `loan`, `commitment`, `closing`.

## Buyer safety rule
When code changes, the default behavior is preserve existing buyer state and render it with the newest compatible UI. If a release requires a state migration, it must be explicit, tested, reversible and documented.