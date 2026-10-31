// Synthetic data only: "Test Buyer A/B", example.com addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeD1, makeR2 } from './helpers/d1-sqlite.mjs';
import { makeAuthenticator } from './helpers/fake-authenticator.mjs';
import { handleAgreements, isAgreementPath, agreementBanner, templateApproved, verifyEventChain, BUYER_PUSH_PAYLOAD, STAFF_PUSH_PAYLOAD, SAMPLE_WATERMARK } from '../src/agreement-esign.js';
import { mutationCsrfToken } from '../src/household-state.js';
import { readFileSync } from 'node:fs';
import { GUIDE_PDF_SHA256, GUIDE_PARAGRAPHS } from '../src/consumer-guide.js';
import { V6_PARAGRAPHS } from '../src/agreement-template-v6.js';
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
async function guideViewed(call, id, who) {
  const { cookie, csrf } = who;
  assert.equal((await call('POST', `/api/portal/agreements/${id}/guide/viewed`, { csrf, viewed: true }, { cookie })).status, 200);
}
async function buyerSigns(call, id, who, kind = 'typed') {
  const { auth, cookie, csrf } = who;
  assert.equal((await call('POST', `/api/portal/agreements/${id}/consent`, { csrf, ersd: true }, { cookie })).status, 200);
  await guideViewed(call, id, who);
  assert.equal((await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie })).status, 200);
  const o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const sig = kind === 'typed' ? { signature_kind: 'typed', signature_text: 'Test Buyer' } : { signature_kind: 'drawn', signature_strokes: [[[10, 10], [60, 40], [120, 20]]] };
  return call('POST', `/api/portal/agreements/${id}/sign`, { csrf, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey), guide_acknowledge: true, initials: 'TB', ...sig }, { cookie });
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
  assert.match(preview.body, /Send SAMPLE/); assert.match(preview.body, /\$350,000/);
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
  assert.match(page.body, /Electronic records/); assert.match(page.body, /sign with Face ID/i); assert.match(page.body, /doc-end/);

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
  // sign options before guide + scroll is refused
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie })).body.error, 'review_incomplete');
  await call('POST', `/api/portal/agreements/${id}/guide/viewed`, { csrf, viewed: true }, { cookie });
  await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie });
  const none = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal(none.body.error, 'no_passkey'); assert.match(none.body.message, /paper/);
  // signing without any credential
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { csrf, guide_acknowledge: true, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' }, { cookie })).body.error, 'challenge_invalid');
  const pk = await buyerPasskey(call, 'buyer-a'); const { auth } = pk;
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { csrf, guide_acknowledge: true, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' }, { cookie })).body.error, 'challenge_invalid');
  const base = { csrf, guide_acknowledge: true, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' };
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

test('Consumer Guide + agreement: one session, one passkey assertion bound to both hashes, receipt audited separately', async () => {
  const { db, call } = await setup();
  const c = await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() });
  assert.equal(c.status, 200); assert.equal(c.body.ok, true, 'create must report ok so the staff page can open the preview');
  const id = c.body.id;
  await call('POST', `/api/hbe/agreements/${id}/send`, {});
  const who = await buyerPasskey(call, 'buyer-a'); const { auth, cookie, csrf } = who;
  const pdf = await call('GET', '/portal/consumer-guide.pdf');
  assert.equal(pdf.status, 200); assert.equal(pdf.res.headers.get('content-type'), 'application/pdf');
  assert.equal(createHash('sha256').update(Buffer.from(pdf.body)).digest('hex'), GUIDE_PDF_SHA256);
  // order: consent -> guide viewed -> agreement read
  assert.equal((await call('POST', `/api/portal/agreements/${id}/guide/viewed`, { csrf, viewed: true }, { cookie })).body.error, 'consent_first');
  await call('POST', `/api/portal/agreements/${id}/consent`, { csrf, ersd: true }, { cookie });
  assert.equal((await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie })).body.error, 'consumer_guide_first');
  // separate guide passkey endpoints are gone
  assert.equal((await call('POST', `/api/portal/agreements/${id}/guide/options`, { csrf }, { cookie })).status, 404);
  assert.equal((await call('POST', `/api/portal/agreements/${id}/guide/ack`, { csrf }, { cookie })).status, 404);
  // one page: guide first, then agreement, one sign button
  const pageHtml = (await call('GET', `/portal/agreements?id=${id}`, null, { cookie })).body;
  const gi = pageHtml.indexOf('2. Ohio Consumer Guide to Agency Relationships'), ai = pageHtml.indexOf('3. Read the whole agreement');
  assert.ok(gi > 0 && ai > gi); assert.match(pageHtml, /HomeBuyer Experts only represents buyers/);
  assert.match(pageHtml, /id="gack"/); assert.equal((pageHtml.match(/hbePasskeyGet\(o\.publicKey\)/g) || []).length, 1);
  assert.ok(!GUIDE_PARAGRAPHS.join(' ').includes('(brokerage)'));
  await call('POST', `/api/portal/agreements/${id}/guide/viewed`, { csrf, viewed: true }, { cookie });
  await call('POST', `/api/portal/agreements/${id}/viewed`, { csrf, scrolled: true }, { cookie });
  const o = await call('POST', `/api/portal/agreements/${id}/sign/options`, { csrf }, { cookie });
  assert.equal(o.status, 200); assert.equal(o.body.guide_sha256, GUIDE_PDF_SHA256);
  const inst = await db.prepare(`SELECT doc_sha256 FROM agreement_instances WHERE id=?`).bind(id).first();
  assert.equal(o.body.doc_sha256, inst.doc_sha256);
  assert.equal(o.body.bundle_sha256, createHash('sha256').update(`hbe-bundle-v1|consumer_guide:${GUIDE_PDF_SHA256}|agreement:${inst.doc_sha256}`).digest('hex'));
  const base = { csrf, initials: 'TB', signature_kind: 'typed', signature_text: 'Test Buyer' };
  // guide receipt checkbox is required in the same submission (checked before the challenge is consumed)
  assert.equal((await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) }, { cookie })).body.error, 'guide_receipt_required');
  const r = await call('POST', `/api/portal/agreements/${id}/sign`, { ...base, guide_acknowledge: true, challenge_id: o.body.challenge_id, credential: await auth.get(o.body.publicKey) }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await db.prepare(`SELECT guide_sha256, guide_version, guide_ack_at, guide_passkey_credential_id, passkey_credential_id, signed_at FROM agreement_signers WHERE instance_id=? AND role='buyer' AND buyer_id='buyer-a'`).bind(id).first();
  assert.equal(s.guide_sha256, GUIDE_PDF_SHA256); assert.equal(s.guide_version, 'ohio-effective-2024-10-24');
  assert.equal(s.guide_ack_at, s.signed_at); assert.equal(s.guide_passkey_credential_id, s.passkey_credential_id);
  const evs = (await db.prepare(`SELECT event, doc_sha256, detail_json AS detail FROM agreement_events WHERE instance_id=? ORDER BY rowid`).bind(id).all()).results;
  const ev = evs.map(e => e.event);
  assert.ok(ev.indexOf('ersd_consented') < ev.indexOf('consumer_guide_viewed') && ev.indexOf('consumer_guide_viewed') < ev.indexOf('scrolled_to_end') && ev.indexOf('scrolled_to_end') < ev.indexOf('consumer_guide_acknowledged') && ev.indexOf('consumer_guide_acknowledged') < ev.indexOf('buyer_signed'));
  const g = evs.find(e => e.event === 'consumer_guide_acknowledged'), b = evs.find(e => e.event === 'buyer_signed');
  assert.equal(g.doc_sha256, GUIDE_PDF_SHA256); assert.equal(b.doc_sha256, inst.doc_sha256);
  assert.equal(JSON.parse(g.detail).bundle_sha256, o.body.bundle_sha256); assert.equal(JSON.parse(b.detail).bundle_sha256, o.body.bundle_sha256);
  assert.ok(await verifyEventChain({ BUYER_DB: db }, id));
});

test('staff create page: accepts buyer= and buyer_id=, client names invalid fields and shows HTTP status for non-JSON', async () => {
  const { call } = await setup();
  for (const q of ['buyer', 'buyer_id']) {
    const r = await call('GET', `/hbe/agreements/new?${q}=buyer-a`);
    assert.equal(r.status, 200); assert.match(r.body, /data-k="term_end"/); assert.match(r.body, /please check/); assert.match(r.body, /scrollIntoView/); assert.match(r.body, /HTTP '\+r\.status/);
  }
  const bad = await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: { ...FIELDS(), price_max: 'abc', term_end: '' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.ok, false); assert.deepEqual(bad.body.errors.sort(), ['price_max', 'term_end']);
});

test('template v6 carries the Ohio 4735.55 statements', () => {
  const t = V6_PARAGRAPHS.join('\n');
  assert.ok(t.includes('BROKER FEES AND COMMISSIONS ARE NOT SET BY LAW, ARE FULLY NEGOTIABLE, AND MAY BE PAID BY THE SELLER, THE BUYER, THE LANDLORD, THE TENANT, OR A THIRD PARTY, OR BY SHARING OR SPLITTING THE FEES AND COMMISSIONS BETWEEN BROKERS.'));
  assert.match(t, /Blockbusting is illegal and defined as/); assert.match(t, /42 U\.S\.C\.A\. 3601, as amended/);
  assert.match(t, /\[\[EHO\]\]EQUAL HOUSING OPPORTUNITY/);
});

test('passkey pages: safe return param, success + return button, no dead ends', async () => {
  const { safeReturn, passkeyLink } = await import('../src/agreement-esign.js');
  for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/portal/x', '/hbe/passkey', '', '/hbe\n/x'])
    assert.equal(safeReturn(bad, 'staff'), '/hbe', bad);
  assert.equal(safeReturn('/hbe/agreements/abc', 'staff'), '/hbe/agreements/abc');
  assert.equal(safeReturn('/portal/agreements?id=1', 'buyer'), '/portal/agreements?id=1');
  assert.equal(safeReturn('/hbe/agreements/abc', 'buyer'), '/portal/agreements');
  assert.equal(safeReturn('https://evil.example', 'buyer'), '/portal/agreements');
  assert.match(passkeyLink('staff', '/hbe/agreements/a'), /^\/hbe\/passkey\?return=%2Fhbe%2Fagreements%2Fa$/);
  const { call } = await setup();
  const st = (await call('GET', '/hbe/passkey?return=%2F%2Fevil.example')).body;
  assert.match(st, /href="\/hbe">\u2190 Back/); assert.doesNotMatch(st, /evil\.example/); assert.match(st, /Face ID is set up\./);
  const st2 = (await call('GET', '/hbe/passkey?return=%2Fhbe%2Fagreements%2Fabc')).body;
  assert.match(st2, /href="\/hbe\/agreements\/abc"/); assert.match(st2, /Return to the agreement/);
  const bu = (await call('GET', '/portal/passkey?return=https%3A%2F%2Fevil.example', null, { cookie: 'tok-buyer-a' })).body;
  assert.match(bu, /href="\/portal\/agreements"/); assert.doesNotMatch(bu, /evil\.example/);
  const id = (await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).body.id;
  const pv = (await call('GET', `/hbe/agreements/${id}`)).body;
  assert.match(pv, /HBE dashboard/); assert.match(pv, /passkey\?return=%2Fhbe%2Fagreements%2F/);
  assert.match((await call('GET', '/portal/agreements', null, { cookie: 'tok-buyer-a' })).body, /Back to my portal/);
});

test('mobile layout: compact summary, action bar, single $ in price, passkey link hidden once set up', async () => {
  const { renderParagraphs } = await import('../src/agreement-esign.js');
  const t = renderParagraphs({ price_max: 500000, term_end: '2026-11-30' }).join(' ');
  assert.match(t, /up to \$500,000\./); assert.doesNotMatch(t, /\$\$/);
  const { call, db } = await setup();
  const id = (await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).body.id;
  let pv = (await call('GET', `/hbe/agreements/${id}`)).body;
  assert.match(pv, /<details class="sum"><summary>/); assert.match(pv, /Draft \u00b7 \d+ signers? waiting/);
  assert.doesNotMatch(pv, /set on send/); assert.match(pv, /<div class="bar"><button class="btn wide" id="send">/);
  assert.match(pv, /class="btn2"[^>]*>PDF</); assert.doesNotMatch(pv, /\$\$/);
  assert.match(pv, /Set up my passkey/);
  await db.prepare(`INSERT INTO passkey_credentials (id,owner_kind,owner_id,credential_id,public_key_jwk,alg,sign_count,user_handle,device_label,created_at) VALUES ('pk1','staff',?,'cred1','{}',-7,0,'h','t','2026-01-01')`).bind(OWNER).run();
  await call('POST', `/api/hbe/agreements/${id}/send`, {});
  pv = (await call('GET', `/hbe/agreements/${id}`)).body;
  assert.match(pv, /Doc SHA-256: [0-9a-f]{64}/); assert.doesNotMatch(pv, /Set up my passkey/);
  const bp = (await call('GET', `/portal/agreements?id=${id}`, null, { cookie: 'tok-buyer-a' })).body;
  assert.match(bp, /<details class="sum">/); assert.match(bp, /<div class="bar"><button class="btn wide" id="sign" disabled/); assert.doesNotMatch(bp, /\$\$/);
});

test('hire-us path: plain step labels on form and preview', async () => {
  const { call } = await setup();
  const f = (await call('GET', '/hbe/agreements/new?buyer=buyer-a')).body;
  assert.match(f, /<b>1 Fill in<\/b> \u2192 2 Preview \u2192 3 Send to sign/); assert.match(f, />Preview agreement</);
  const id = (await call('POST', '/api/hbe/agreements', { buyer_id: 'buyer-a', fields: FIELDS() })).body.id;
  assert.match((await call('GET', `/hbe/agreements/${id}`)).body, /<b>2 Preview<\/b>/);
  await call('POST', `/api/hbe/agreements/${id}/send`, {});
  assert.match((await call('GET', `/hbe/agreements/${id}`)).body, /<b>3 Sent<\/b>/);
});

test('case card: one clear hire-us button to the agreement form at Consultation', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/hbe-worker.js', import.meta.url), 'utf8');
  assert.equal(src.split('They\u2019re hiring us: open the next chapter').length - 1, 1);
  assert.match(src, /b\.stage === 'consultation' \? `<section class="next-chapter" id="open-next-chapter"><a class="btn hire-btn" href="\/hbe\/agreements\/new\?buyer=\$\{encodeURIComponent\(b\.id\)\}">/);
});
