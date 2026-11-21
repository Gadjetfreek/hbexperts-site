// Regression guard: the deployed Worker bundle must not break inline scripts that pages build
// from Function.prototype.toString(). With esbuild keep_names on, Wrangler wraps functions in
// __name(fn, "name") calls, the browser has no __name helper, and the Buyer Story script and the
// guided answer script throw "ReferenceError: __name is not defined" (seen live on Nov 21 2026).
//
// The bundle checks build with the pinned production Wrangler (see deploy.ps1) via
// `wrangler deploy --dry-run --outdir`, which needs no Cloudflare login, and run the rendered
// /questionnaire in jsdom. Both tools are fetched with npx/npm into a temp dir, so they need
// network access; set HBE_SKIP_BUNDLE_BUILD=1 to skip only those checks when offline.
// Synthetic data only: no Cloudflare account, no D1, no network calls from the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_VERSION = '4.134.0'; // keep in sync with deploy.ps1
const JSDOM_VERSION = '24.1.3';
const SKIP = process.env.HBE_SKIP_BUNDLE_BUILD === '1';

test('wrangler.toml turns keep_names off for the production bundle', () => {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^keep_names\s*=\s*false\s*$/m);
  assert.doesNotMatch(toml, /^keep_names\s*=\s*true\s*$/m);
});

test('built bundle has no __name helper and the questionnaire scripts run cleanly', { skip: SKIP && 'HBE_SKIP_BUNDLE_BUILD=1', timeout: 600000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'hbe-bundle-'));
  try {
    const npmEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const out = join(work, 'out');
    execFileSync(npx, ['-y', `wrangler@${WRANGLER_VERSION}`, 'deploy', '--dry-run', '--outdir', out], { cwd: ROOT, env: npmEnv, stdio: 'pipe', shell: process.platform === 'win32' });
    const bundleFile = readdirSync(out).find((f) => f.endsWith('.js'));
    assert.ok(bundleFile, 'dry-run wrote a bundle');
    const bundlePath = join(out, bundleFile);
    const bundle = readFileSync(bundlePath, 'utf8');
    assert.equal((bundle.match(/__name\(/g) || []).length, 0, 'bundle must not contain __name( calls');

    // Render /questionnaire from the built bundle (not the source) with a synthetic env.
    const { default: worker } = await import(pathToFileURL(bundlePath).href);
    const log = console.log; const err = console.error;
    console.log = () => {}; console.error = () => {};
    let html;
    try {
      const res = await worker.fetch(new Request('https://buyer.hbexperts.com/questionnaire'), { HBE_ADMIN_EMAIL: 'owner@example.test' }, { waitUntil() {} });
      assert.equal(res.status, 200);
      html = await res.text();
    } finally { console.log = log; console.error = err; }

    const scriptById = (id) => {
      const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
      return m && m[1];
    };
    const story = scriptById('buyer-story-script');
    const guided = scriptById('buyer-guided-answer-script');
    assert.ok(story, 'inline Buyer Story script is on the page');
    assert.ok(guided, 'inline guided answer script is on the page');
    for (const [name, src] of [['buyer-story-script', story], ['buyer-guided-answer-script', guided]]) {
      assert.doesNotMatch(src, /__name\(/, `${name} must not reference __name`);
    }

    writeFileSync(join(work, 'package.json'), '{"private":true}');
    execFileSync(npm, ['install', '--no-save', '--loglevel=error', `jsdom@${JSDOM_VERSION}`], { cwd: work, env: npmEnv, stdio: 'pipe', shell: process.platform === 'win32' });
    const { JSDOM, VirtualConsole } = createRequire(join(work, 'package.json'))('jsdom');

    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(String((e && (e.detail || e.message)) || e).split('\n')[0]));
    let fetches = 0;
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      virtualConsole,
      url: 'https://buyer.hbexperts.com/questionnaire',
      beforeParse(win) {
        win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
        win.scrollTo = () => {};
        win.print = () => { win.__printed = (win.__printed || 0) + 1; };
        win.fetch = () => { fetches += 1; throw new Error('network disabled in test'); };
      }
    });
    try {
      assert.deepEqual(errors, [], 'page scripts load without errors');

      // Story download works without contact info and never touches the network.
      const w = dom.window; const d = w.document;
      const next = () => d.querySelector('.step.active .next').click();
      next();
      d.getElementById('buyer-story-skip-contact').click();
      const why = d.querySelector('[name="why"]');
      if (why) why.value = 'Synthetic reason';
      next(); next(); next();
      d.getElementById('buyer-story-download').click();
      assert.equal(w.__printed, 1, 'download opens print without contact info');
      assert.equal(fetches, 0, 'download makes no network calls');
      assert.equal(w.sessionStorage.length, 0, 'download stores nothing');
      assert.deepEqual(errors, [], 'story flow raised no errors');
    } finally { dom.window.close(); }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
