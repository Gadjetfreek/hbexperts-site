# Showing Card — R2 photo storage status

## Declared binding

`wrangler.toml` declares:

```toml
[[r2_buckets]]
binding = "SHOWING_PHOTOS"
bucket_name = "hbe-showing-photos"
```

## Blocker (2026-09-04)

Creating / listing the bucket via Wrangler failed in this environment:

- `CLOUDFLARE_API_TOKEN` is unset
- `CLOUDFLARE_ACCOUNT_ID` is unset
- `npx wrangler r2 bucket list` → non-interactive auth error requiring an API token

No production deploy or `wrangler login` was attempted (out of scope for this PR).

## Safe state

- Photo UI is present on the Showing Card (per-field + general).
- Upload/GET handlers require HBE auth + CSRF + property ownership checks.
- Without `env.SHOWING_PHOTOS`, uploads return **503** `R2_UNAVAILABLE` (fail closed).
- D1 stores metadata only (`showing_photos`); no public URL column; no GitHub/Pages media.

## Unblock steps (authorized operator)

1. Create private bucket: `npx wrangler r2 bucket create hbe-showing-photos`
2. Confirm account binding / deploy Worker with the existing `SHOWING_PHOTOS` binding.
3. Re-run showing-card photo tests with a mock or staging R2 binding.
