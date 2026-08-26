# HBE Secure Buyer Platform — Fresh Buyer Beta

This is a clean replacement for the old Donald-specific prototype. It intentionally contains no buyer data, no Donald routes, and no browser-local journey truth.

## What this slice does

1. A new buyer opens the root link without logging in.
2. The only buyer action available is **Start the Buyer Experience**.
3. Starting the questionnaire asks identity/contact questions and buyer-experience questions.
4. On submit, the Worker creates a brand-new buyer record in Cloudflare D1.
5. The buyer receives a six-digit access code and an authenticated browser cookie.
6. The BuyerUI shows Buyer Experience complete and Consultation current.
7. On another phone/tablet/computer, the buyer uses email + the six-digit code to open the same centrally stored journey.
8. HBEUI reads the same D1 record. When HBE changes the current stage, the buyer sees the same stage on their next page load on any device.

## Security boundary

- Buyer data lives in D1, not GitHub and not localStorage.
- Buyer session token is random, stored only as a SHA-256 hash in D1, and delivered in an HttpOnly/Secure/SameSite cookie.
- Cross-device access uses email + six-digit code; only a hash of the code is stored.
- All responses are `no-store` and `noindex`.
- HBE routes require Cloudflare Access to provide `Cf-Access-Authenticated-User-Email`, matching `HBE_ADMIN_EMAIL`.
- Apply Cloudflare Access protection to both `/hbe*` and `/api/hbe/*`.

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

Wrangler will print the Worker URL. Open `/health` first and confirm it returns JSON with `ok: true`.

For the evening beta, the Worker URL itself can be used immediately. A custom hostname such as `buyer.hbexperts.com` can be attached afterward without changing the buyer records.

## Cloudflare Access for HBEUI

Create Access protection for:

- `<worker-host>/hbe*`
- `<worker-host>/api/hbe/*`

Allow Christopher's HBE identity (`cwhitehead@hbexperts.com`). The buyer-facing `/`, `/questionnaire`, `/api/intake`, `/login`, `/api/login`, and `/buyer` routes remain outside the HBE Access policy.

## Three-device acceptance test

1. Desktop: open `/` in a clean/private browser window.
2. Confirm you cannot see any buyer record and only the Buyer Experience can be started.
3. Start the questionnaire and submit a throwaway test buyer.
4. Record the six-digit access code.
5. Confirm BuyerUI says Buyer Experience complete / Consultation current.
6. Phone: open `/login`, use the same email + access code, confirm the same journey state.
7. Tablet/iPad: repeat step 6.
8. HBE computer: open `/hbe` through Cloudflare Access and change the test buyer stage to `representation`.
9. Refresh BuyerUI on phone/tablet/desktop and confirm all three now show the same current stage.
10. Only after this passes should the link be sent to the first external beta buyer.
