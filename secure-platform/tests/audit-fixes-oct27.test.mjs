// Oct 27 2026 audit fixes. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireVerifiedProfessional } from '../src/hbe-access-worker.js';
import worker, { publicHealth, withNoIndex } from '../src/issue33-production-worker.js';
import { alertDelay, processAlertEscalations, handleLeadAction, leadPanelHtml, unacknowledgedBanner, ESCALATE_MS } from '../src/lead-response.js';
import { guardIntake, verifyTurnstile, turnstileConfig, addTurnstileWidget, allowTurnstileCsp, TURNSTILE_ACTION } from '../src/intake-guard.js';
import { mutationCsrfToken } from '../src/household-state.js';

const OWNER = 'cwhitehead@hbexperts.com';
const ORIGIN = 'https://buyer.hbexperts.com';

// ---------- fix 5: fail-closed auth ----------
test('requireVerifiedProfessional allows only an explicit, well-formed pass', async () => {
  const pass = await requireVerifiedProfessional(new Request(ORIGIN + '/hbe'), {}, async () => ({ ok: true, professional: { email: 'agent@example.test' } }));
  assert.equal(pass.ok, true);
  const cases = [
    async () => { throw new Error('boom'); },
    async () => ({ ok: false, response: new Response('err', { status: 500 }) }),
    async () => ({ ok: false, response: new Response('moved', { status: 302 }) }),
    async () => ({ ok: false, response: new Response('weird', { status: 200 }) }),
    async () => ({ ok: 'true', professional: { email: 'x@example.test' } }),
    async () => ({ ok: true }),
    async () => ({ ok: true, professional: { email: '' } }),
    async () => null,
    async () => undefined
  ];
  for (const [i, fn] of cases.entries()) {
    const r = await requireVerifiedProfessional(new Request(ORIGIN + '/hbe'), {}, fn);
    assert.equal(r.ok, false, `case ${i} must deny`);
    assert.ok(r.response instanceof Response, `case ${i} returns a response`);
    assert.ok(r.response.status < 200 || r.response.status >= 300, `case ${i} denial is never 2xx (got ${r.response.status})`);
  }
});

function recordingD1() {
  const writes = [];
  const db = {
    writes,
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql.slice(0, 60)); return { success: true, meta: { changes: 0 } }; }
      };
      return stmt;
    }
  };
  return db;
}

for (const [label, envExtra] of [['missing Access config', {}], ['no JWT', { CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', CF_ACCESS_AUD: 'test-aud' }]]) {
  test(`HBE mutation routes deny with ${label} and write nothing`, async () => {
    for (const path of ['/api/hbe/consultation', '/api/hbe/representation', '/api/hbe/search/profile', '/api/hbe/search/run', '/api/hbe/story', '/api/hbe/compass', '/api/hbe/lead/acknowledge', '/api/hbe/health']) {
      const db = recordingD1();
      const res = await worker.fetch(new Request(ORIGIN + path, { method: path.endsWith('/health') ? 'GET' : 'POST', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: path.endsWith('/health') ? undefined : 'buyer_id=synthetic-1' }), { BUYER_DB: db, ...envExtra }, { waitUntil() {} });
      assert.ok(res.status >= 400, `${path} denied (got ${res.status})`);
      assert.deepEqual(db.writes, [], `${path} wrote nothing`);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', `${path} noindex`);
    }
  });
}

// ---------- fix 5: trimmed health + noindex ----------
test('public /health exposes only ok + version', async () => {
  const db = { prepare() { const s = { bind() { return s; }, async first() { return { count: 0 }; } }; return s; } };
  const res = await publicHealth({ BUYER_DB: db, HBE_ALERT: {}, CF_VERSION_METADATA: { id: 'v1' } });
  assert.deepEqual(await res.json(), { ok: true, version: 'v1' });
  const down = await publicHealth({ BUYER_DB: { prepare() { throw new Error('d1 down'); } }, HBE_ALERT: {} });
  assert.equal(down.status, 503);
});

test('every Worker response carries X-Robots-Tag noindex', async () => {
  const res = await worker.fetch(new Request(ORIGIN + '/questionnaire'), { BUYER_DB: recordingD1(), HBE_ADMIN_EMAIL: OWNER }, { waitUntil() {} });
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  const frozen = await fetchLikeResponse();
  assert.equal(withNoIndex(frozen).headers.get('x-robots-tag'), 'noindex, nofollow');
});
async function fetchLikeResponse() {
  const r = new Response('x');
  Object.defineProperty(r, 'headers', { value: new Proxy(new Headers(), { get(t, k) { if (k === 'set') return () => { throw new TypeError('immutable'); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }) });
  return r;
}

// ---------- fix 2: alert delay + escalation ----------
test('alertDelay marks unsent >15m as delayed and late sends as late', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.deepEqual(alertDelay({ alert_status: 'pending', alert_created_at: '2026-01-01T11:40:00Z' }, now), { kind: 'delayed', minutes: 20 });
  assert.equal(alertDelay({ alert_status: 'failed', alert_created_at: '2026-01-01T11:50:00Z' }, now), null);
  assert.deepEqual(alertDelay({ alert_status: 'sent', alert_created_at: '2026-01-01T10:00:00Z', sent_at: '2026-01-01T11:00:00Z' }, now), { kind: 'late', minutes: 60 });
  assert.equal(alertDelay({ alert_status: 'sent', alert_created_at: '2026-01-01T10:00:00Z', sent_at: '2026-01-01T10:01:00Z' }, now), null);
});

function escalationDb() {
  const t = { status: new Map(), events: [], push: [] };
  return { t, prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
    async all() {
      if (sql.includes('FROM notification_deliveries d JOIN notifications n')) {
        const s = t.status.get('synthetic-buyer');
        return { results: s?.escalated_at ? [] : [{ notification_id: 'n-1', buyer_id: 'synthetic-buyer', created_at: '2026-01-01T00:00:00Z' }] };
      }
      return { results: [] };
    },
    async run() {
      if (sql.startsWith('INSERT INTO hbe_lead_status')) {
        const cur = t.status.get(a[0]);
        if (cur?.escalated_at) return { meta: { changes: 0 } };
        t.status.set(a[0], { ...(cur || {}), escalated_at: a[3] }); return { meta: { changes: 1 } };
      }
      if (sql.startsWith('INSERT INTO hbe_lead_events')) { t.events.push(a[1]); return { meta: { changes: 1 } }; }
      if (sql.includes('INSERT OR IGNORE INTO hbe_push_alerts')) { if (t.push.includes(a[0])) return { meta: { changes: 0 } }; t.push.push(a[0]); return { meta: { changes: 1 } }; }
      throw new Error('unexpected ' + sql);
    } }; return st; } };
}

test('unsent alert escalates exactly once per lead', async () => {
  const db = escalationDb();
  const delivered = [];
  const deliver = async (_env, id) => { delivered.push(id); return { status: 'sent' }; };
  const r1 = await processAlertEscalations({ BUYER_DB: db }, { now: Date.parse('2026-01-01T00:20:00Z'), deliver });
  const r2 = await processAlertEscalations({ BUYER_DB: db }, { now: Date.parse('2026-01-01T00:25:00Z'), deliver });
  assert.equal(r1.escalated, 1);
  assert.equal(r2.escalated, 0);
  assert.deepEqual(delivered, ['intake:delayed:n-1']);
  assert.deepEqual(db.t.events, ['escalated']);
});

// ---------- fix 3: acknowledgment ----------
function leadDb() {
  const t = { updates: [], events: [] };
  return { t, prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
    async first() {
      if (sql.includes('FROM notifications WHERE buyer_id=?')) return a[0] === 'synthetic-buyer' ? { id: 'n-1' } : null;
      if (sql.includes('FROM hbe_professionals')) return a[0] === 'agent@hbexperts.com' ? { email: a[0] } : null;
      return null;
    },
    async run() {
      if (sql.startsWith('UPDATE hbe_lead_status')) t.updates.push(sql.slice(0, 50));
      if (sql.startsWith('INSERT INTO hbe_lead_events')) t.events.push(a[1]);
      return { meta: { changes: 1 } };
    } }; return st; } };
}
const asOwner = { authenticate: async () => ({ ok: true, professional: { email: OWNER } }) };
const asStaff = { authenticate: async () => ({ ok: true, professional: { email: 'agent@hbexperts.com' } }) };
async function leadPost(action, fields, opts, headers = {}) {
  const jwt = 'synthetic.jwt.token';
  const body = new URLSearchParams(fields);
  const req = new Request(`${ORIGIN}/api/hbe/lead/${action}`, { method: 'POST', body, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'Cf-Access-Jwt-Assertion': jwt, 'content-type': 'application/x-www-form-urlencoded', ...headers } });
  const db = leadDb();
  const res = await handleLeadAction(req, { BUYER_DB: db, HBE_ADMIN_EMAIL: OWNER }, new URL(req.url), opts);
  return { res, db };
}

test('lead actions are owner-only and CSRF-protected', async () => {
  const csrf = await mutationCsrfToken('synthetic.jwt.token');
  let r = await leadPost('acknowledge', { buyer_id: 'synthetic-buyer', csrf }, asStaff);
  assert.equal(r.res.status, 403); assert.deepEqual(r.db.t.updates, []);
  r = await leadPost('acknowledge', { buyer_id: 'synthetic-buyer', csrf: 'wrong' }, asOwner);
  assert.equal(r.res.status, 403); assert.deepEqual(r.db.t.updates, []);
  r = await leadPost('acknowledge', { buyer_id: 'synthetic-buyer', csrf }, asOwner, { origin: 'https://evil.example' });
  assert.equal(r.res.status, 403); assert.deepEqual(r.db.t.updates, []);
  r = await leadPost('acknowledge', { buyer_id: 'synthetic-buyer', csrf }, asOwner);
  assert.equal(r.res.status, 303); assert.equal(r.db.t.events[0], 'acknowledged');
  r = await leadPost('responded', { buyer_id: 'synthetic-buyer', csrf }, asOwner);
  assert.equal(r.res.status, 303); assert.equal(r.db.t.events[0], 'responded');
  r = await leadPost('assign', { buyer_id: 'synthetic-buyer', csrf, assigned_to: 'agent@hbexperts.com' }, asOwner);
  assert.equal(r.res.status, 303); assert.equal(r.db.t.events[0], 'assigned');
  r = await leadPost('assign', { buyer_id: 'synthetic-buyer', csrf, assigned_to: 'stranger@example.test' }, asOwner);
  assert.equal(r.res.status, 400);
  r = await leadPost('acknowledge', { buyer_id: 'not-a-lead', csrf }, asOwner);
  assert.equal(r.res.status, 404);
});

test('lead panel shows unacknowledged count, delayed marker and default assignee', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const html = leadPanelHtml([{ buyer_id: 'synthetic-buyer', first_name: 'Test', last_name: 'Buyer', submitted_at: '2026-01-01T11:00:00Z', alert_status: 'failed', alert_created_at: '2026-01-01T11:00:00Z', last_error: 'SEND_FAILED' }], { unacknowledged: 1, alertDelayed: 1 }, 'tok', {}, now);
  assert.match(html, /Not yet seen: 1/);
  assert.match(html, /Alert 60 min late/);
  assert.match(html, /Alert email couldn\u2019t send\. The email service turned it down/); assert.doesNotMatch(html, />SEND_FAILED</);
  assert.match(html, /Next: review this lead, then reach out\./); assert.match(html, /I\u2019ve seen it/); assert.match(html, /I\u2019ve reached out/); assert.match(html, /<summary>Change owner<\/summary>/);
  assert.match(html, /value="cwhitehead@hbexperts\.com"/);
  assert.match(html, /name="csrf" value="tok"/);
  assert.match(unacknowledgedBanner({ unacknowledged: 0, alertDelayed: 0 }), /Not yet seen: 0/);
});

// ---------- fix 4: intake guard ----------
const intakeReq = (fields = { email: 'synthetic@example.test' }) => new Request(ORIGIN + '/api/intake', { method: 'POST', body: new URLSearchParams(fields), headers: { 'CF-Connecting-IP': '203.0.113.7', 'content-type': 'application/x-www-form-urlencoded' } });

test('per-IP rate limit returns a friendly 429 that keeps answers', async () => {
  const keys = [];
  const env = { SUBMIT_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  const g = await guardIntake(intakeReq(), env);
  assert.equal(g.action, 'rate_limited');
  assert.equal(g.response.status, 429);
  assert.equal(g.response.headers.get('retry-after'), '60');
  const text = await g.response.text();
  assert.match(text, /still saved in this browser/);
  assert.match(keys[0], /^ip:[0-9a-f]{64}$/);
  assert.doesNotMatch(keys[0], /203\.0\.113\.7/);
});

test('limiter outage and unconfigured Turnstile never block a lead', async () => {
  let fetched = 0;
  const env = { SUBMIT_RATE_LIMITER: { limit: async () => { throw new Error('down'); } }, TURNSTILE_SECRET: 'synthetic-secret', TURNSTILE_SITE_KEY: '' };
  const g = await guardIntake(intakeReq(), env, { fetchImpl: async () => { fetched++; } });
  assert.equal(g.action, 'allow'); assert.equal(g.spamReason, null); assert.equal(fetched, 0);
  assert.equal(turnstileConfig({ TURNSTILE_ENABLED: 'false', TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 's' }), null);
});

test('Turnstile failure flags the lead as suspected spam instead of dropping it', async () => {
  const env = { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: '0xSYNTHETIC', TURNSTILE_SECRET: 'synthetic-secret' };
  const ok = async () => new Response(JSON.stringify({ success: true, action: TURNSTILE_ACTION, hostname: 'buyer.hbexperts.com' }));
  const bad = async () => new Response(JSON.stringify({ success: false }));
  const wrongHost = async () => new Response(JSON.stringify({ success: true, action: TURNSTILE_ACTION, hostname: 'evil.example' }));
  const fields = { email: 'synthetic@example.test', 'cf-turnstile-response': 'tok' };
  assert.equal((await guardIntake(intakeReq(fields), env, { fetchImpl: ok })).spamReason, null);
  assert.equal((await guardIntake(intakeReq(fields), env, { fetchImpl: bad })).spamReason, 'turnstile_failed');
  assert.equal((await guardIntake(intakeReq(fields), env, { fetchImpl: wrongHost })).spamReason, 'turnstile_hostname_mismatch');
  assert.equal((await guardIntake(intakeReq({ email: 'synthetic@example.test' }), env, { fetchImpl: ok })).spamReason, 'turnstile_missing');
  const outage = await verifyTurnstile('tok', '', turnstileConfig(env), { fetchImpl: async () => { throw new Error('net'); } });
  assert.equal(outage.ok, false);
});

test('Turnstile widget + CSP are added only when configured', () => {
  const html = '<html><head></head><body><form id="buyerExperienceForm"><button>Send</button></form></body></html>';
  assert.equal(addTurnstileWidget(html, null), html);
  const out = addTurnstileWidget(html, { siteKey: '0xSYNTHETIC' });
  assert.match(out, /class="cf-turnstile" data-sitekey="0xSYNTHETIC" data-action="buyer_intake"[^>]*><\/div><\/form>/);
  assert.match(out, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  const h = new Headers({ 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
  allowTurnstileCsp(h);
  const csp = h.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
});

// ---------- regression: Acknowledge from the Home Screen app failed CSRF (Oct 27) ----------
function panelDb() {
  const db = leadDb();
  const base = db.prepare.bind(db);
  db.prepare = sql => { const st = base(sql); st.all = async () => ({ results: sql.includes('hbe_lead_status') || sql.includes('notifications') ? [{ buyer_id: 'synthetic-buyer', first_name: 'Test', last_name: 'Buyer', submitted_at: '2026-01-01T11:00:00Z', alert_status: 'sent', alert_created_at: '2026-01-01T11:00:00Z' }] : [] }); const f = st.first; st.first = async () => (await f()) ?? { unacknowledged: 1, alertDelayed: 0, n: 1 }; return st; };
  return db;
}

test('rendered HBEUI lead panel carries a CSRF token the handler accepts, and submits in-page', async () => {
  const { leadPanelForRequest } = await import('../src/lead-response.js');
  const jwt = 'synthetic.jwt.token';
  const env = { BUYER_DB: panelDb(), HBE_ADMIN_EMAIL: OWNER };
  const html = await leadPanelForRequest(new Request(`${ORIGIN}/hbe`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), env);
  for (const a of ['acknowledge', 'responded', 'assign']) assert.match(html, new RegExp(`data-lead-action="${a}"`));
  assert.match(html, /addEventListener\('submit'/);
  assert.match(html, /e\.preventDefault\(\)/);
  assert.match(html, /\/api\/hbe\/lead\/panel/);
  const tokens = [...html.matchAll(/name="csrf" value="([^"]+)"/g)].map(m => m[1]);
  assert.ok(tokens.length >= 3 && tokens.every(t => t && t === tokens[0]));
  // In-page fetch: same origin, same Access JWT, Accept JSON.
  for (const [action, extra] of [['acknowledge', {}], ['responded', {}], ['assign', { assigned_to: 'agent@hbexperts.com' }]]) {
    const r = await leadPost(action, { buyer_id: 'synthetic-buyer', csrf: tokens[0], ...extra }, asOwner, { accept: 'application/json' });
    assert.equal(r.res.status, 200, action);
    assert.deepEqual(await r.res.json(), { ok: true, action });
  }
  // A different Access session (the Safari sheet the plain form POST opened) is rejected as JSON, not a redirect.
  const other = await leadPost('acknowledge', { buyer_id: 'synthetic-buyer', csrf: await mutationCsrfToken('another.session.jwt') }, asOwner, { accept: 'application/json' });
  assert.equal(other.res.status, 403); assert.equal((await other.res.json()).error, 'csrf');
});

test('lead panel refresh route is owner-only and returns fresh HTML and counts', async () => {
  const env = { BUYER_DB: panelDb(), HBE_ADMIN_EMAIL: OWNER };
  const mk = () => new Request(`${ORIGIN}/api/hbe/lead/panel`, { headers: { 'Cf-Access-Jwt-Assertion': 'synthetic.jwt.token', accept: 'application/json' } });
  let res = await handleLeadAction(mk(), env, new URL(`${ORIGIN}/api/hbe/lead/panel`), asStaff);
  assert.equal(res.status, 403);
  res = await handleLeadAction(mk(), env, new URL(`${ORIGIN}/api/hbe/lead/panel`), asOwner);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ok, true); assert.match(d.html, /id="lead-response"/); assert.match(d.html, /Not yet seen:/);
  assert.match(d.html, new RegExp(await mutationCsrfToken('synthetic.jwt.token')));
});

test('alert error codes are shown in plain words with what to do', async () => {
  const { alertErrorText } = await import('../src/lead-response.js');
  assert.match(alertErrorText('EMAIL_BINDING_MISSING'), /^Alert email couldn\u2019t send\. Email sending isn\u2019t set up/);
  assert.match(alertErrorText('SOMETHING_NEW'), /^Alert email couldn\u2019t send\. Reach out to the buyer yourself/);
  assert.equal(alertErrorText(''), '');
});
