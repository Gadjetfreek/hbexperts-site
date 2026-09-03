# Public-site acquisition instrumentation foundation

This is a **client-side instrumentation foundation**, not completed acquisition measurement. The public HBE site records a small set of first-party, coarse events in the browser so a later gated collector can subscribe. Until that collector exists, events are **session/in-memory only**: a `CustomEvent` named `hbe:acquisition`, first-touch in `sessionStorage`, and an in-memory ring buffer. Nothing in this module sends those custom events to a network analytics product.

Events are pathname- and channel-level only. The foundation does not collect names, email addresses, phone numbers, Buyer Experience answers, household identifiers, or Buyer Journey portal behavior.

Optional Cloudflare Web Analytics is a **separate pageview product**. It does not receive these custom events. It remains off by default.

This document describes the public site only (`hbexperts.com`, Hugo theme `hbe`, GitHub Pages). The secure Buyer Journey at `buyer.hbexperts.com` is out of scope. Outbound links to that host are left clean: this module does **not** append `hbe_ch`, `hbe_lp`, or `hbe_ft` (or any other acquisition query params) until a secure-side consumer exists.

## Events

| Event | When it fires | Fields | Privacy notes |
| --- | --- | --- | --- |
| `discovery_view` | Once on `DOMContentLoaded` for each public page load | `event`, `page_path` (pathname only), `channel`, optional `utm_source` / `utm_medium` / `utm_campaign`, optional `referrer_host`, `ts` | No names, emails, phones, questionnaire fields, or full referrer URLs. UTM values are stored only if they look like short non-PII tokens (max 64 chars; email/phone/URL-like values are dropped). `utm_content` and `utm_term` may be read for channel classification but are not emitted. Session/in-memory only until a later gated collector exists. |
| `journey_entry_click` | Click on an anchor whose host is `buyer.hbexperts.com` | Same coarse fields as `discovery_view`, plus `dest_path` (destination pathname only) | Destination query strings are not recorded. The outbound URL is **not** mutated: no `hbe_ch`, `hbe_lp`, or `hbe_ft` (or other acquisition params) are appended. |
| `consultation_cta_click` | Click on a same-site anchor to `/strategy-session/` or `/contact/` | Same coarse fields as `journey_entry_click` | Internal consultation CTAs are not annotated with extra query params. `tel:` and `mailto:` links are ignored so phone numbers and addresses are never captured as destinations. |

Each event is dispatched as a `CustomEvent` named `hbe:acquisition` on `document` (`event.detail` is the payload) and appended to an in-memory ring buffer `window.__HBE_ACQ_EVENTS__` (max 20). That is local verification, not a shipped collector.

First-touch coarse attribution is stored in `sessionStorage` key `hbe_acq_v1` for the browser session only. The module does not use `localStorage` and does not set tracking cookies.

An optional runtime sink `window.__HBE_ACQ__.send(payload)` may be provided by tests or a **later gated collector**; it is not wired to any network destination in this PR.

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

Automatically on the public site (session/in-memory only until a later gated collector exists):

- Page views of public Hugo pages, with coarse channel and optional sanitized UTM tokens.
- Clicks from the public site into `buyer.hbexperts.com` (including header “Start Buyer Experience” and homepage “Explore the Buyer Journey”). Those clicks fire events; they do **not** rewrite the destination URL.
- Clicks to the public Strategy Session and Contact pages.

Optional, off by default, and **not** a consumer of these custom events:

- Cloudflare Web Analytics (free, aggregate, cookie-free pageviews). See below.

Coarse hosting logs:

- GitHub Pages may log standard server access data as part of hosting. Those logs are not this module and are not buyer-level analytics.

Out of scope / manual or secure-platform only:

- Qualified Buyer Journey completion, questionnaire answers, household identifiers, and portal behavior live on the secure platform and are **not** instrumented here.
- Spend, targets, campaign sequencing, and creative strategy are not part of this public instrumentation surface.
- No new paid analytics or SEO product is required for this foundation.
- A gated first-party collector that actually stores or forwards these events is a later step, not this PR.

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

- This is not completed acquisition measurement; it is an instrumentation foundation.
- No buyer answers, names, emails, phones, or household IDs.
- No instrumentation of `buyer.hbexperts.com` portal pages from this public repo.
- No appending of `hbe_ch` / `hbe_lp` / `hbe_ft` (or similar) onto Buyer Journey URLs.
- No D1, HBEUI/BuyerUI auth, Cloudflare Access, MLS, or sensitive-upload changes.
- No weakening of `no-store` / `noindex` on secure surfaces.
- No new paid analytics, tag manager, or SEO product.
- No advertising, remarketing, or cross-site targeting pixels.
- No campaign spend, targeting, or sequencing documentation in this public repo.

## Tests

From the repository root:

```bash
node --test themes/hbe/static/js/acquisition.test.mjs
```

The current GitHub Pages deploy workflow requires `/js/nav.js` on the homepage and allows additional public scripts, so `acquisition.js` can ship without a workflow change. A follow-up that has `workflow` scope can also run `node --test` in CI and require `/js/acquisition.js`.
