import test from 'node:test';
import assert from 'node:assert/strict';
import { BUYER_ACTIONS, isBuyerAction, activityRecipients, captureBuyerAction, completedStatus, enqueueBuyerActivity, deliverBuyerActivityAlert } from '../src/buyer-activity-alerts.js';

function fakeDb({ session = { buyer_id: 'b1' }, buyer = { first_name: 'Alex', last_name: 'Rivera' } } = {}) {
  const rows = new Map(); const log = [];
  return { rows, log, prepare(sql) { return { bind(...a) { return {
    async first() {
      if (sql.includes('FROM buyer_sessions')) return session;
      if (sql.includes('FROM buyer_activity_alerts a')) { const r = rows.get(a[0]); return r ? { ...r, ...buyer } : null; }
      return null;
    },
    async run() {
      log.push(sql);
      if (sql.startsWith('INSERT OR IGNORE')) { if (rows.has(a[0])) return { meta: { changes: 0 } }; rows.set(a[0], { id: a[0], buyer_id: a[1], action: a[2], status: 'pending', created_at: a[3] }); return { meta: { changes: 1 } }; }
      if (sql.includes("SET status='sending'")) { const r = rows.get(a[2]); if (!r || r.status === 'sent') return { meta: { changes: 0 } }; r.status = 'sending'; return { meta: { changes: 1 } }; }
      if (sql.includes("SET status='sent'")) { rows.get(a[2]).status = 'sent'; return { meta: { changes: 1 } }; }
      if (sql.includes("SET status='failed'")) { rows.get(a[1]).status = 'failed'; return { meta: { changes: 1 } }; }
      return { meta: { changes: 1 } };
    } }; } }; } };
}
const req = (path, method = 'POST', cookie = 'hbe_session=tok') => new Request('https://buyer.hbexperts.com' + path, { method, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'POST' ? 'a=1' : undefined });

test('only completed buyer POST actions are alertable (no views, logins, HBE routes, intake)', () => {
  for (const p of Object.keys(BUYER_ACTIONS)) assert.ok(isBuyerAction(req(p), new URL('https://x' + p)), p);
  for (const p of ['/api/login', '/api/intake', '/api/hbe/note', '/portal']) assert.equal(isBuyerAction(req(p), new URL('https://x' + p)), false, p);
  assert.equal(isBuyerAction(req('/api/search/profile', 'GET'), new URL('https://x/api/search/profile')), false);
  assert.ok(completedStatus(200) && completedStatus(303) && !completedStatus(400) && !completedStatus(500));
});

test('activity alerts go to cwhitehead only by default', () => {
  assert.deepEqual(activityRecipients({ HBE_ALERT_TO: 'cwhitehead@hbexperts.com', HBE_ALERT_PRIMARY: 'buyers@hbexperts.com' }), ['cwhitehead@hbexperts.com']);
});

for (const [path, label] of Object.entries(BUYER_ACTIONS)) {
  test(`event ${path}: captured, deduped, emailed once with minimal PII`, async () => {
    const db = fakeDb(); const sent = [];
    const env = { BUYER_DB: db, HBE_ALERT_TO: 'cwhitehead@hbexperts.com', HBE_ALERT: { async send(m) { sent.push(m); return { messageId: 'm1' }; } } };
    const r = req(path);
    const cap = await captureBuyerAction(r, env, new URL(r.url));
    assert.equal(await r.text(), 'a=1', 'original body still readable by app worker');
    const now = new Date('2026-10-27T21:00:00Z');
    const id = await enqueueBuyerActivity(env, cap, now);
    assert.ok(id);
    assert.equal(await enqueueBuyerActivity(env, cap, now), null, 'duplicate suppressed');
    assert.deepEqual(await deliverBuyerActivityAlert(env, id), { status: 'sent' });
    assert.deepEqual(await deliverBuyerActivityAlert(env, id), { status: 'skipped' });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['cwhitehead@hbexperts.com']);
    assert.match(sent[0].subject, /Alex Rivera/);
    assert.ok(sent[0].text.includes(label));
    assert.match(sent[0].text, /buyer\.hbexperts\.com\/hbe/);
  });
}

test('no session means no alert; send failure is retryable and logs no PII', async () => {
  const env0 = { BUYER_DB: fakeDb({ session: null }) };
  const r0 = req('/api/search/confirm');
  assert.equal(await captureBuyerAction(r0, env0, new URL(r0.url)), null);
  const db = fakeDb(); const lines = []; const orig = console.error; console.error = l => lines.push(String(l));
  try {
    const env = { BUYER_DB: db, HBE_ALERT: { async send() { throw new Error('boom Alex'); } } };
    const r = req('/api/household/invite');
    const id = await enqueueBuyerActivity(env, await captureBuyerAction(r, env, new URL(r.url)));
    assert.equal((await deliverBuyerActivityAlert(env, id)).code, 'EMAIL_SEND_FAILED');
    assert.equal(db.rows.get(id).status, 'failed');
  } finally { console.error = orig; }
  assert.doesNotMatch(lines.join('\n'), /Alex|Rivera/);
});