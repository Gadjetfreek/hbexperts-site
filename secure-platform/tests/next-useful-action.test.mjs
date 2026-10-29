import test from 'node:test';
import assert from 'node:assert/strict';
import hbeWorker, { NEXT_ACTION_TARGETS } from '../src/hbe-worker.js';

const ADMIN = 'advisor@example.test';
const buyers = [
  { id: 'b-new', first_name: 'Test', last_name: 'B', email: 'test@example.test', stage: 'consultation', completed_stages: '[]', answers_json: '{"why":"synthetic"}', submitted_at: '2026-10-28' },
  { id: 'b-old', first_name: 'Sample', last_name: 'P', email: 'sample@example.test', stage: 'market', completed_stages: '[]', answers_json: '{}', submitted_at: '2026-10-01' }
];
function env(tasks) {
  return { HBE_ADMIN_EMAIL: ADMIN, BUYER_DB: { prepare(sql) {
    const rows = /FROM buyers /.test(sql) ? buyers : /FROM buyer_tasks/.test(sql) ? tasks : [];
    const st = { bind: () => st, all: async () => ({ results: rows }), first: async () => rows[0] || null, run: async () => ({}) };
    return st;
  } } };
}
async function render(query, tasks) {
  const res = await hbeWorker.fetch(new Request(`https://buyer.hbexperts.com/hbe${query}`, { headers: { 'Cf-Access-Authenticated-User-Email': ADMIN } }), env(tasks), {});
  assert.equal(res.status, 200);
  return res.text();
}
function bubble(html) {
  const m = html.match(/<a class="priority-bubble" href="([^"]+)" data-hbe-target="([^"]+)">/);
  assert.ok(m, 'priority bubble has href + data-hbe-target');
  return { href: new URL(m[1], 'https://buyer.hbexperts.com'), target: m[2] };
}

const variants = {
  review: [],
  task: [{ id: 't1', buyer_id: 'b-old', title: 'Synthetic task', status: 'open', priority: 'high', due_at: '2026-10-30' }]
};

for (const [name, tasks] of Object.entries(variants)) {
  test(`next useful action "${name}" links to an element that exists on the destination page`, async () => {
    const { href, target } = bubble(await render('', tasks));
    assert.equal(target, NEXT_ACTION_TARGETS[name]);
    assert.equal(href.hash, `#${target}`);
    const dest = await render(href.search, tasks);
    assert.equal((dest.match(new RegExp(`id="${target}"`, 'g')) || []).length, 1, `exactly one #${target}`);
    assert.match(dest, /id="hbe-next-action-js"/);
  });
}

test('every NEXT_ACTION_TARGETS variant is covered by a test', () => {
  assert.deepEqual(Object.keys(NEXT_ACTION_TARGETS).sort(), Object.keys(variants).sort());
});

test('review action on the default (already-selected) buyer resolves in-page', async () => {
  const html = await render('', []);
  const { href } = bubble(html);
  assert.equal(href.searchParams.get('buyer'), 'b-new', 'default selected buyer is the newest');
  assert.match(html, /id="buyer-experience"/, 'target is on the current page so the tap scrolls instead of reloading');
});

test('reveal script opens enclosing <details> chips and handles same-page taps', async () => {
  const html = await render('', []);
  const js = html.slice(html.indexOf('id="hbe-next-action-js"'), html.indexOf('</script>', html.indexOf('id="hbe-next-action-js"')));
  assert.match(js, /tagName==='DETAILS'&&!d\.open\)d\.open=true/);
  assert.match(js, /preventDefault\(\)/);
  assert.match(js, /hashchange/);
  assert.match(js, /scrollIntoView/);
});

test('no next action and no dead link when there are no buyers', async () => {
  const e = env([]); e.BUYER_DB.prepare = () => { const st = { bind: () => st, all: async () => ({ results: [] }) }; return st; };
  const res = await hbeWorker.fetch(new Request('https://buyer.hbexperts.com/hbe', { headers: { 'Cf-Access-Authenticated-User-Email': ADMIN } }), e, {});
  assert.doesNotMatch(await res.text(), /priority-bubble" href/);
});

for (const [name, tasks] of Object.entries(variants)) {
  test(`compact mobile sticky bar carries the "${name}" next useful action with a real target`, async () => {
    const html = await render('?buyer=b-new', tasks);
    const bar = html.slice(html.indexOf('class="hbe-mbar"'), html.indexOf('</div></div>', html.indexOf('class="hbe-mbar"')));
    const m = bar.match(/<a class="hbe-mbar-next" href="([^"]+)" data-hbe-target="([^"]+)">Next: /);
    assert.ok(m, 'mobile bar has the Next useful action link');
    const { href, target } = bubble(html);
    assert.equal(m[2], target);
    assert.equal(m[1], href.pathname + href.search + href.hash);
    const dest = await render(href.search, tasks);
    assert.match(dest, new RegExp(`id="${target}"`));
    // target sits inside a <details> chip that the reveal script opens
    const i = dest.indexOf(`id="${target}"`);
    assert.ok(dest.lastIndexOf('<details class="hbe-chip-panel', i) > dest.lastIndexOf('</details>', i), `#${target} is inside a chip`);
  });
}
