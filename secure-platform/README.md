# HBE Secure Buyer Platform — Fresh Buyer Beta v2

This is a clean replacement for the old Donald-specific prototype. It contains no buyer data, no Donald routes, and no browser-local journey truth.

## Experience contract

1. A new buyer opens the root link without logging in.
2. The entire HomeBuyer Roadmap is visible immediately.
3. Every roadmap stage is clickable and opens a bullet-point explanation of what happens there.
4. The only meaningful action available before submission is **Start the Buyer Experience**.
5. While the buyer completes the questionnaire, answers are held only in `sessionStorage` on that browser so Back/Refresh will not erase the draft.
6. Nothing in that draft is stored by HBE until the buyer explicitly presses **Submit to HBE**.
7. Submission creates the buyer's central D1 record, records an unread HBEUI notification, creates the buyer's first per-device session, and presents a strong cross-device access code.
8. Buyer Experience becomes complete and Consultation becomes current.
9. Phone, tablet, and desktop can each have their own active session and all read the same D1 journey state.
10. HBEUI reads and updates that same central record.

## Submission alert

Every successful submission creates an unread `buyer_experience_submitted` notification in the protected HBEUI. The alert contains identity and timestamp; questionnaire answers remain inside HBEUI and are not copied into notification payloads beyond basic identity.

Optional email alert: after `hbexperts.com` is onboarded/verified for Cloudflare Email Service, uncomment the `HBE_ALERT` `send_email` binding in `wrangler.toml`. The Worker is already written to send Christopher a short alert without embedding questionnaire answers in the email.

## Device/session model

Buyer sessions are now one-per-device rather than one token stored on the buyer record.

- Normal session: up to 12 hours, browser cookie only.
- **Remember this device**: persistent cookie + server session for up to 30 days.
- Logging in on a phone does not invalidate desktop or iPad sessions.
- Session tokens are random and only SHA-256 hashes are stored in D1.
- Cross-device access codes are high-entropy 16-character codes formatted as `XXXX-XXXX-XXXX-XXXX`; only a hash is stored.
- Buyer login attempts are rate-limited to 6/minute per submitted email key.
- New submissions are rate-limited to 3/minute per email key.

## Sensitive-data step-up

The ordinary BuyerUI may remain remembered, but contracts, financial documents, identity documents, and similarly sensitive uploads must live behind `/sensitive*`.

Before enabling any sensitive upload feature:

1. Protect `/sensitive*` with a Cloudflare Access self-hosted application using One-Time PIN as an authentication method.
2. Configure the Access policy so a visitor must complete email OTP authentication.
3. The Worker independently compares `Cf-Access-Authenticated-User-Email` with the email on the active buyer session. A successful OTP for a different email is rejected.
4. Keep the normal BuyerUI session requirement as well. This means the protected area requires both possession of the buyer session and fresh control of the buyer's email identity.
5. Do not enable contract/financial uploads until this route is tested on desktop, phone, and iPad.

Cloudflare OTP codes are single-use and expire after 10 minutes. A remembered BuyerUI session never bypasses this sensitive-route check.

## Security boundary

- Buyer journey truth and submitted buyer data live in D1, not GitHub and not `localStorage`.
- Pre-submit questionnaire drafts use browser `sessionStorage` only and disappear when the browser session is closed; the draft is removed after successful submission.
- Buyer cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- All application responses use `no-store`, `noindex`, `X-Frame-Options: DENY`, a restrictive Content Security Policy, and no-referrer policy.
- HBE routes require Cloudflare Access identity matching `cwhitehead@hbexperts.com`.
- Apply HBE Access protection to `/hbe*` and `/api/hbe/*`.
- No sensitive document upload is enabled in this beta.

## Deploy

From `secure-platform`:

```powershell
npx wrangler d1 create hbe-buyer-journey
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_AFTER_D1_CREATE`.

Then:

```powershell
npx wrangler d1 execute hbe-buyer-journey --remote --file=schema.sql
npx wrangler deploy
```

Open `/health` first and confirm `{"ok":true,...}`.

## Access configuration before external beta

Create Cloudflare Access protection for:

- `<worker-host>/hbe*`
- `<worker-host>/api/hbe/*`

Allow only Christopher's HBE identity (`cwhitehead@hbexperts.com`).

For `/sensitive*`, create the separate OTP step-up application described above. The route remains intentionally unusable for document uploads until that configuration is tested.

Buyer-facing `/`, `/questionnaire`, `/api/intake`, `/login`, `/api/login`, and `/buyer` remain outside HBE Access.

## Three-device acceptance test

1. Desktop/private browser: open `/`.
2. Confirm the full roadmap is visible and every stage opens its bullet-point popup.
3. Confirm only Buyer Experience has a start action.
4. Start the questionnaire, type several answers, use Back and Refresh, and confirm the local draft survives.
5. Before submission, open HBEUI and confirm no buyer record exists from that draft.
6. Press **Submit to HBE**.
7. Confirm an unread HBEUI submission alert appears and Buyer Experience becomes complete / Consultation current.
8. Record the cross-device access code.
9. Phone: use email + code; choose Remember this device; confirm same journey state.
10. iPad: repeat; confirm all three sessions remain active simultaneously.
11. HBE computer: change the buyer stage to Hire HBE / representation.
12. Refresh all three BuyerUIs and confirm they agree.
13. Confirm the protected-documents link does not expose sensitive content without Cloudflare Access OTP using the buyer's email.
14. Only after all checks pass should the beta link be sent externally.
