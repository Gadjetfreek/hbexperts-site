# Spec: "Open the next chapter" → Agreement → E-sign (Stage 3, Choosing Your Guide)
Status: PLAN ONLY (no build, no PRs, no deploys). Prepared 2026-10-30. All examples are synthetic.

## Corrections and decisions (verified 2026-10-30; supersedes conflicting text below)

**Decisions (Sebastian):** native e-sign; typed OR drawn signature; passkey/Face ID REQUIRED for buyers (user verification required, no password/OTP path; a device without passkeys sees "contact HBE to sign on paper in person"); Sebastian countersigns as broker only; PWA for alerts; paper fallback stays.

**Verified vendor facts:** DocuSeal is AGPL with a 7(b) attribution term; API/embedding needs Pro ($20/user/mo, or on-prem $240/yr + $0.20/doc). Documenso is AGPL; embedding is Teams ($40/mo), white-label Platform ($250/mo), private modifications need an enterprise license. OpenSign is AGPL with a carve-out for apps/OpenSignServer/cloud/customRoute. None changes the native choice.

**Passkey library:** SimpleWebAuthn v14 is MIT but the deploy has no npm build, so WebAuthn verification (ES256/RS256) and the PDF writer are native Web Crypto code in the Worker.

**Access + Google IdP:** Zero Trust > Integrations > Identity providers; JS origin https://<team>.cloudflareaccess.com, redirect /cdn-cgi/access/callback, PKCE optional.

**Ohio, FLAG FOR COUNSEL:** ORC 1306.06 (UETA consent). ORC 4735.55 (eff. 9/30/2025): v5 appears to lack the blockbusting statement, the HUD equal housing logo/statement, and a conspicuous "fees are not set by law and are negotiable" statement. ORC 4735.56 agency disclosure. OAC 1301:5-6-05(D): the Consumer Guide acknowledgement must be separate from the agreement (built as a separate step later, not inside the agreement).

**iOS web push:** iOS/iPadOS 16.4+ only, only after Add to Home Screen, permission must come from a user tap. Push payloads carry no personal details.

**SAMPLE lock:** template approved flag defaults 0; no code sets it; until Sebastian sets it, every PDF carries "SAMPLE — NOT FOR SIGNATURE".

## 0. Key finding from the code
The portal already has most of the plumbing:
- `web-push.js`: Web Push for Workers using Web Crypto (RFC 8291/8292, VAPID). Free, no libraries.
- `hbe-push.js`: an installable staff PWA (`/hbe/app.webmanifest`, `/hbe/app-sw.js`), `hbe_push_subscriptions`/`hbe_push_alerts`, VAPID env keys. It is staff-only today, and the same pattern can be reused for buyers.
- `representation-worker.js`: `/api/representation/choice` (buyer) and `/api/hbe/representation` (staff, `requireVerifiedProfessional`), plus tables `buyer_representation_choices` / `buyer_representation_records`.
- `co-buyer-consent-worker.js`: a consent-based household invite (direct staff linking returns 410).
So a native e-sign module fits the existing architecture. No new server is needed.

## 1. E-sign options
| Option | License / cost | Runs on CF free? | Through our own site? | Verdict |
|---|---|---|---|---|
| (a) Native in the Worker | $0, our code | Yes (Worker + D1 + R2) | Yes, fully | **Recommended** |
| DocuSeal (self-host) | AGPL-3.0; embedding/API features partly Pro (paid) | No. Ruby/Rails + Postgres, needs a VPS (~$5–12/mo) | Iframe/embed, separate host | Second choice |
| Documenso (self-host) | AGPL-3.0; embed is a paid/enterprise feature in cloud | No. Next.js + Postgres + SMTP | Separate host | No |
| OpenSign (self-host) | AGPL-3.0 | No. Node + MongoDB | Separate host | No |
| Free SaaS tiers (DocuSign/Dropbox Sign/DocuSeal cloud) | Tight free limits; 3rd-party UI | n/a | No, sends buyers elsewhere | Fails the "through our site" goal |
Notes: under AGPL, if you modify the code and serve it, you must publish your changes. Every self-hosted option adds a server, a second login surface, a second database holding PII, and patching work. Licenses and pricing should be re-checked before choosing.

### Native design (what "legally adequate" usually looks like, plain level; counsel to confirm)
Under US ESIGN (15 U.S.C. 7001) and Ohio UETA (ORC Chapter 1306), an e-signature generally works if: (1) the person intends to sign, (2) both sides agree to do business electronically (ESIGN consumer disclosure: right to paper, how to withdraw, hardware/software needs, how to get a copy), (3) the signature is attributable to the person (authentication), and (4) the record is retained accurately and can be reproduced. Our implementation:
1. **ERSD consent step** before viewing for signature (checkbox + text, versioned, stored per signer).
2. **Identity**: the existing buyer portal session (each co-buyer has their own login), plus a single-use, short-lived signing token (hashed in DB, 72h expiry) and a re-auth/OTP check at signing time if available.
3. **Review**: render the frozen PDF (pdf.js in browser, or an HTML twin plus a PDF download). The buyer must scroll to the end, initial each "Initials" spot (§2, §3, §3e choice, §4 choice, page initials p1–3, Win/Win), then sign.
4. **Signature**: typed name in a script font (baseline) with optional drawn signature (canvas → PNG). Clear "I agree to sign electronically" click.
5. **Audit trail per event**: signer id, timestamp (UTC), IP (`CF-Connecting-IP`), user agent, document SHA-256 before and after, field values hash. Stored in D1 only. Never in logs.
6. **Finalize**: once all buyers sign, the broker countersigns in HBEUI. Then generate the final PDF (pdf-lib works in Workers) with stamped signatures and initials plus a **Certificate of Completion** page (events, hashes). Store in **private R2** (new prefix or bucket, never public), record the SHA-256, and make it downloadable to each signer from BuyerUI. Email copy later, once Email Sending is live.
7. **Tamper evidence**: hash chain on events (each event stores the previous event's hash). Optional later: sign the final PDF hash with an HMAC/ECDSA key held in Worker secrets.

### Ohio / real-estate items to FLAG FOR COUNSEL (not legal conclusions)
- ORC 4735.55: required contents of a written agency agreement (e.g., expiration date, compensation, cooperation/dual-agency policy statements, fair housing language). Confirm the v5 draft complies.
- ORC 4735.56 / OAC 1301:5-6-10: **Consumer Guide to Agency Relationships** and Agency Disclosure Statement timing. Likely must be provided before or with the agreement. Consider a separate acknowledgement step in the same flow.
- Whether e-signature is acceptable for the agency agreement (generally yes under UETA; confirm) and the record-retention period under Ohio Division of Real Estate rules (store at least that long; no deletion).
- Post-2024 NAR settlement practice: written buyer agreement before touring, with comp stated conspicuously and not open-ended. Confirm the 3%/4%/$5,000 min and the Over-List Cap wording.
- The single "BUYER" block with two co-buyers: both must sign/initial, and whether each is jointly and severally bound.
- The draft footer still says "DRAFT for owner review - not for signature". The template must not go live until counsel approves; the build uses a SAMPLE template only.

## 2. The "app"
| | PWA (Add to Home Screen) | Native App Store app |
|---|---|---|
| Cost | $0 | $99/yr Apple + $25 Google + build/review time |
| Timeline | Days (pattern exists in `hbe-push.js`) | Weeks (review, wrapper, push certs) |
| iOS push | Yes, iOS/iPadOS 16.4+ **only when installed to Home Screen** and the user taps "Allow" after a button press | Yes |
| Android | Push works in browser or installed | Yes |
**Recommendation: PWA** at buyer.hbexperts.com/portal (`/portal/app.webmanifest`, `/portal/app-sw.js`, buyer-scoped `buyer_push_subscriptions`), reusing `web-push.js` and the existing VAPID keys (free; keys are Worker secrets). Baseline that always works: an **in-portal banner/badge** ("You have a document to sign") on every BuyerUI page load. Push is a bonus, and email comes later when Email Sending is live. Push payloads must have no PII: "HBE: You have something new to review" plus a URL only. Never SMS/Twilio.

## 3. Data model (new D1 migration; needs Sebastian's approval to apply)
```sql
CREATE TABLE agreement_templates (id TEXT PRIMARY KEY, name TEXT, version TEXT, status TEXT CHECK(status IN ('sample','counsel_review','approved','retired')), body_html TEXT, field_schema_json TEXT, sha256 TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT);
CREATE TABLE agreement_instances (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, template_id TEXT NOT NULL, status TEXT CHECK(status IN ('draft','sent','partially_signed','buyers_signed','executed','voided','expired')), field_values_json TEXT, frozen_sha256 TEXT, frozen_r2_key TEXT, final_sha256 TEXT, final_r2_key TEXT, created_by TEXT, sent_at TEXT, executed_at TEXT, voided_reason TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE agreement_signers (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, role TEXT CHECK(role IN ('buyer','agent','broker')), buyer_id TEXT, staff_email TEXT, order_idx INTEGER, ersd_version TEXT, ersd_consent_at TEXT, token_hash TEXT, token_expires_at TEXT, token_used_at TEXT, viewed_at TEXT, signed_at TEXT, signature_kind TEXT, signature_r2_key TEXT, initials_json TEXT, declined_at TEXT);
CREATE TABLE agreement_events (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, signer_id TEXT, event TEXT, at TEXT, ip TEXT, user_agent TEXT, doc_sha256 TEXT, prev_hash TEXT, event_hash TEXT);
CREATE TABLE buyer_push_subscriptions (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, created_at TEXT, revoked_at TEXT);
```
R2 (private bucket `hbe-agreements` or prefix `agreements/` on a private bucket; NOT the showing-photos public path): `agreements/<instance_id>/frozen.pdf`, `sig-<signer_id>.png`, `final.pdf`. Served only through an authenticated Worker route.

### Buyer-specific fields (from v5 text)
| Field | Source | Who fills |
|---|---|---|
| Buyer 1 / Buyer 2 printed names | case/household | prefilled, HBE verifies |
| Price range "up to $" | consultation | HBE |
| Term end date (§1 "midnight ____") | default: +N months (Sebastian picks N) | HBE |
| §4 Retainer choice: $750 at execution OR returning-client deferred | HBE checks prior HBE closing | HBE selects; buyer initials |
| §3e Ready/willing/able vs pre-approval within 10 days | buyer choice | buyer initials one |
| Win/Win Savings Program opt-in initials | buyer | buyer initials |
| §11 Additional provisions | free text | HBE (optional) |
| Buyer street / city-state-zip / phone | buyer profile | prefilled, buyer confirms |
| Agent print/sign/date; Broker print/sign/date | staff | e-sign in HBEUI |
| Buyer sign/date ×2; initials (§2, §3 ×2, page initials p1–3) | each buyer | e-sign in BuyerUI |
Suggested addition (counsel): target area/county, since the agreement currently names no geography.

### Endpoints
Staff (Cloudflare Access + `requireVerifiedProfessional`):
- `POST /api/hbe/case/:id/next-chapter/preview` → returns template plus prefilled fields (no write).
- `POST /api/hbe/agreements` → create a draft instance (fields).
- `PUT /api/hbe/agreements/:id` → edit while draft.
- `POST /api/hbe/agreements/:id/send` → freeze PDF + hash → R2, create signers + tokens, enqueue banner/push, event `sent`. **Blocked unless template.status='approved'** (or a `sample` template on a non-prod env).
- `POST /api/hbe/agreements/:id/countersign`, `POST /api/hbe/agreements/:id/void`.
- `GET /api/hbe/agreements/:id/file?kind=final`.
Buyer (existing buyer session + signer ownership check):
- `GET /api/agreements/pending`, `GET /portal/sign/:token` (single-use, hashed, expiring; also requires the matching logged-in buyer).
- `POST /api/agreements/:id/ersd-consent`, `POST /api/agreements/:id/sign` (initials + signature + choices), `POST /api/agreements/:id/decline`.
- `GET /api/agreements/:id/file`.
- `POST /api/portal/push/subscribe|unsubscribe`, `/portal/app.webmanifest`, `/portal/app-sw.js`.

### Hook into Stage 3 + co-buyer linking
1. HBEUI case card button **"Open the next chapter"** (shown at Stage 2 after consultation). It calls the existing stage move (`/api/hbe/buyer/:id/stage` → representation) only after the agreement is sent, or as part of `send`. Stage names in `journey-stages.js` stay unchanged.
2. Household: if a co-buyer is named but not linked, the flow first triggers the existing **co-buyer consent invite** (`co-buyer-consent-worker.js`). The second buyer's signer row is created only after their consent is accepted. Their private answers stay private. Signing order: buyers in any order, then agent/broker countersign.
3. On `executed`: write `buyer_representation_records`, add a case audit event, and show "Agreement in effect until <date>" in HBEUI and BuyerUI.

### Screens
- **HBEUI**: Next-chapter drawer, then a form with prefilled fields (verify/edit), a live preview, and a checklist (agency disclosure given? returning client verified?), then **Send for signature** (confirm dialog). Then a status panel (sent/viewed/signed per signer), Countersign, Void, Download.
- **BuyerUI**: a banner and a Next-action card "Your HBE agreement is ready to review." Flow: ERSD consent → read (scroll gate) → initials → choices → signature → confirmation + download. Also an "Install the HBE app for alerts" prompt (iOS instructions) and a decline/"I have questions" option (creates an HBE task, no message sent).

### Security
Staff routes Access-gated plus a verified-professional check. Signer auth uses the buyer session plus a single-use token (store only a SHA-256 of the token). CSRF via same-origin and an existing token pattern. R2 objects private. No PII in logs, push payloads, git, or tests (synthetic fixtures like "Test Buyer A"). Rate-limit signing endpoints. The frozen hash is checked at sign time, so a document changed after sending cannot be signed. Instances can be voided, never deleted.

## 4. PR plan + estimates
| PR | Scope | Est. |
|---|---|---|
| 1 | Migration + data layer + template registry (SAMPLE template from v5 with "SAMPLE – NOT FOR USE" watermark) + unit tests (synthetic) | 0.5 day |
| 2 | HBEUI "Open the next chapter" drawer: prefill, edit, preview, draft save | 0.5–1 day |
| 3 | Send: freeze PDF (pdf-lib), hash, R2 private, signer tokens, BuyerUI banner/Next-action | 0.5–1 day |
| 4 | BuyerUI signing: ERSD, scroll gate, initials, typed/drawn signature, audit events | 1 day |
| 5 | Countersign, final PDF + certificate page, downloads, Stage 3 + representation record hook, co-buyer gating | 1 day |
| 6 | Buyer PWA + web push (reuse web-push.js / hbe-push.js pattern) | 0.5 day |
| 7 | Email copy of executed PDF (after Email Sending is live) | 0.25 day, later |
Total ≈ 4–5 focused days, plus review and iPhone testing.

**Realistic by Sun Nov 1 / Mon Nov 2:** PRs 1–3 plus the banner (staff can prepare and "send" a SAMPLE on a preview, and the buyer sees a banner), possibly PR 4 in preview. **Not realistic:** a counsel-approved, production-executed e-signed agreement by Monday. Fallback for a buyer ready Sun/Mon: sign the counsel-approved paper/PDF agreement in person (wet ink) and record it in HBEUI. Later PRs follow over the next ~week; the PWA push (PR 6) can be pulled forward since it's small.

## 5. Blockers
1. Counsel approval of the agreement (and the agency disclosure handling). Hard gate: `send` is blocked until the template is `approved`.
2. D1 migration needs Sebastian's approval and a write token (current token is read-only).
3. Prod deploys need Sebastian's go plus the hbe-secure-production environment gate.
4. Cloudflare Email Sending pending, so no email copies yet (download + banner/push instead).
5. A private R2 bucket/prefix for agreements (free tier OK; confirm it's not the public photo path).
6. iOS push requires each buyer to install the PWA (iOS 16.4+) and allow notifications.

## 6. Decisions for Sebastian
1. Native build in our Worker (recommended) vs self-hosted DocuSeal on a ~$5–12/mo VPS.
2. PWA (recommended, free) vs App Store app.
3. Default agreement term (e.g., 6 or 12 months) and whether target area is added (counsel).
4. Signature style: typed only, or typed + drawn option.
5. Who signs for HBE: agent + broker both (you, as both?) and the countersign order.
6. Sun/Mon fallback: in-person paper signing if a buyer is ready before counsel/e-sign are live.
7. Approve the D1 migration and the private R2 bucket when the build is ready.

## 7. Face ID / biometric sign-in via passkeys (WebAuthn)

### 7.1 HBEUI staff (Cloudflare Access, free plan)
Access itself has no built-in passkey login. Its free "One-time PIN" method is email codes only. The way to get Face ID is to add an **identity provider that supports passkeys** and use it for the /hbe Access application:
- **Google (recommended, free):** Google accounts support passkeys, so Face ID on iPhone/Mac works as the Google sign-in step. This works whether hbexperts.com is on Google Workspace or a personal Google account. In Workspace, the admin can also require 2-Step Verification or passkeys.
- Alternatives: GitHub (supports passkeys), or Microsoft Entra ID. Both are free tiers.

Setup steps (Sebastian does these in the Zero Trust dashboard; it is a security change, so it needs his go):
1. Turn on a passkey for the Google account: myaccount.google.com → Security → Passkeys → Create a passkey (on iPhone it's saved to iCloud Keychain and unlocked with Face ID). Optionally set "Skip password when possible."
2. Zero Trust dashboard → Settings → Authentication → Login methods → Add new → Google (or Google Workspace). Create an OAuth client in Google Cloud Console (Web app; redirect URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`) and paste in the Client ID/secret. Then click Test.
3. Access → Applications → the /hbe app → Authentication: enable Google and **keep the Allow policy exactly as it is now** (Include: emails = cwhitehead@hbexperts.com and other named staff only, never "any Google account"). Optionally turn on "Instant Auth" so Google is the default.
4. Keep One-time PIN enabled as a break-glass fallback for now. Once Google works on iPhone and the HBE PWA, either disable it, or keep it limited to the same email list.
5. Verify the change: in a private window, a non-allowed Google account must get **denied**. Also check that the existing `requireVerifiedProfessional` check still passes, because it reads the Access JWT email, which stays the same.
6. Session duration: keep the current value (for example, 24h). Don't lengthen it to cut down on prompts.

Risks:
- Security then rests on the Google account. Protect it with the passkey plus 2SV and recovery options, and remove SMS as a recovery method where possible.
- A misconfigured policy (for example, "Include: everyone" or "any Google user") would open /hbe. The rule is policy unchanged, emails only, plus the step-5 test.
- An installed PWA may open the Google sign-in in an in-app browser sheet. It works, but it's worth testing on the iPhone.
- Estimate: about 30–45 minutes of dashboard setup by Sebastian (with me guiding), $0, no code. The audit event and `requireVerifiedProfessional` are unaffected.

### 7.2 BuyerUI buyers: native passkeys in the Worker
Library: `@simplewebauthn/server` (MIT; runs on Workers with Web Crypto) and `@simplewebauthn/browser`. Passkeys work in iOS 16+ Safari and in an installed Home-Screen PWA on the same origin, with RP ID `buyer.hbexperts.com`. They sync via iCloud Keychain or Google Password Manager.

Flow:
- **Enroll:** after a normal sign-in (the existing buyer session/magic code), the buyer sees "Use Face ID next time?" → `POST /api/portal/passkey/register/options` → `navigator.credentials.create` → `/register/verify`. Use `userVerification: 'required'` and `residentKey: 'preferred'`, and set the user handle to a random id (not the email).
- **Sign in:** "Sign in with Face ID" → `/api/portal/passkey/login/options` → `navigator.credentials.get` (conditional UI/autofill is supported) → `/login/verify` → the same session cookie as today.
- **Fallback/recovery:** the existing sign-in method stays available always. A buyer can list and remove their passkeys in the portal, and HBE staff can revoke a buyer's passkeys from HBEUI (audit event). Losing a device means signing in the old way and re-enrolling. No passkey-only accounts.
- Challenges are single-use, expire in 5 minutes, and are stored in D1 (or KV). Sign counter and backup flags are stored and checked.

Tables (in the same migration as §3, needs approval):
```sql
CREATE TABLE buyer_passkeys (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, credential_id TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL, sign_count INTEGER, transports TEXT, backed_up INTEGER, device_label TEXT, created_at TEXT, last_used_at TEXT, revoked_at TEXT);
CREATE TABLE webauthn_challenges (id TEXT PRIMARY KEY, buyer_id TEXT, purpose TEXT CHECK(purpose IN ('register','login','sign')), challenge TEXT, expires_at TEXT, used_at TEXT);
```

**How this strengthens e-sign:** at the final "Sign" click, ask for a fresh passkey assertion (Face ID) whose challenge = SHA-256(frozen document hash ‖ signer_id ‖ instance_id ‖ nonce). Store in `agreement_events`: credential_id, the assertion authenticatorData/clientDataJSON/signature, and the user-verified flag. That gives cryptographic, device-bound proof that this enrolled buyer approved this exact document version, which is much stronger attribution than a session cookie and covers ESIGN/UETA "attributable to the person." Include "Identity verified with passkey (Face ID/Touch ID), credential ••1234" on the certificate page. Buyers without a passkey still sign with session + single-use token + email/OTP re-auth, and the certificate records which method was used.

Estimates: buyer passkey sign-in + enroll + manage/revoke + tests ≈ 1–1.5 days (new PR 8). The signing-time assertion hook ≈ 0.25 day (part of PR 4/5). Not needed for Sun/Mon. Staff Face ID via Google (§7.1) **can** be done before Sunday at no cost.

Decisions added: (8) approve adding the Google IdP to Access (policy unchanged) and when to retire email codes. (9) Whether a passkey should be **required** to sign (recommended: optional, but "preferred" with a fallback).

## Update 2026-10-30: template v6 + Ohio Consumer Guide receipt
- Template is now `hbe-buyer-agency-v6` (`src/agreement-template-v6.js`), from owner draft v6. It adds the ORC 4735.55(C)(7) fees statement, verbatim, in a boxed bold-caps paragraph before the §5 fee bullets. It also adds "as amended" to §12, a blockbusting statement using the state model-form wording, and an Equal Housing Opportunity mark. The mark is drawn here as a stand-in; replace it with the official HUD artwork before approval. Fields are unchanged (term_end, price_max, retainer_option, additional_provisions). It is still SAMPLE-locked: `approved` stays 0 and has no setter.
- The Consumer Guide receipt is its own step, after e-records consent and before the agreement. The buyer reads the Ohio Consumer Guide to Agency Relationships (Exclusive Buyer Agency Only model policy, Effective 10/24/2024), with "(brokerage)" filled in as HomeBuyer Experts. The buyer can also open the official state PDF at `/portal/consumer-guide.pdf`, served unmodified and public. The buyer then acknowledges receipt with a passkey (UV required) on a `guide_ack` challenge bound to the PDF SHA-256 (c9448026…). That writes the `guide_*` columns on `agreement_signers` and the hash-chained events `consumer_guide_viewed` and `consumer_guide_acknowledged`. Reading or signing the agreement returns `consumer_guide_first` / `review_incomplete` until the receipt is recorded.
- FLAG FOR COUNSEL: the guide must be given at first substantive contact. This portal step records receipt for the e-sign flow; it does not replace giving the guide earlier.

## Hosted staging (test site for this PR)

- URL: https://hbe-buyer-platform-staging.hbe-home-buyers-expert.workers.dev (workers.dev only, no custom domain/routes)
- Config: `wrangler.staging.toml` (separate file, so it inherits nothing from production). Entry `src/staging-entry.js` re-exports only the default handler (the issue33 module's helper named exports block deploy).
- Resources: D1 `hbe-buyer-journey-staging` (full schema + all migrations incl. `agreements-esign.sql`), private R2 `hbe-agreements-staging` and `hbe-showing-photos-staging`.
- No `send_email` binding and no crons, so staging cannot send mail. Because of that, `/health` reports `ok:false` (503) on purpose, since alert delivery is "not ready".
- Secrets (staging-only, generated fresh, not in git): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, WEBAUTHN_USER_SALT. Passkey RP ID = the staging host.
- Cloudflare Access app "HBE STAGING buyer platform /hbe" covers `/hbe`, `/hbe/*`, `/api/hbe*`, using the same reusable "HBE admin only" policy as production (attached by reference, not modified).
- Data: synthetic only. Test Buyer A / Test Buyer B (`test.buyer.a@example.com`, `test.buyer.b@example.com`) share case `stg-case-1` at stage `consultation`. Access codes are kept out of git.
- Deploy: `CLOUDFLARE_API_TOKEN=... npx wrangler deploy -c wrangler.staging.toml`
