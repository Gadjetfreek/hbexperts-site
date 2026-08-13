# HBE Buyer Platform — Hosting Contract (Phase 0)

This document records observed repository/deployment facts. Unknowns are labeled as unknown instead of guessed.

## Confirmed repository facts

- Repository: `Gadjetfreek/hbexperts-site`
- Visibility: public
- Default branch: `main`
- Static-site generator: Hugo
- Hugo version used for deployment: `0.147.8` extended
- Hugo configuration file: `hugo.toml`
- Hugo theme: `hbe`

## Confirmed production deployment mechanism

Production is deployed by GitHub Actions, not by publishing a branch directly.

Workflow file: `.github/workflows/deploy.yml`
Workflow name: `Deploy Hugo to GitHub Pages`

Trigger:
- push to `main`
- manual `workflow_dispatch`

The workflow does NOT trigger on pull requests or `agent/*` branch pushes.

Deployment sequence:
1. checkout repository
2. install Hugo Extended 0.147.8
3. call `actions/configure-pages@v5`
4. run Hugo with `--gc --minify`
5. override Hugo base URL with `${{ steps.pages.outputs.base_url }}/`
6. upload `./public` with `actions/upload-pages-artifact@v3`
7. deploy that artifact with `actions/deploy-pages@v4`
8. publish into the `github-pages` environment

Therefore a commit existing on `main` does not itself prove that it is live. The GitHub Pages deployment must complete successfully.

## Confirmed publish-path behavior

Hugo generates the deployable site into `./public` during the Actions run. `public/` is build output and is not tracked in the repository.

Files under repository `static/` are Hugo static assets. Hugo copies them into the root of generated `public/`.

Example:
- source: `static/buyers/donald-kelley/index.html`
- deployed path: `/buyers/donald-kelley/`

This explains why a file created under `static/` can appear at a URL without `/static/` after a successful Hugo deployment.

## Confirmed URL/baseURL behavior

`hugo.toml` contains:

`baseURL = "https://hbexperts.com/"`

However the production Actions workflow explicitly overrides that value during deployment with the Pages-provided base URL:

`--baseURL "${{ steps.pages.outputs.base_url }}/"`

Therefore repository `hugo.toml` alone does not determine the deployed production URL. GitHub Pages configuration determines the runtime base URL used by the production build.

## Confirmed preview facts

There is currently no repository-native PR preview pipeline.

The production workflow only builds/deploys `main`. A page added only to an unmerged `agent/*` branch cannot appear on the production GitHub Pages site.

There is no `gh-pages` branch in the repository.

The failed Donald preview attempt was therefore structurally expected: the preview code existed on an unmerged branch, while the only deployed artifact came from `main`.

A later `preview.html` harness was committed to `main`, but that still depends on the normal production deployment completing before its URL can exist. It is not a true branch preview system.

## CI/CD and external host findings

Confirmed:
- `.github/workflows/deploy.yml` is an active deployment definition in the repository.
- no `netlify.toml` exists at repository root.
- no tracked `public/` output exists.

Not yet proven from available repository evidence:
- whether any external service (Netlify, Vercel, Cloudflare Pages, etc.) is connected out-of-band through provider dashboards
- whether GitHub Pages has a custom domain configured in repository Settings
- current DNS records for `hbexperts.com`

No root `CNAME` file or `static/CNAME` file was found in the repository. That means a custom domain, if configured, is not currently represented by a tracked CNAME file in this repo.

## Why recent preview/release attempts behaved inconsistently

1. We treated branch code as though GitHub Pages could serve it. It cannot with the current workflow.
2. We treated merge completion as deploy completion. The workflow is asynchronous after the merge/push.
3. Our first live-release watcher updated the page URL but shared CSS/JS still contained hard-coded old version query strings.
4. A release manifest change only helps a browser after both the manifest and release-driven asset-loading code have themselves been successfully deployed.

These were pipeline-contract problems, not only BuyerUI visual-code problems.

## Proposed Phase 1 direction (proposal only — not implemented in Phase 0)

The simplest architecture consistent with the current repository is to add a second GitHub Actions workflow dedicated to previews.

Recommended characteristics:
- trigger on pull requests affecting BuyerUI/HBEUI/site files
- build Hugo from the exact PR commit
- stamp the build with commit SHA and PR number
- deploy preview independently from production
- return a stable discoverable preview URL to the PR
- run HTTP/smoke verification before calling preview ready
- never mutate the `github-pages` production environment

A provider or deployment strategy must be selected before implementation. GitHub Pages itself is designed around one Pages site/environment per repository and is not a convenient native per-PR hosting surface. A separate preview host/service or an isolated preview publishing strategy is therefore preferable.

## Phase 1 acceptance test to implement next

For Donald's pending BuyerUI status-bubble revision:
1. push/update the preview branch
2. preview workflow builds that exact SHA
3. preview deployment succeeds
4. preview page displays its commit SHA visibly or in machine-readable metadata
5. Donald exercise credentials work
6. proposed Headquarters status bubble and `YOUR WHY` destination are visible
7. production Donald BuyerUI remains unchanged
8. Chris approves the interactive preview
9. only then merge/release to production

## Phase 0 conclusion

The current production contract is now understood well enough to stop guessing:

`push to main -> deploy.yml -> Hugo build -> ./public artifact -> GitHub Pages environment -> production URL`

The missing capability is not another cache workaround. It is a real branch/PR preview deployment path plus explicit deployment verification.