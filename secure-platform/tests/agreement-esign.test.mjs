// Synthetic data only: "Test Buyer A/B", example.com addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeD1, makeR2 } from './helpers/d1-sqlite.mjs';
import { makeAuthenticator } from './helpers/fake-authenticator.mjs';
import { handleAgreements, isAgreementPath, agreementBanner, templateApproved, verifyEventChain, BUYER_PUSH_PAYLOAD, STAFF_PUSH_PAYLOAD, SAMPLE_WATERMARK } from '../src/agreement-esign.js';
import { mutationCsrfToken } from '../src/household-state.js';
import { readFileSync } from 'node:fs';
const R = f => new URL('../' + f, import.meta.url).pathname;

const ORIGIN = 'https://buyer.example.test';
const OWNER = 'broker@example.com';
const sha = s => createHash('sha256').update(s).digest('hex');

async function setup() {
  const db = makeD1([R('schema.sql'), R('migrations/agreements-esign.sql')]);
  const now = new Date().toISOString(); const later = new Date(Date.now() + 3600e3).toISOString();
  for (const [id, fn] of [['buyer-a', 'Test Buyer'], ['buyer-b', 'Test CoBuyer']]) {
    await db.prepare(`INSERT INTO buyers (id,created_at,submitted_at,updated_at,first_name,last_name,email,stage,answers_json,access_code_hash) VALUES (?,?,?,?,?,?,?,'consultation','{}','x')`).bind(id, now, now, now, fn, id === 'buyer-a' ? 'A' : 'B', `${id}@example.com`).run();
    await db.prepare(`INSERT INTO buyer_sessions (id,buyer_id,token_hash,created_at,last_seen_at,expires_at,remembered) VALUES (?,?,?,?,?,?,0)`).bind('s-' + id, id, sha('tok-' + id), now, now, later).run();
  }
  const env = { BUYER_DB: db, AGREEMENTS: makeR2(), HBE_OWNER_EMAIL: OWNER, WEBAUTHN_RP_ID: 'buyer.example.test', WEBAUTHN_ORIGIN: ORIGIN };
  const pushes = [];
  const send = async (sub, payload) => { pushes.push(payload); return { ok: true, status: 201 }; };
  const staff = email => ({ authenticate: async () => ({ ok: true, professional: { email, role: 'broker_admin' } }), send });
  const call = async (method, path, body, { cookie, as = OWNER, origin = ORIGIN } = {}) => {
    const headers = { origin };
    if (cookie) headers.cookie = `hbe_session=${cookie}`;
    if (body) headers['content-type'] = 'application/json';
    const req = new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const res = await handleAgreements(req, env, new URL(req.url), staff(as));
    const type = res.headers.get('content-type') || '';
    return { res, status: res.status, body: type.includes('json') ? await res.json() : type.includes('html') ? await res.text() : await res.arrayBuffer() };
  };
  return { db, env, call, pushes };
}
const future = () => new Date(Date.now() + 90 * 86400e3).toISOString().slice(0, 10);
const FIELDS = () => ({ term_end: future(), price_max: '350000', retainer_option: 'standard', additional_provisions: '' });

async function buyerPasskey(call, buyer) {
  const auth = await makeAuthenticator({ rpId: 'buyer.example.test', origin: ORIGIN });
  const cookie = 'tok-' + buyer; const csrf = await mutationCsrfToken(cookie);
  const o = await call('POST', '/api/portal/passkey/register/options', { csrf }, { cookie });
  assert.equal(o.status, 200); assert.equal(o.body.publicKey.authenticatorSelection.userVerification, 'required');
  const v = await call('POST', '/api/portal/passkey/register/verify', { csrf, challenge_id: o.body.challenge_id, credential: await auth.create(o.body.publicKey) }, { cookie });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return { auth, cookie, csrf };
}
async function buyerSigns(call, id, who, kind = 'typed') {
  const { auth, cookie, csrf } = who;
  assert.equal((await call('POST', `/api/portal/agreements/${id}/consent`, { csrf, ersd: true }, { cookie })).status, 200);
  assert.equal((await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie })).status, 200);
  const o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const sig = kind === 'typed' ? { signature_kind: 'typed', signature_text: 'Test Buyer' } : { signature_kind: 'drawn', signature_strokes: [[[10, 10], [60, 40], [120, 20]]] };
  return call('POST', `/api/portal/agreements/${id}/sign`, { csrf, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey), initials: 'TB', ...sig }, { cookie });
}

test('paths are routed and template starts unapproved; no code sets approved', async () => {
  assert.ok(isAgreementPath('/hbe/agreements/new')); assert.ok(isAgreementPath('/api/portal/passkey/login/options')); assert.ok(!isAgreementPath('/portal'));
  const src = readFileSync(R('src/agreement-esign.js'), 'utf8');
  assert.ok(!/UPDATE\s+agreement_templates/i.test(src), 'no code path may update agreement_templates');
  assert.ok(!/SET\s+approved/i.test(src));
  assert.match(src, /INSERT OR IGNORE INTO agreement_templates \(id,name,version,body_sha256,approved,created_at\) VALUES \(\?,\?,\?,\?,0,\?\)/);
});

test('end to end SAMPLE: create, send, two buyers sign with passkey, broker countersigns, PDF stored', async () => {
  const { db, env, call, pushes } = await setup();
  db.raw.exec(`INSERT INTO buyer_cases (id,created_at,updated_at) VALUES ('case-1','2026-01-01','2026-01-01');
    INSERT INTO buyer_case_members (case_id,buyer_id,role,created_at) VALUES ('case-1','buyer-a','primary','2026-01-01'),('case-1','buyer-b','co_buyer','2026-01-01');`);
  const form = await call('GET', '/hbe/agreements/new?buyer=buyer-a');
  assert.equal(form.status, 200); assert.match(form.body, /Open the next chapter/); assert.match(form.body, /SAMPLE/);
  const c = await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.sample, true);
  const id = c.body.id;
  const preview = await call('GET', `/hbe/agreements/${id}`);
  assert.match(preview.body, /Send SAMPLE for signature/); assert.match(preview.body, /\$350,000/);
  const pdf0 = Buffer.from((await call('GET', `/hbe/agreements/${id}/document.pdf`)).body).toString('latin1');
  assert.match(pdf0, /^%PDF-1\.4/); assert.match(pdf0, /SAMPLE - NOT FOR SIGNATURE/);

  const a = await buyerPasskey(call, 'buyer-a'); const b = await buyerPasskey(call, 'buyer-b');
  await db.prepare(`INSERT INTO buyer_push_subscriptions (id,buyer_id,endpoint,p256dh,auth,created_at) VALUES ('p1','buyer-a','https://fcm.googleapis.com/x','k','a','2026-01-01')`).run();
  await db.prepare(`INSERT INTO hbe_push_subscriptions (id,staff_email,endpoint,p256dh,auth,created_at,updated_at) VALUES ('h1',?,'https://fcm.googleapis.com/y','k','a','2026-01-01','2026-01-01')`).bind(OWNER).run();
  env.VAPID_PUBLIC_KEY = 'B'.repeat(87); env.VAPID_PRIVATE_KEY = 'a'.repeat(43);
  // Banner hidden before send
  assert.equal(await agreementBanner(new Request(ORIGIN + '/portal', { headers: { cookie: 'hbe_session=tok-buyer-a' } }), env), '');
  const s = await call('POST', `/api/hbe/agreements/${id}/send`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.sample, true); assert.equal(s.body.pushed, 1);
  assert.deepEqual(pushes[0], BUYER_PUSH_PAYLOAD);
  assert.ok(!JSON.stringify(pushes).includes('Test'), 'no names in push payload');
  assert.match(await agreementBanner(new Request(ORIGIN + '/portal', { headers: { cookie: 'hbe_session=tok-buyer-a' } }), env), /Something to review and sign/);
  const page = await call('GET', `/portal/agreements?id=${id}`, null, { cookie: a.cookie });
  assert.match(page.body, /Electronic records/); assert.match(page.body, /Sign with Face ID/); assert.match(page.body, /doc-end/);

  // Countersign before buyers sign is refused
  assert.equal((await call('POST', `/api/hbe/agreements/${id}/countersign`, { signature_text: 'Broker', consent: true })).status, 409);
  const r1 = await buyerSigns(call, id, a, 'typed'); assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.agreement_status, 'partially_signed');
  const r2 = await buyerSigns(call, id, b, 'drawn'); assert.equal(r2.body.agreement_status, 'buyers_signed');
  // Non-owner staff cannot countersign
  assert.equal((await call('POST', `/api/hbe/agreements/${id}/countersign`, { signature_text: 'X Y', consent: true }, { as: 'agent@example.com' })).status, 403);
  // Broker countersigns with a passkey
  const bauth = await makeAuthenticator({ rpId: 'buyer.example.test', origin: ORIGIN });
  const ro = await call('POST', '/api/hbe/passkey/register/options', {});
  assert.equal((await call('POST', '/api/hbe/passkey/register/verify', { challenge_id: ro.body.challenge_id, credential: await bauth.create(ro.body.publicKey) })).status, 200);
  const co = await call('POST', `/api/hbe/agreements/${id}/countersign/options`, {});
  assert.equal(co.body.method, 'passkey');
  const cs = await call('POST', `/api/hbe/agreements/${id}/countersign`, { challenge_id: co.body.challenge_id, credential: await bauth.get(co.body.publicKey), signature_text: 'Test Broker', consent: true });
  assert.equal(cs.status, 200, JSON.stringify(cs.body));
  const stored = env.AGREEMENTS.m.get(`agreements/${id}/executed.pdf`);
  assert.ok(stored); const txt = Buffer.from(stored.body).toString('latin1');
  assert.match(txt, /CERTIFICATE OF COMPLETION/); assert.match(txt, /SAMPLE - NOT FOR SIGNATURE/);
  assert.equal(createHash('sha256').update(stored.body).digest('hex'), cs.body.final_sha256);
  assert.ok(await verifyEventChain(env, id));
  const cert = await call('GET', `/portal/agreements/${id}/certificate`, null, { cookie: a.cookie });
  assert.match(cert.body, /Audit chain intact/);
  assert.ok(pushes.some(p => p.body === STAFF_PUSH_PAYLOAD.body));
  assert.ok(await templateApproved(env) === false);
});

test('passkey is required: no passkey, no UV, wrong origin, replayed challenge, tampered doc all fail', async () => {
  const { db, env, call } = await setup();
  const id = (await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).body.id;
  await call('POST', `/api/hbe/agreements/${id}/send`, {});
  const cookie = 'tok-buyer-a', csrf = await mutationCsrfToken(cookie);
  await call('POST', `/api/portal/agreements/${id}/consent`, { csrf, ersd: true }, { cookie });
  // sign options before scroll is refused
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie })).body.error, 'review_incomplete');
  await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie });
  const none = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal(none.body.error, 'no_passkey'); assert.match(none.body.message, /paper/);
  // signing without any credential
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { csrf, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' }, { cookie })).status, 400);
  const { auth } = await buyerPasskey(call, 'buyer-a');
  const base = { csrf, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' };
  // no user verification
  let o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  auth.setUv(false);
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) }, { cookie })).body.error, 'passkey_failed');
  auth.setUv(true);
  // replay of a used challenge
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) }, { cookie })).body.error, 'challenge_invalid');
  // wrong origin in clientData
  o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey, { originOverride: 'https://evil.example' }) }, { cookie })).body.error, 'passkey_failed');
  // document changed after challenge issued
  o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  await db.prepare(`UPDATE agreement_instances SET doc_sha256='tampered' WHERE id=?`).bind(id).run();
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) }, { cookie })).body.error, 'document_changed');
  // CSRF and cross-origin are enforced
  assert.equal((await call('POST', `/api/portal/agreements/${id}/consent`, { csrf: 'bad', ersd: true }, { cookie })).status, 403);
  assert.equal((await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() }, { origin: 'https://evil.example' })).status, 403);
});

test('guards: stage must be Consultation, fields validated, storage fails closed, other buyers cannot see it', async () => {
  const { db, env, call } = await setup();
  assert.equal((await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: { ...FIELDS(), term_end: '2001-01-01' } })).status, 400);
  const id = (await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).body.id;
  assert.equal((await call('GET', `/portal/agreements?id=${id}`, null, { cookie: 'tok-buyer-b' })).status, 404);
  await db.prepare(`UPDATE buyers SET stage='representation' WHERE id='buyer-a'`).run();
  assert.equal((await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).status, 409);
  await db.prepare(`UPDATE agreement_instances SET status='buyers_signed' WHERE id=?`).bind(id).run();
  delete env.AGREEMENTS;
  assert.equal((await call('POST', `/api/hbe/agreements/${id}/countersign`, { signature_text: 'Test Broker', consent: true })).status, 503);
  assert.ok(SAMPLE_WATERMARK.startsWith('SAMPLE'));
});

test('buyer passkey sign-in creates a session', async () => {
  const { db, call } = await setup();
  const { auth } = await buyerPasskey(call, 'buyer-a');
  const o = await call('POST', '/api/portal/passkey/login/options', {});
  const v = await call('POST', '/api/portal/passkey/login/verify', { challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) });
  assert.equal(v.status, 200); assert.match(v.res.headers.get('set-cookie'), /^hbe_session=.*HttpOnly; Secure; SameSite=Lax/);
  const n = await db.prepare(`SELECT COUNT(*) n FROM buyer_sessions WHERE buyer_id='buyer-a'`).first(); assert.equal(n.n, 2);
});
