# ForgePT HBEUI / Buyer Portal Synthetic Staging

This staging slice implements the 2026-08-31 HBEUI + Buyer Portal product brief without touching production.

## What this is

A self-contained Cloudflare Worker prototype using only hard-coded synthetic household data (`Alex and Sam Rivera`). It demonstrates:

- split HBE Dashboard / Buyer Dashboard card;
- 18 stages, preserving `Get the Keys` and adding `After the Keys`;
- stage checklists;
- checklist-completion triggers that create synthetic Buyer/HBE follow-up actions;
- `What's next` seeded from the current/future checklist so it is never empty;
- large household story on both HBE and buyer surfaces;
- separate Alex / Shared / Sam portal modes;
- private co-buyer invite UX using `.test` email only;
- hover stage previews in Buyer Portal;
- useful Journey Compass content in place of an empty Box;
- HBE-aligned thank-you/privacy/next-steps page;
- pre-hire compensation ambiguity with negotiability language and post-hire arrangement examples;
- long-horizon 30/90/365-day and anniversary care.

## What is deliberately mocked

- No production or staging D1 is bound.
- No email is sent.
- No authentication database or invitation token is created.
- Checklist state and generated follow-ups use browser `localStorage` only.
- The preview can honor a Cloudflare Access authenticated-user header. If Access is unavailable, it can use a separately configured `STAGING_PREVIEW_TOKEN` Worker secret and sets a short-lived HttpOnly cookie after the initial credentialed request.

## Security / isolation

`forgept-demo-wrangler.toml` contains **no D1, KV, mail, queue, R2, or production route bindings**. It uses a separate Worker name and `workers_dev = true`.

Never add the live `BUYER_DB` binding to this config.

Never commit `STAGING_PREVIEW_TOKEN`.

No real buyer identity or questionnaire material belongs in this staging slice.

## Suggested deployment

From `secure-platform/staging/` using an authenticated Cloudflare CLI/session:

```text
wrangler secret put STAGING_PREVIEW_TOKEN --config forgept-demo-wrangler.toml
wrangler deploy --config forgept-demo-wrangler.toml
```

Prefer Cloudflare Access restricted to `cwhitehead@hbexperts.com` over the token fallback when possible.

## Explicitly not done

- No change to `buyer.hbexperts.com`.
- No production Worker deployment.
- No production D1 access.
- No P1.1/browser-history work.
- No Order #6 implementation.
- No MLS integration.
- No PAT creation.
- No merge to `main`.
