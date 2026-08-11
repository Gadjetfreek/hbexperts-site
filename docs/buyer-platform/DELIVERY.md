# Buyer Platform Delivery Contract

## Environments

### Preview
Every proposed UI change must have a browser-usable preview before production merge.

Required properties:
- built from the exact branch/commit under review
- URL is deterministic and reported by CI/deployment tooling
- visibly marked PREVIEW / NOT LIVE
- loads buyer fixture/test data, never a real buyer secret by default
- displays commit SHA or release ID somewhere unobtrusive for verification
- can exercise authentication, roadmap interactions, hover states and responsive behavior

Do not tell a reviewer a preview is ready until the preview URL returns successfully.

### Production
Production deploys only from approved `main`.

A merge is not a deployment. A deployment is not complete until the public production URL is verified to serve the expected release.

## Required publish sequence
1. Build/test branch.
2. Deploy preview.
3. Verify preview URL and expected commit.
4. Human approval.
5. Merge to `main`.
6. Generate/increment release ID automatically.
7. Deploy production.
8. Verify production URL reports expected release.
9. Only then report LIVE.

## Release/version rule
There must be one source of truth for the BuyerUI release ID. Shared CSS/JS asset URLs derive from that ID automatically. Do not manually maintain independent cache-buster strings.

## Active buyer upgrade rule
An already-open BuyerUI periodically checks the production release manifest and also checks on focus/visibility return. When a compatible newer release exists, it reloads using that release ID. Buyer state remains independent of UI release.

## Rollback
Keep the last known-good production artifact/release addressable. Rollback changes the active production release to that artifact; it must not roll back buyer data.

## Deployment verification
Minimum verification:
- URL returns 200
- page identifies expected release/commit
- shared CSS and JS return successfully
- exercise buyer can authenticate
- encrypted profile loads
- roadmap renders
- hover bubbles work for available and locked stops
- current/completed/locked states are distinguishable
- communication launcher resolves correctly
- no critical console/load errors

## Preview infrastructure decision
Forge must first inspect the repository/hosting configuration and choose an implementation that can actually produce branch/PR preview URLs. Candidate approaches include a GitHub Actions preview deployment, a dedicated preview host, or another static hosting provider with preview deployments. Do not assume GitHub Pages publishes arbitrary branches or newly committed files until the repository's Pages source/deployment configuration is confirmed.