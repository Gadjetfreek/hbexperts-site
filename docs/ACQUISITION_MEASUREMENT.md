# Public-site acquisition measurement (privacy-safe)

The public HBE site records a small set of first-party, coarse events and posts allowlisted payloads to a first-party collector on `buyer.hbexperts.com`. Events are also mirrored locally via a `CustomEvent` named `hbe:acquisition`, first-touch in `sessionStorage`, and an in-memory ring buffer.

Events are pathname- and channel-level only. The collector persists **aggregate daily counts** (day + event + channel + sanitized campaign token + entry page). It does not collect names, email addresses, phone numbers, Buyer Experience answers, household identifiers, IP addresses, user agents, full referrers, or advertising/cross-site IDs.

Optional Cloudflare Web Analytics is a **separate pageview product**. It does not receive these custom events. It remains off by default.

Public site: `hbexperts.com` (Hugo theme `hbe`). Collector + secure milestones + protected report: `buyer.hbexperts.com` Worker (`BUYER_DB` D1). Outbound Buyer Journey links may append short non-PII tokens `hbe_ch`, `hbe_lp`, and optional `hbe_ft` for aggregate attribution only.

## Events

| Event | When it fires | Fields | Privacy notes |
| --- | --- | --- | --- |
| `discovery_view` | Once on `DOMContentLoaded` for each public page load | `event`, `page_path` (pathname only), `channel`, optional `utm_source` / `utm_medium` / `utm_campaign`, optional `referrer_host`, `ts` | No names, emails, phones, questionnaire fields, or full referrer URLs. UTM values are stored only if they look like short non-PII tokens (max 64 chars; email/phone/URL-like values are dropped). `utm_content` and `utm_term` may be read for channel classification but are not emitted. Posted to the first-party collector when available; also kept session/in-memory. |
| `journey_entry_click` | Click on an anchor whose host is `buyer.hbexperts.com` | Same coarse fields as `discovery_view`, plus `dest_path` (destination pathname only) | Destination query strings are not recorded. Outbound URL may receive sanitized `hbe_ch` / `hbe_lp` / optional `hbe_ft` only. |
| `consultation_cta_click` | Click on a same-site anchor to `/strategy-session/` or `/contact/` | Same coarse fields as `journey_entry_click` | Internal consultation CTAs are not annotated with extra query params. `tel:` and `mailto:` links are ignored so phone numbers and addresses are never captured as destinations. |

Each event is dispatched as a `CustomEvent` named `hbe:acquisition` on `document` (`event.detail` is the payload), appended to an in-memory ring buffer `window.__HBE_ACQ_EVENTS__` (max 20), and posted by `window.__HBE_ACQ__.send` to `POST https://buyer.hbexperts.com/api/acquisition/collect` (CORS; allowlisted fields only).

First-touch coarse attribution is stored in `sessionStorage` key `hbe_acq_v1` for the browser session only. The public module does not use `localStorage` and does not set tracking cookies on `hbexperts.com`.

### Secure milestones (aggregate only)

| Event | When | Stored dimensions |
| --- | --- | --- |
| `journey_start` | GET `/` on `buyer.hbexperts.com` | channel / entry page / campaign from `hbe_ch` / `hbe_lp` / `hbe_ft` (else direct) |
| `experience_complete` | Successful `POST /api/intake` | same coarse dims from short-lived `hbe_acq` cookie set at journey start |

### Protected report

HBE-authorized aggregate view at `/hbe/acquisition` (HTML) and `/api/hbe/acquisition` (JSON). Requires existing Access / `isHbe` boundary. No buyer or household rows.

## Channel classification

`channel` is one of: `paid` | `referral` | `local` | `relocation` | `organic` | `direct` | `unknown`.

Rules, in order:

1. **relocation** — `utm_campaign` or `utm_content` contains the token `relocation` (split on non-alphanumeric characters). Never inferred from geography, copy, or referrer.
2. **local** — the same fields contain the token `local`. `allocate` / `locale` do not match. Never inferred from IP or location.
3. **paid** — `utm_medium` is one of `cpc`, `ppc`, `paid`, `paid_social`, `paid-social`, `display`, `ads` (and close variants), **or** `utm_source` looks like an ad platform (`googleads`, `fb`, `meta`, `bing`, and close variants).
4. **organic** — the external referrer host is a known search engine, **or** `utm_medium=organic`.
5. **referral** — there is an external referrer host that is not a search engine.
6. **direct** — no surviving UTM tokens and no external referrer.
7. **unknown** — fallback (for example `utm_medium=email` with no other signal).

Same-site referrers (`hbexperts.com` / `www.hbexperts.com`) are ignored. They are not treated as referrals, and they do not overwrite first-touch. On later public pages in the same session, a direct/empty signal reuses the first-touch channel so internal navigation does not look like a new direct visit.

`document.referrer` is reduced to hostname only before storage or emission. Paths and query strings (which might contain search terms or other leakage) are discarded.

## What is instrumented automatically vs derived or manual

Automatically on the public site (and collected server-side as aggregates):

- Page views of public Hugo pages, with coarse channel and optional sanitized UTM tokens.
- Clicks from the public site into `buyer.hbexperts.com` (including homepage “Explore the Buyer Journey”). Those clicks fire events and may append `hbe_ch` / `hbe_lp` / `hbe_ft`.
- Clicks to the public Strategy Session and Contact pages.

Optional, off by default, and **not** a consumer of these custom events:

- Cloudflare Web Analytics (free, aggregate, cookie-free pageviews). See below.

Coarse hosting logs:

- GitHub Pages may log standard server access data as part of hosting. Those logs are not this module and are not buyer-level analytics.

Out of scope:

- Questionnaire answers, household identifiers, and BuyerUI/HBEUI portal contents are **not** part of acquisition analytics.
- Spend, targets, campaign sequencing, and creative strategy are not documented in this public repo.
- No new paid analytics or SEO product is required.

## How to enable optional Cloudflare Web Analytics

Cloudflare Web Analytics is $0 on Cloudflare accounts and is **off by default**. It is a separate aggregate **pageview** product. It does not receive `hbe:acquisition` custom events, the ring buffer, or sessionStorage first-touch. This PR does not hardcode a site token and CI/build needs no secrets.

To enable later:

1. In the Cloudflare dashboard, add a Web Analytics site and copy the site token.
2. Set the token in `hugo.toml`:

```toml
[params]
  # Optional. Cloudflare Web Analytics site token (free). Leave empty to keep first-party-only instrumentation.
  cloudflareWebAnalyticsToken = ""
```

3. Redeploy the public Hugo site. `themes/hbe/layouts/_default/baseof.html` injects the standard privacy-oriented CF beacon only when that param is non-empty.

If the token is empty, no CF beacon is loaded. Public-site custom events remain session/in-memory only.

## Non-goals

- No buyer answers, names, emails, phones, or household IDs in acquisition analytics.
- No weakening of HBEUI/BuyerUI auth, Cloudflare Access, D1 household isolation, or `no-store` / `noindex` on secure surfaces.
- No new paid analytics, tag manager, or SEO product.
- No advertising, remarketing, or cross-site targeting pixels.
- No campaign spend, targeting, or sequencing documentation in this public repo.

## Deploy notes (CONFIG REQUIRED)

1. Apply D1 migration: `secure-platform/migrations/acquisition-aggregate.sql` to `BUYER_DB` / `hbe-buyer-journey-v2` (remote before production traffic).
2. Deploy the Worker (`secure-platform` / `hbe-buyer-platform`) so `/api/acquisition/collect`, `/hbe/acquisition`, and milestones are live.
3. CORS allowlist is fixed in code: `https://hbexperts.com`, `https://www.hbexperts.com`, and same-origin buyer host. No extra env var required for origins.
4. Redeploy/publish the public Hugo site so `acquisition.js` posts to the collector and annotates journey URLs.

## Tests

From the repository root:

```bash
node --test themes/hbe/static/js/acquisition.test.mjs
node --test secure-platform/tests/acquisition-collector.test.mjs
```
