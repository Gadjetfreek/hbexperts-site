import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { handleHbeApp } from '../src/hbe-push.js';

const OWNER = 'owner@example.test';
const db = { prepare: () => { const st = { bind: () => st, all: async () => ({ results: [] }), first: async () => ({ n: 1, c: 1 }), run: async () => ({}) }; return st; } };
const env = { BUYER_DB: db, HBE_ADMIN_EMAIL: OWNER };
const asOwner = { authenticate: async () => ({ ok: true, professional: { email: OWNER } }) };

async function page() {
  const res = await handleHbeApp(new Request('https://buyer.hbexperts.com/hbe/app'), env, new URL('https://buyer.hbexperts.com/hbe/app'), asOwner);
  return res.text();
}

async function runState({ permission, subscription = true, devices = 1 }) {
  const html = await page();
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const els = {};
  const el = id => (els[id] ||= { id, textContent: id === 'devices' ? String(devices) : '', hidden: false, className: '', dataset: {}, open: true, disabled: false });
  const listeners = {};
  const sub = subscription ? { endpoint: 'https://web.push.apple.com/x', expirationTime: null, toJSON() { return { endpoint: this.endpoint }; } } : null;
  const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
  const ctx = {
    document: { getElementById: el, visibilityState: 'visible', addEventListener: (t, f) => { listeners[t] = f; } },
    navigator: { standalone: true, userAgent: 'iPhone', serviceWorker: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) } },
    window: { PushManager: function () {} },
    Notification: { permission },
    matchMedia: () => ({ matches: true }),
    fetch: async (path) => new Response(JSON.stringify(path.includes('config') ? { publicKey: 'AA' } : { devices, registered_at: new Date().toISOString() }), { status: 200 }),
    atob: s => Buffer.from(s, 'base64').toString('binary'), Uint8Array, Date, Number, JSON, Error, Promise, Response
  };
  ctx.window.Notification = ctx.Notification;
  ctx.window = new Proxy(ctx.window, { has: (t, k) => k in t });
  vm.createContext(ctx);
  // `'PushManager' in window` and `'Notification' in window` must be true
  ctx.window.Notification = ctx.Notification;
  vm.runInContext(script, ctx);
  await new Promise(r => setTimeout(r, 20));
  return { els, listeners, ctx, html };
}

test('page keeps leads, dashboard and activity as main content; notifications card sits after activity', async () => {
  const html = await page();
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  assert.ok(main.indexOf('Open HBEUI dashboard') < main.indexOf('Recent buyer activity'));
  assert.ok(main.indexOf('Recent buyer activity') < main.indexOf('id="notif"'));
  assert.match(html, /main>\.notif\.notif-prompt\{order:-1/);
  assert.match(html, /main>\.notif\.notif-quiet\{order:99/);
  assert.match(html, /id="notif-details"/);
  assert.match(html, /<main>/, 'lead banner injection point preserved');
});

test('granted + registered: collapses to a quiet chip with Re-register/Test inside <details>', async () => {
  const { els } = await runState({ permission: 'granted', devices: 1 });
  assert.equal(els.notif.dataset.state, 'quiet');
  assert.match(els.notif.className, /notif-quiet/);
  assert.equal(els['notif-details'].open, false);
  assert.match(els['notif-chip'].textContent, /Notifications on · 1 device$/);
  assert.equal(els.enable.hidden, true);
  assert.equal(els['notif-denied'].hidden, true);
});

test('default permission or missing subscription: full prompt card at top', async () => {
  for (const s of [{ permission: 'default' }, { permission: 'granted', subscription: false }, { permission: 'granted', devices: 0 }]) {
    const { els } = await runState(s);
    assert.equal(els.notif.dataset.state, 'prompt', JSON.stringify(s));
    assert.match(els.notif.className, /notif-prompt/);
    assert.equal(els['notif-details'].open, true);
    assert.equal(els.enable.hidden, false);
  }
});

test('denied: prompt explains how to re-enable in iOS Settings', async () => {
  const { els, html } = await runState({ permission: 'denied' });
  assert.equal(els.notif.dataset.state, 'denied');
  assert.match(els.notif.className, /notif-prompt notif-denied/);
  assert.equal(els['notif-denied'].hidden, false);
  assert.match(html, /Settings<\/b> › <b>Notifications<\/b> › <b>HBE<\/b>/);
});

test('re-checks on visibilitychange (permission revoked while backgrounded)', async () => {
  const { els, listeners, ctx } = await runState({ permission: 'granted' });
  assert.equal(els.notif.dataset.state, 'quiet');
  ctx.Notification.permission = 'denied';
  listeners.visibilitychange();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(els.notif.dataset.state, 'denied');
});
