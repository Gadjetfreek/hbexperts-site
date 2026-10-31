import test from 'node:test';
import assert from 'node:assert/strict';
import hbeWorker from '../src/hbe-worker.js';
import { HBEUI_COMPACT_CSS, HBEUI_COMPACT_JS } from '../src/hbeui-lanes.js';

// Synthetic data only.
const ADMIN = 'advisor@example.test';
const buyers = [
  { id: 'b-one', first_name: 'Test', last_name: 'Buyer', email: 'one@example.test', stage: 'consultation', completed_stages: '[]', answers_json: '{"why":"synthetic"}', submitted_at: '2026-10-28' },
  { id: 'b-two', first_name: 'Sample', last_name: 'Person', email: 'two@example.test', stage: 'market', completed_stages: '[]', answers_json: '{}', submitted_at: '2026-10-01' }
];
const tasks = [{ id: 't1', buyer_id: 'b-one', title: 'Synthetic overdue task', status: 'open', priority: 'critical', due_at: '2026-10-01' }];
function env() {
  return { HBE_ADMIN_EMAIL: ADMIN, BUYER_DB: { prepare(sql) {
    const rows = /FROM buyers /.test(sql) ? buyers : /FROM buyer_tasks/.test(sql) ? tasks : [];
    const st = { bind: () => st, all: async () => ({ results: rows }), first: async () => rows[0] || null, run: async () => ({}) };
    return st;
  } } };
}
async function render(q, headers = { 'Cf-Access-Authenticated-User-Email': ADMIN }) {
  return hbeWorker.fetch(new Request(`https://buyer.hbexperts.com/hbe${q}`, { headers }), env(), {});
}

test('phone view: buyer dropdown replaces the chip row', async () => {
  const html = await (await render('?buyer=b-one')).text();
  const sel = html.match(/<select data-hbe-buyer-select[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, 'buyer select present');
  assert.equal((sel[1].match(/<option /g) || []).length, 2);
  assert.match(sel[1], /value="\/hbe\?buyer=b-one" selected/);
  assert.doesNotMatch(sel[1], /example\.test/, 'no emails in dropdown');
  assert.match(HBEUI_COMPACT_CSS, /\.shell\.has-selected>\.buyer-strip[^{]*\{display:none!important\}/);
  assert.match(HBEUI_COMPACT_JS, /select\[data-hbe-buyer-select\]/);
  assert.match(HBEUI_COMPACT_JS, /\^\\\/hbe\\\?buyer=/, 'only same-origin /hbe links are followed');
});

test('phone view: one Next card with needs-me items and one Open button', async () => {
  const html = await (await render('?buyer=b-one')).text();
  const card = html.slice(html.indexOf('id="hbe-next-card"'), html.indexOf('</section>', html.indexOf('id="hbe-next-card"')));
  assert.match(card, /Synthetic overdue task/);
  assert.equal((card.match(/class="hbe-next-open"/g) || []).length, 1);
  assert.match(html, /class="hbe-next-card hbe-mobile-only"/);
});

test('phone view: four primary tabs plus a More menu; every section still rendered', async () => {
  const html = await (await render('?buyer=b-one')).text();
  const nav = html.slice(html.indexOf('class="hbe-tabs'), html.indexOf('</nav>', html.indexOf('class="hbe-tabs')));
  assert.deepEqual([...nav.matchAll(/<button type="button" data-hbe-tab="(\w+)"/g)].map(m => m[1]), ['next', 'story', 'notes', 'contact']);
  assert.match(nav, /data-hbe-tab="more">More/);
  for (const id of ['needs', 'stage', 'tasks', 'notes', 'profile', 'matters', 'journey', 'contact']) {
    assert.match(html, new RegExp(`id="chip-${id}"`), `chip ${id} still rendered`);
  }
  assert.match(html, /id="chip-journey"[^>]*>[\s\S]*?hbe-chip-note">Private/);
  assert.match(HBEUI_COMPACT_JS, /\.hbe-chip-note/, 'More menu keeps the PRIVATE marker');
  assert.match(HBEUI_COMPACT_JS, /PRIMARY=\{next:\['next','needs'\],story:\['story'\],notes:\['notes'\],contact:\['contact'\]\}/);
});

test('desktop unchanged: new pieces are phone-only', async () => {
  assert.match(HBEUI_COMPACT_CSS, /\.hbe-mbar,\.hbe-mobile-only\{display:none\}/);
  const html = await (await render('?buyer=b-one')).text();
  for (const c of ['hbe-buyer-select', 'hbe-next-card', 'hbe-tabs']) assert.match(html, new RegExp(`class="${c} hbe-mobile-only"`));
  assert.match(html, /class="buyer-strip"/);
});

test('Access still required for the dashboard', async () => {
  const res = await render('?buyer=b-one', {});
  assert.notEqual(res.status, 200);
});
