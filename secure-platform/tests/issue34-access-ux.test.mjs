import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import worker from '../src/issue33-production-worker.js';
import { safeHbeReturnPath, hbeAuthFailurePage, accessLoginHref } from '../src/hbe-auth-failure.js';

const TEAM_DOMAIN = 'https://hbexperts.cloudflareaccess.com';
const ACCESS_AUD = 'smoke-access-aud';

function emptyD1(professional = null) {
  return {
    prepare(sql) {
      const stmt = {
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          if (/hbe_professionals/i.test(sql)) return professional;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; }
      };
      return stmt;
    }
  };
}

function env(extra = {}) {
  return {
    BUYER_DB: emptyD1(extra.professional ?? null),
    CF_ACCESS_TEAM_DOMAIN: extra.teamDomain === undefined ? TEAM_DOMAIN : extra.teamDomain,
    CF_ACCESS_AUD: extra.aud === undefined ? ACCESS_AUD : extra.aud,
    HBE_ADMIN_EMAIL: 'cwhitehead@hbexperts.com'
  };
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-kid';
jwk.alg = 'RS256';
jwk.use = 'sig';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input);
};

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function mintJwt(email, overrides = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    email,
    iss: TEAM_DOMAIN,
    aud: ACCESS_AUD,
    exp: now + 3600,
    nbf: now - 10,
    ...overrides
  }));
  const data = `${header}.${payload}`;
  const sig = nodeSign('RSA-SHA256', Buffer.from(data), privateKey);
  return `${data}.${b64url(sig)}`;
}

test('safeHbeReturnPath keeps local /hbe paths and rejects open redirects', () => {
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe?buyer=alex'), '/hbe?buyer=alex');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe/preview?buyer=alex&view=mine'), '/hbe/preview?buyer=alex&view=mine');
  assert.equal(safeHbeReturnPath('https://evil.example/hbe'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/portal'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe?next=https://evil.test'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com//evil'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe/%2f%2fevil.example'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe?next=%2f%2fevil'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe?next=https%3a%2f%2fevil.test'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe/../portal'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe/foo/../../etc'), '/hbe');
  assert.equal(safeHbeReturnPath('https://buyer.hbexperts.com/hbe/..%2f..%2f'), '/hbe');
});

test('sign-in URL identifies Access application via AUD (kid), not only redirect_url', () => {
  const href = accessLoginHref({
    teamDomain: TEAM_DOMAIN,
    audience: ACCESS_AUD,
    redirectPath: '/hbe?buyer=alex'
  });
  assert.match(href, new RegExp(`^${TEAM_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cdn-cgi/access/login/buyer\\.hbexperts\\.com\\?`));
  assert.match(href, new RegExp(`kid=${ACCESS_AUD}`));
  assert.match(href, /redirect_url=%2Fhbe%3Fbuyer%3Dalex/);
  // no invented hardcoded kid when AUD missing
  assert.equal(accessLoginHref({ teamDomain: TEAM_DOMAIN, audience: '', redirectPath: '/hbe' }), '/hbe');
});

test('failure pages are 403 HTML no-store noindex without secrets', async () => {
  for (const kind of ['config', 'auth_required', 'unauthorized', 'jwt_invalid']) {
    const res = hbeAuthFailurePage({
      kind,
      requestUrl: 'https://buyer.hbexperts.com/hbe?buyer=alex',
      teamDomain: TEAM_DOMAIN,
      audience: ACCESS_AUD
    });
    assert.equal(res.status, 403);
    assert.match(res.headers.get('cache-control') || '', /no-store/i);
    const html = await res.text();
    assert.match(html, /noindex/i);
    assert.match(html, /data-hbe-access-state=/);
    assert.doesNotMatch(html, /CF_ACCESS_AUD=|BEGIN PRIVATE|Cf-Access-Jwt-Assertion/i);
    assert.doesNotMatch(html, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/);
    assert.doesNotMatch(html, /https?:\/\/evil/i);
  }
});

test('missing Access config remains 403 branded unavailable', async () => {
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe?buyer=alex'), env({ teamDomain: '', aud: '' }), {});
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /temporarily unavailable/i);
  assert.match(html, /HBE_ACCESS_CONFIG/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /Rivera|questionnaire|answers_json/i);
});

test('missing JWT remains denied with Sign in action', async () => {
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe?buyer=alex'), env(), {});
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /session has ended/i);
  assert.match(html, /Sign in to HBE/);
  assert.match(html, /HBE_ACCESS_AUTH/);
  assert.match(html, /redirect_url=%2Fhbe%3Fbuyer%3Dalex/);
  assert.match(html, new RegExp("kid=" + ACCESS_AUD.replace(/[.*+?^${}()|[\]\\]/g, "\\&")));
  assert.match(html, /cdn-cgi\/access\/login\/buyer\.hbexperts\.com/);
});

test('inactive professional remains denied', async () => {
  const jwt = mintJwt('outsider@example.test');
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt }
  }), env({ professional: { id: 'p1', email: 'outsider@example.test', display_name: 'Out', role: 'agent', status: 'inactive', workspace_status: 'none', workspace_user_id: null } }), {});
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /not authorized/i);
  assert.match(html, /HBE_ACCESS_UNAUTHORIZED/);
  assert.match(html, /different account/i);
});

test('invalid JWT remains denied', async () => {
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe', {
    headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' }
  }), env(), {});
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /could not verify your HBE session/i);
  assert.match(html, /HBE_ACCESS_JWT/);
});

test('API mutations still fail closed without JWT', async () => {
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/checklist/toggle', {
    method: 'POST',
    headers: { origin: 'https://buyer.hbexperts.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'item_id=x&case_id=y'
  }), env(), {});
  assert.equal(res.status, 403);
  assert.match(await res.text(), /HBE_ACCESS_AUTH|session has ended/i);
});
