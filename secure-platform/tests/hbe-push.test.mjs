import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { encryptPayload, vapidAuthorization, b64uEncode } from '../src/web-push.js';
import { handleHbeApp, isHbeAppPath, enqueuePushAlert, deliverPushAlert, pushPayload, pushHealth, MANIFEST, SERVICE_WORKER, validateSubscription } from '../src/hbe-push.js';

const OWNER = 'cwhitehead@hbexperts.com';
const vapidPair = () => {
  const k = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = k.privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { VAPID_PUBLIC_KEY: b64uEncode(pub), VAPID_PRIVATE_KEY: jwk.d };
};
const uaKeys = () => { const e = nodeCrypto.createECDH('prime256v1'); e.generateKeys(); return { ecdh: e, auth: nodeCrypto.randomBytes(16), p256dh: b64uEncode(e.getPublicKey()) }; };

function fakeDb() {
  const t = { subs: new Map(), alerts: new Map(), log: [], buyers: new Map([['b1', { first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.com' }]]) };
  const db = { t, prepare(sql) { const st = { bind(...a) { return {
    async run() {
      if (sql.includes('INSERT OR IGNORE INTO hbe_push_alerts') && sql.includes('VALUES')) {
        if (t.alerts.has(a[0])) return { meta: { changes: 0 } };
        t.alerts.set(a[0], { id: a[0], kind: a[1], ref_id: a[2], buyer_id: a[3], action: a[4], status: 'pending', attempts: 0, created_at: a[5] }); return { meta: { changes: 1 } };
      }
      if (sql.includes('INSERT OR IGNORE INTO hbe_push_alerts')) return { meta: { changes: 0 } };
      if (sql.includes("SET status='sending'")) { const r = t.alerts.get(a[2]); if (!r || r.attempts >= a[3] || !['pending', 'failed'].includes(r.status)) return { meta: { changes: 0 } }; r.status = 'sending'; r.attempts++; return { meta: { changes: 1 } }; }
      if (sql.startsWith('UPDATE hbe_push_alerts SET status=?')) { const r = t.alerts.get(a[4]); r.status = a[0]; r.error_code = a[1]; return { meta: { changes: 1 } }; }
      if (sql.includes('INSERT INTO hbe_push_dispatch_log')) { t.log.push({ alert_id: a[0], subscription_id: a[1], http_status: a[2], outcome: a[3], provider_reason: a[4], created_at: a[5] }); return { meta: { changes: 1 } }; }
      if (sql.startsWith('DELETE FROM hbe_push_subscriptions WHERE id=? AND')) { const s = t.subs.get(a[0]); if (s && s.staff_email === a[1]) t.subs.delete(a[0]); return { meta: { changes: 1 } }; }
      if (sql.startsWith('DELETE FROM hbe_push_subscriptions')) { t.subs.delete(a[0]); return { meta: { changes: 1 } }; }
      if (sql.startsWith('UPDATE hbe_push_subscriptions')) return { meta: { changes: 1 } };
      if (sql.startsWith('INSERT INTO hbe_push_subscriptions')) { t.subs.set(a[0], { id: a[0], staff_email: a[1], endpoint: a[2], p256dh: a[3], auth: a[4] }); return { meta: { changes: 1 } }; }
      throw new Error('unexpected run: ' + sql);
    },
    async first() {
      if (sql.includes('FROM hbe_push_alerts p LEFT JOIN buyers')) { const r = t.alerts.get(a[0]); return r ? { ...r, first_name: t.buyers.get(r.buyer_id)?.first_name } : null; }
      if (sql.includes('COUNT(*) AS c FROM hbe_push_subscriptions')) return { c: t.subs.size };
      if (sql.includes('COUNT(*) AS c FROM hbe_push_alerts')) return { c: [...t.alerts.values()].filter(r => ['pending', 'sending', 'failed'].includes(r.status)).length };
      if (sql.includes('FROM hbe_push_dispatch_log')) return t.log.at(-1) || null;
      return null;
    },
    async all() {
      if (sql.includes('FROM hbe_push_subscriptions WHERE staff_email')) return { results: [...t.subs.values()].filter(s => s.staff_email === a[0]) };
      return { results: [] };
    } }; } }; return { ...st, ...st.bind() }; } };
  return db;
}
const env = (extra = {}) => ({ BUYER_DB: fakeDb(), HBE_ADMIN_EMAIL: OWNER, ...vapidPair(), ...extra });
const asOwner = { authenticate: async () => ({ ok: true, professional: { email: OWNER } }) };
const asStaff = { authenticate: async () => ({ ok: true, professional: { email: 'agent@hbexperts.com' } }) };
const noAuth = { authenticate: async () => ({ ok: false, response: new Response('login', { status: 302 }) }) };
const post = (path, body, origin = 'https://buyer.hbexperts.com') => new Request('https://buyer.hbexperts.com' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const appleSub = (u = uaKeys(), n = 1) => ({ endpoint: `https://web.push.apple.com/QAB${n}xyz`, keys: { p256dh: u.p256dh, auth: b64uEncode(u.auth) } });
const call = (e, req, opts) => handleHbeApp(req, e, new URL(req.url), opts);

test('subscription endpoints require Cloudflare Access + owner identity + trusted origin', async () => {
  const e = env();
  assert.equal((await call(e, post('/api/hbe/push/subscribe', { subscription: appleSub() }), noAuth)).status, 302);
  assert.equal((await call(e, post('/api/hbe/push/subscribe', { subscription: appleSub() }), asStaff)).status, 403);
  assert.equal((await call(e, new Request('https://buyer.hbexperts.com/hbe/app'), asStaff)).status, 403);
  assert.equal((await call(e, post('/api/hbe/push/subscribe', { subscription: appleSub() }, 'https://evil.example'), asOwner)).status, 403);
  assert.equal((await call(e, post('/api/hbe/push/test', {}), noAuth)).status, 302);
  assert.equal(e.BUYER_DB.t.subs.size, 0);
  assert.equal((await call(e, post('/api/hbe/push/subscribe', { subscription: { endpoint: 'https://attacker.example/x', keys: appleSub().keys } }), asOwner)).status, 400);
  const ok = await call(e, post('/api/hbe/push/subscribe', { subscription: appleSub() }), asOwner);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.devices, 1);
  assert.ok(j.registered_at, 'visible confirmation timestamp for re-register');
  assert.equal([...e.BUYER_DB.t.subs.values()][0].staff_email, OWNER);
  const cfg = await call(e, new Request('https://buyer.hbexperts.com/api/hbe/push/config'), asOwner);
  assert.equal((await cfg.json()).publicKey, e.VAPID_PUBLIC_KEY);
  assert.doesNotMatch(JSON.stringify(await (await call(e, new Request('https://buyer.hbexperts.com/api/hbe/push/config'), asOwner)).json()), new RegExp(e.VAPID_PRIVATE_KEY));
});

test('payload is minimal: first name + action + record link only', () => {
  const p = pushPayload({ id: 'activity:1', kind: 'activity', action: '/api/search/confirm', buyer_id: 'b1', first_name: 'Alex Marie' });
  assert.deepEqual(p, { title: 'HBE', body: 'Alex: Confirmed their home-search profile', url: '/hbe?buyer=b1', tag: 'activity:1' });
  assert.equal(pushPayload({ id: 'intake:n', kind: 'intake', action: '/api/intake', buyer_id: 'b1', first_name: 'Alex' }).body, 'Alex: Submitted the buyer questionnaire');
  assert.doesNotMatch(JSON.stringify(p), /Rivera|@|phone/i);
});

test('dispatch: accepted + pruned (410) logged per alert; prune deletes subscription', async () => {
  const e = env();
  e.BUYER_DB.t.subs.set('s1', { id: 's1', staff_email: OWNER, ...flat(appleSub(uaKeys(), 1)) });
  e.BUYER_DB.t.subs.set('s2', { id: 's2', staff_email: OWNER, ...flat(appleSub(uaKeys(), 2)) });
  const sent = [];
  const send = async (sub, payload) => { sent.push(payload); return sub.endpoint.includes('QAB1') ? { status: 201, ok: true } : { status: 410, ok: false, reason: 'Unregistered' }; };
  const id = await enqueuePushAlert(e, 'activity', 'a1', 'b1', '/api/household/invite');
  const r = await deliverPushAlert(e, id, { send });
  assert.equal(r.status, 'sent');
  assert.deepEqual(r.results.map(x => x.outcome), ['accepted', 'pruned']);
  assert.equal(e.BUYER_DB.t.log.length, 2);
  assert.ok(!e.BUYER_DB.t.subs.has('s2'));
  assert.equal(sent[0].body, 'Alex: Invited a co-buyer');
  const h = await pushHealth(e);
  assert.equal(h.subscriptions, 1);
  assert.equal(h.last_result.outcome, 'pruned');
  assert.doesNotMatch(JSON.stringify(h), /Alex|apple\.com|b1/);
});

function flat(s) { return { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }; }

test('no subscriptions: nothing is sent; provider failure is retryable', async () => {
  const e = env();
  let calls = 0;
  const id = await enqueuePushAlert(e, 'intake', 'n1', 'b1', '/api/intake');
  assert.equal((await deliverPushAlert(e, id, { send: async () => { calls++; return { status: 201, ok: true }; } })).status, 'no_subscribers');
  assert.equal(calls, 0);
  e.BUYER_DB.t.subs.set('s1', { id: 's1', staff_email: OWNER, ...flat(appleSub()) });
  const id2 = await enqueuePushAlert(e, 'intake', 'n2', 'b1', '/api/intake');
  assert.equal((await deliverPushAlert(e, id2, { send: async () => ({ status: 503, ok: false }) })).status, 'failed');
  assert.equal((await deliverPushAlert(e, id2, { send: async () => ({ status: 201, ok: true }) })).status, 'sent');
});

test('dedupe: one push alert per activity/intake id; re-delivery is skipped', async () => {
  const e = env();
  e.BUYER_DB.t.subs.set('s1', { id: 's1', staff_email: OWNER, ...flat(appleSub()) });
  let calls = 0; const send = async () => { calls++; return { status: 201, ok: true }; };
  const id = await enqueuePushAlert(e, 'activity', 'same', 'b1', '/api/search/profile');
  assert.equal(await enqueuePushAlert(e, 'activity', 'same', 'b1', '/api/search/profile'), null);
  await deliverPushAlert(e, id, { send });
  assert.equal((await deliverPushAlert(e, id, { send })).status, 'skipped');
  assert.equal(calls, 1);
});

test('test-notification button sends only to the owner devices and reports results', async () => {
  const e = env();
  e.BUYER_DB.t.subs.set('s1', { id: 's1xxxxxxxxxxxx', staff_email: OWNER, ...flat(appleSub()) });
  const r = await call(e, post('/api/hbe/push/test', {}), { ...asOwner, send: async () => ({ status: 201, ok: true }) });
  const j = await r.json();
  assert.equal(j.status, 'sent');
  assert.equal(j.results[0].outcome, 'accepted');
});

test('aes128gcm payload decrypts with the subscriber key (RFC 8291) and VAPID JWT verifies', async () => {
  const u = uaKeys();
  const body = Buffer.from(await encryptPayload({ p256dh: u.p256dh, auth: b64uEncode(u.auth) }, 'hello'));
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPub = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const shared = u.ecdh.computeSecret(asPub);
  const hk = (s, ikm, info, n) => Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, s, info, n));
  const ikm = hk(u.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), u.ecdh.getPublicKey(), asPub]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(pt.subarray(0, -1).toString(), 'hello'); assert.equal(pt.at(-1), 2);
  const k = vapidPair();
  const h = await vapidAuthorization('https://web.push.apple.com/abc', { publicKey: k.VAPID_PUBLIC_KEY, privateKey: k.VAPID_PRIVATE_KEY, subject: 'mailto:' + OWNER });
  const [hd, cl, sig] = h.match(/t=([^,]+)/)[1].split('.');
  const pubBuf = Buffer.from(k.VAPID_PUBLIC_KEY, 'base64url');
  const pub = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64uEncode(pubBuf.subarray(1, 33)), y: b64uEncode(pubBuf.subarray(33)) }, format: 'jwk' });
  assert.ok(nodeCrypto.verify('sha256', Buffer.from(hd + '.' + cl), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(cl, 'base64url')).aud, 'https://web.push.apple.com');
});

test('installable app: manifest, service worker, icons, apple meta tags, buttons', async () => {
  const e = env();
  assert.equal(MANIFEST.name, 'HBE'); assert.equal(MANIFEST.display, 'standalone');
  assert.ok(MANIFEST.icons.some(i => i.sizes === '180x180'));
  assert.match(SERVICE_WORKER, /addEventListener\('push'/); assert.match(SERVICE_WORKER, /notificationclick/);
  const sw = await call(e, new Request('https://buyer.hbexperts.com/hbe/app-sw.js'), noAuth);
  assert.equal(sw.headers.get('service-worker-allowed'), '/hbe');
  const icon = await call(e, new Request('https://buyer.hbexperts.com/hbe/app-icon-180.png'), noAuth);
  assert.deepEqual([...new Uint8Array(await icon.arrayBuffer()).slice(1, 4)], [80, 78, 71]);
  const page = await (await call(e, new Request('https://buyer.hbexperts.com/hbe/app'), asOwner)).text();
  for (const s of ['apple-mobile-web-app-capable', 'apple-touch-icon', 'rel="manifest"', 'Enable notifications', 'Re-register', 'Send test notification', 'Re-registered successfully']) assert.ok(page.includes(s), s);
  for (const p of ['/hbe/app', '/hbe/app-sw.js', '/hbe/app.webmanifest', '/api/hbe/push/subscribe']) assert.ok(isHbeAppPath(p));
  assert.equal(isHbeAppPath('/hbe'), false);
  assert.equal(validateSubscription({ endpoint: 'http://web.push.apple.com/x', keys: appleSub().keys }), null);
});
