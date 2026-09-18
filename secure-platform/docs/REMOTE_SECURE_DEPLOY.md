# Remote secure Worker deploy (GitHub Actions)

Manual production path for the HBE Buyer Platform Worker (`buyer.hbexperts.com`).
Triggered only by `workflow_dispatch` on branch `main` via `.github/workflows/deploy-secure-worker.yml`.
Reuses the guarded `secure-platform/deploy.ps1` (existing D1 only, `keep_vars=true`, dry-run then deploy).

## Acceptance gates (Sentinel)

### 1. Pinned production toolchain

- GitHub Actions use **immutable commit SHAs** for `actions/checkout` and `actions/setup-node` (not floating `@v4`).
- Wrangler is an **explicit version** (`4.134.0` at time of pin), set as `WRANGLER_VERSION` in the workflow and honored by `deploy.ps1` (`$WranglerPkg = wrangler@$WranglerVersion`). No `wrangler@latest`.

Bump pins only deliberately, after a dry-run on a non-production path if available.

### 2. Explicit production approval gate

YAML `environment: hbe-secure-production` alone does **not** enforce human approval.

**Required configuration (repo admin):**

1. GitHub → Settings → Environments → **`hbe-secure-production`** (create if missing).
2. Enable **Required reviewers** and add at least one human reviewer (Christopher / designated owner).
3. Store `CLOUDFLARE_API_TOKEN` as an **Environment secret** on `hbe-secure-production` (not a broad repo secret if avoidable).
4. Keep the workflow `if: github.ref == 'refs/heads/main'` so non-main refs cannot deploy.

Until Required reviewers are configured in the UI, do not treat a green workflow run as an approved production release.

### 3. Least-privilege Cloudflare API token

`CLOUDFLARE_API_TOKEN` is an **acceptance requirement**, not optional guidance.

- Limit the token to the **HBE Cloudflare account / `hbexperts.com` zone** only.
- Grant only permissions needed by existing `deploy.ps1`:
  - locate the existing D1 database `hbe-buyer-journey-v2` (`d1 list`)
  - execute **additive** D1 schema files against that database
  - deploy/update the existing Worker `hbe-buyer-platform` and its required route/bindings (`keep_vars=true` preserves dashboard Access vars)
  - any **R2 metadata** access Wrangler requires for declared bindings (no broad account wipe rights)
- **No** global/account-admin / user-admin token.
- **Never** commit the token. Rotate if exposed.

## Operator runbook

1. Confirm Environment protections above are active.
2. On `main`, Actions → **Deploy Secure HBE Buyer Platform** → Run workflow.
3. Approve the Environment gate when prompted.
4. Confirm `/health` on `https://buyer.hbexperts.com` in the job summary / post-deploy checks.

No live deploy is performed by opening or merging documentation PRs; only the manual workflow on `main` after approval deploys.
