import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_MANIFEST, DESKTOP_MANIFEST_PATH, desktopManifestResponse, addDesktopApp } from '../src/hbe-desktop.js';
import { MANIFEST } from '../src/hbe-push.js';
import worker from '../src/issue33-production-worker.js';

test('desktop manifest is a separate app that opens HBEUI inside /hbe scope', async () => {
  assert.equal(DESKTOP_MANIFEST.id, '/hbe/desktop');
  assert.notEqual(DESKTOP_MANIFEST.id, MANIFEST.id);
  assert.equal(DESKTOP_MANIFEST.start_url, '/hbe');
  assert.equal(DESKTOP_MANIFEST.scope, '/hbe');
  assert.equal(DESKTOP_MANIFEST.display, 'standalone');
  for (const s of DESKTOP_MANIFEST.shortcuts) assert.ok(s.url.startsWith('/hbe'));
  const r = desktopManifestResponse();
  assert.match(r.headers.get('content-type'), /manifest\+json/);
  assert.equal((await r.json()).id, '/hbe/desktop');
});

test('iPhone app manifest unchanged', () => {
  assert.equal(MANIFEST.id, '/hbe/app');
  assert.equal(MANIFEST.start_url, '/hbe/app');
  assert.equal(MANIFEST.scope, '/hbe');
});

test('addDesktopApp injects manifest, wide layout and in-scope Alerts link once', () => {
  const html = '<html><head><title>x</title></head><body><header class="site-header"><div class="header-inner"><div class="header-actions"><a href="/">Buyer Journey</a></div></div></header><main class="shell"><section class="buyer-strip"></section><section class="buyer-main">Test Buyer</section></main></body></html>';
  const out = addDesktopApp(html);
  assert.ok(out.includes(`href="${DESKTOP_MANIFEST_PATH}"`));
  assert.match(out, /@media\(min-width:1200px\)/);
  assert.ok(out.includes('<a href="/hbe/app" id="hbe-desktop-alerts">Alerts</a>'));
  assert.equal(addDesktopApp(out), out);
  assert.equal(addDesktopApp('plain'), 'plain');
});

test('worker serves desktop manifest without data access', async () => {
  const res = await worker.route(new Request('https://buyer.hbexperts.com' + DESKTOP_MANIFEST_PATH), {}, null, new URL('https://buyer.hbexperts.com' + DESKTOP_MANIFEST_PATH));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).start_url, '/hbe');
});