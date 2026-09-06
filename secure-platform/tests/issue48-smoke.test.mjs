/**
 * Contract smoke for Mavs #48 / PR #56.
 * Live buyer.hbexperts.com currently returns 404 for public buyer routes until an
 * explicit Worker publish (stand-down). CI therefore asserts Worker-module status
 * expectations plus the public home CTA path — not live production HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../src/issue33-production-worker.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function emptyD1() {
  return {
    prepare() {
      const stmt = {
        bind() { return stmt; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { return { success: true }; }
      };
      return stmt;
    }
  };
}

function env() {
  return {
    BUYER_DB: emptyD1(),
    CF_ACCESS_TEAM_DOMAIN: 'https://hbexperts.cloudflareaccess.com',
    CF_ACCESS_AUD: 'smoke-test-aud',
    HBE_ADMIN_EMAIL: 'cwhitehead@hbexperts.com'
  };
}

async function get(path) {
  return worker.fetch(new Request(`https://buyer.hbexperts.com${path}`, { method: 'GET' }), env(), {});
}

test('public home CTA path points buyers at buyer.hbexperts.com', () => {
  const home = readFileSync(join(ROOT, 'themes/hbe/layouts/index.html'), 'utf8');
  assert.match(home, /href="https:\/\/buyer\.hbexperts\.com\/"/);
  assert.match(home, /Explore the Buyer Journey/);
});

test('buyer / and /questionnaire return 200 with no-store / noindex', async () => {
  for (const path of ['/', '/questionnaire']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('cache-control') || '', /no-store/i);
    const html = await res.text();
    assert.match(html, /noindex/i);
    assert.doesNotMatch(html, /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  }
  const q = await get('/questionnaire');
  const html = await q.text();
  assert.match(html, /id="buyerExperienceForm"/);
  assert.match(html, /Review before sending|Send to HomeBuyer Experts/);
  assert.match(html, /only for home buyers/);
  assert.match(html, /class="value-context/);
  assert.match(html, /id="compensation-note"/);
});

test('unauthenticated /portal redirects to login', async () => {
  const res = await get('/portal');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
});

test('production entrypoint keeps the root lean after every response wrapper', async () => {
  const res = await get('/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<main class="wrap journey-landing"><div class="journey-action">/);
  assert.match(html, /See how HBE works\. Start when you/);
  assert.match(html, /Nothing is sent until you review and send it\./);
  assert.equal((html.match(/Start My Buyer Experience/g) || []).length, 1);
  assert.equal((html.match(/Open my Buyer Portal/g) || []).length, 1);
  assert.doesNotMatch(html, /class="buyer-first-core|class="value-context/);
  const disclosure = html.match(/<details\b[^>]*id="public-journey-stages"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(disclosure, 'roadmap remains in one collapsed disclosure');
  assert.doesNotMatch(disclosure.split('>')[0], /\bopen\b/);
  assert.equal((html.match(/id="public-journey-stages"/g) || []).length, 1);
  assert.equal((disclosure.match(/data-i29-stop data-stage=/g) || []).length, 17);
  assert.match(disclosure, /id="compensation-note"/);
  assert.match(disclosure, /Compensation is negotiable\./);
  assert.match(disclosure, /Seller-paid compensation is not automatic or guaranteed\./);
  assert.equal((html.match(/id="compensation-note"/g) || []).length, 1);
  assert.match(html, /id="journey-landing-layout"/);
});

test('/hbe without Access JWT fails closed', async () => {
  const res = await get('/hbe');
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.match(body, /Cloudflare Access|HBE Access|HBE access required/i);
  assert.doesNotMatch(body, /CF_ACCESS|jwt|secret|token=/i);
});

test('/health reports ok', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'hbe-buyer-platform');
  assert.equal(body.issue29?.stages, 17);
});
