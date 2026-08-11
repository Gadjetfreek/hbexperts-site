# Forge Start Here — HBE Buyer Platform

## Mission
Build HBE's BuyerUI and HBEUI as one living buyer-engagement platform that can improve continuously without stranding active buyers on old revisions.

## Governing principle
Buyer data and buyer progress must persist independently of UI releases. The experience can evolve around the human without resetting the human.

## Required operating loop
1. Build on an `agent/*` branch.
2. Produce an interactive preview URL from that exact branch/commit.
3. Do not call anything "live" until the deployed URL is verified against the expected release/commit.
4. Human approval happens in preview.
5. Merge only after approval.
6. Production release automatically increments one release ID.
7. Shared BuyerUI assets use that release ID for cache invalidation.
8. Active BuyerUI sessions detect the new release and upgrade without manual cache clearing.
9. Rollback must be possible without changing buyer records.

## Platform boundaries
- **Buyer profile data:** identity, answers, preferences, WHY, progress, decisions, photos/notes, messages and stage state.
- **Shared BuyerUI:** roadmap rendering, checkpoint behavior, status bubbles, communication affordances, release logic, visual system.
- **Shared HBEUI:** human engagement dashboard, advisor roadmap, task/capture screens, navigation, buyer-facing status output.
- **Deployment layer:** preview, production, release manifest, verification and rollback.

Never solve a shared-platform problem by hard-coding another buyer-specific page unless the data itself is buyer-specific.

## Immediate implementation order
1. Establish dependable preview deployment.
2. Establish release-driven shared asset loading.
3. Refactor buyer pages toward one shared BuyerUI shell plus buyer configuration/data.
4. Add automated deployment verification.
5. Add rollback procedure.
6. Only then resume expansion of HBEUI and later buyer-process stages.

## Definition of done for a Forge change
A change is not done when code is committed or merged. It is done when:
- preview URL loads;
- intended buyer can authenticate;
- expected release/commit is visible or machine-verifiable;
- shared assets load without 404s;
- roadmap and interaction checks pass;
- approver has seen the preview;
- production deployment is verified after merge;
- active buyers can receive the release automatically.

Read the other files in this folder before implementation.