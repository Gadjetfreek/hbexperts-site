# Public-site acquisition measurement

The public HBE site records a small set of first-party, coarse events so we can tell whether people are finding the informational pages and choosing to enter the Buyer Journey. Measurement is pathname- and channel-level only. It does not collect names, email addresses, phone numbers, Buyer Experience answers, household identifiers, or Buyer Journey portal behavior.

This document describes the public site only (`hbexperts.com`, Hugo theme `hbe`, GitHub Pages). The secure Buyer Journey at `buyer.hbexperts.com` is out of scope.

## Events

| Event | When it fires | Fields | Privacy notes |
| --- | --- | --- | --- |
| `discovery_view` | Once on `DOMContentLoaded` for each public page load | `event`, `page_path` (pathname only), `channel`, optional `utm_source` / `utm_medium` / `utm_campaign`, optional `referrer_host`, `ts` | No names, emails, phones, questionnaire fields, or full referrer URLs. UTM values are stored only if they look like short non-PII tokens (max 64 chars; email/phone/URL-like values are dropped). `utm_content` and `utm_term` may be read for channel classification but are not emitted. |
| `journey_entry_click` | Click on an anchor whose host is `buyer.hbexperts.com` | Same coarse fields as `discovery_view`, plus `dest_path` (destination pathname only) | Destination query strings are not recorded. The outbound URL may receive only `hbe_ch`, `hbe_lp`, and `hbe_ft` (coarse tokens / landing path). |
| `consultation_cta_click` | Click on a same-site anchor to `/strategy-session/` or `/contact/` | Same coarse fields as `journey_entry_click` | Internal consultation CTAs are not annotated with extra query params. `tel:` and `mailto:` links are ignored so phone numbers and addresses are never captured as destinations. |

Each event is also dispatched as a `CustomEvent` named `hbe:acquisition` on `document` (`event.detail` is the payload) and appended to an in-memory ring buffer `window.__HBE_ACQ_EVENTS__` (max 20) for local verification without a network sink.

First-touch coarse attribution is stored in `sessionStorage` key `hbe_acq_v1` for the browser session only. The module does not use `localStorage` and does not set tracking cookies.

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

## What is measurable automatically vs derived or manual

Automatically on the public site:

- Page views of public Hugo pages, with coarse channel and optional sanitized UTM tokens.
- Clicks from the public site into `buyer.hbexperts.com` (including header “Start Buyer Experience” and homepage “Explore the Buyer Journey”).
- Clicks to the public Strategy Session and Contact pages.

Optional, off by default:

- Cloudflare Web Analytics (free, aggregate, cookie-free). See below.

Coarse hosting logs:

- GitHub Pages may log standard server access data as part of hosting. Those logs are not this module and are not buyer-level analytics.

Out of scope / manual or secure-platform only:

- Qualified Buyer Journey completion, questionnaire answers, household identifiers, and portal behavior live on the secure platform and are **not** instrumented here.
- Spend, targets, campaign sequencing, and creative strategy are not part of this public measurement surface.
- No new paid analytics or SEO product is required for this module to work.

## How to enable optional Cloudflare Web Analytics

Cloudflare Web Analytics is $0 on Cloudflare accounts and is **off by default**. This PR does not hardcode a site token and CI/build needs no secrets.

To enable later:

1. In the Cloudflare dashboard, add a Web Analytics site and copy the site token.
2. Set the token in `hugo.toml`:

```toml
[params]
  # Optional. Cloudflare Web Analytics site token (free). Leave empty to keep first-party-only measurement.
  cloudflareWebAnalyticsToken = ""
```

3. Redeploy the public Hugo site. `themes/hbe/layouts/_default/baseof.html` injects the standard privacy-oriented CF beacon only when that param is non-empty.

If the token is empty, measurement stays first-party only (CustomEvent + sessionStorage + in-memory ring buffer). An optional runtime sink `window.__HBE_ACQ__.send(payload)` may be provided by tests or a future first-party collector; it is not required.

## Non-goals

- No buyer answers, names, emails, phones, or household IDs.
- No instrumentation of `buyer.hbexperts.com` portal pages from this public repo.
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

The deploy workflow also runs these tests and asserts that the homepage references both `/js/nav.js` and `/js/acquisition.js`.
