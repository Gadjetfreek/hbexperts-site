# HBE Integrity Sprint Order #6 — Activation Runbook

Status: source implementation prepared; **do not deploy/activate until the account-side gates below are complete and verified**.

## Canonical professional entrance

`https://buyer.hbexperts.com/hbe`

All public HBE Login links must point to this exact URL. There is no second HBE professional login.

## Security architecture

A professional must pass both gates:

1. **Cloudflare Access** — verified identity plus required Independent MFA / authenticator TOTP.
2. **HBE professional registry** — matching `hbe_professionals` record with `status = active`.

The Worker validates `Cf-Access-Jwt-Assertion` before passing any professional request to legacy HBE layers. It verifies RS256 signature, issuer, application audience, expiration, and not-before time using Cloudflare Access signing keys from the team cert/JWKS endpoint.

Do not treat `Cf-Access-Authenticated-User-Email` alone as authentication proof.

## Cloudflare Zero Trust activation

Use one self-hosted Access application for the HBE professional boundary.

Protect at minimum:

- `buyer.hbexperts.com/hbe`
- `buyer.hbexperts.com/hbe/*`
- `buyer.hbexperts.com/api/hbe/*`

Do not place the buyer-facing root, questionnaire, login, or Buyer Portal behind the HBE professional application.

Configure the application deny-by-default. Only explicitly approved HBE professional identities may enter.

### Independent MFA

Enable Cloudflare Independent MFA for the HBE application.

Initial permitted factor:

- Authenticator application / TOTP

Set MFA authentication duration to **Require every login** (`0m`). Cloudflare owns TOTP enrollment and displays the QR code. HBE must never generate or store the TOTP seed.

### Worker configuration

After the Access application exists, replace these placeholders in Worker configuration with the exact real values:

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

The source intentionally fails closed while either value is absent, placeholder, wrong, expired, or otherwise unverifiable.

Never guess these values.

## HBE professional registry

Table: `hbe_professionals`

Roles currently supported:

- `broker_admin`
- `professional`

HBEUI states:

- `pending`
- `active`
- `disabled`

Google Workspace states:

- `requested`
- `provisioned`
- `suspended`

Creating or requesting an `@hbexperts.com` identity must **not** automatically grant HBEUI access.

Initial source records:

- `cwhitehead@hbexperts.com` — Christopher Whitehead — broker_admin — active / provisioned
- `jrose@hbexperts.com` — Jennifer — professional — pending / requested

The Jennifer record is only an HBE provisioning request until the Google Workspace account actually exists.

## Google Workspace boundary

Google Workspace is the source of truth for real `@hbexperts.com` users/mailboxes.

The HBE Admin Portal currently provides the HBE-side directory and provisioning workflow:

- request/register an HBE address;
- track Workspace requested/provisioned/suspended state;
- grant/pause/disable HBEUI authorization separately.

It does **not** create Google Workspace users yet. Actual Workspace provisioning must be completed in Google Workspace Admin until an authorized Workspace Admin/Directory integration is deliberately connected.

For Jennifer, create the Workspace identity:

`JRose@hbexperts.com`

After Workspace confirms it exists, update Jennifer to `workspace_status = provisioned`; only then may HBEUI `status = active` be granted.

## Public HBE Login signs

Source has three intended signs to the same door:

1. global public header — `HBE Login`
2. global public footer — `HBE Login`
3. Buyer Journey context on the homepage — `HBE professional? Sign in to HBEUI`

All point to `https://buyer.hbexperts.com/hbe`.

The private Buyer Portal does not display a staff/HBE Portal link.

## Logout

HBEUI/Admin use Cloudflare Access logout:

`/cdn-cgi/access/logout`

After logout, returning to `/hbe` must require a fresh Access login and therefore a fresh MFA challenge under the `0m` MFA policy.

## Required verification before deployment approval

### Access boundary

- unauthenticated `/hbe` is intercepted by Cloudflare Access;
- non-approved identity is denied by Access;
- approved professional without MFA is taken through Cloudflare authenticator enrollment;
- valid approved professional + TOTP reaches HBEUI;
- wrong TOTP is denied by Cloudflare;
- fresh login requires MFA again;
- missing JWT is denied by Worker;
- modified JWT is denied;
- expired JWT is denied;
- wrong issuer is denied;
- wrong audience is denied;
- valid Cloudflare identity absent/disabled in `hbe_professionals` is denied;
- non-broker-admin cannot reach `/hbe/admin` or `/api/hbe/admin/*`.

### Professional routes

Manually attempt direct unauthorized requests to `/api/hbe/*`; they must fail at the same verified professional boundary.

### User lifecycle

- requested Workspace address remains HBEUI pending;
- HBEUI activation before Workspace provisioning is rejected;
- provisioned + explicitly active professional is allowed;
- Workspace suspension also disables HBEUI;
- broker-admin can see the active/registered-user directory.

### Public navigation

Header, footer, and contextual entry all resolve to exactly `https://buyer.hbexperts.com/hbe`.

### Buyer separation

Buyer Portal remains accessible through buyer authentication and contains no HBE professional-login navigation.

## Stop gate

Do not begin Order #7 as part of activation. Order #7 owns the broader audit/event accountability layer.
