import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LANE,
  classifyAttentionItems,
  needsMeRailHtml,
  laneBandHtml,
  hbeOpsSlotHtml,
  injectHbeOps,
  attentionClassForTask,
  isOverdue,
  isDueSoon,
  isDateCritical,
  HBEUI_LANES_CSS
} from '../src/hbeui-lanes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');
function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test('Issue #79: lane constants and labels are Buyer / HBE / Needs Me', () => {
  assert.equal(LANE.BUYER, 'buyer');
  assert.equal(LANE.HBE, 'hbe');
  assert.equal(LANE.NEEDS_ME, 'needs-me');
  const buyer = laneBandHtml({ lane: LANE.BUYER, title: 'Buyer context', body: 'x' });
  const hbe = laneBandHtml({ lane: LANE.HBE, title: 'HBE workspace', body: 'y' });
  assert.match(buyer, /data-hbeui-lane="buyer"/);
  assert.match(buyer, />BUYER</);
  assert.match(hbe, /data-hbeui-lane="hbe"/);
  assert.match(hbe, />HBE</);
  assert.match(buyer, /hbeui-lane--buyer/);
  assert.match(hbe, /hbeui-lane--hbe/);
  // Grayscale-distinct structure (not color-only): solid vs dashed border, shape differ
  assert.match(HBEUI_LANES_CSS, /\.hbeui-lane--buyer\{[^}]*border-left:\d+px solid/);
  assert.match(HBEUI_LANES_CSS, /\.hbeui-lane--hbe\{[^}]*border-left:\d+px dashed/);
  assert.match(HBEUI_LANES_CSS, /border-radius:14px/);
  assert.match(HBEUI_LANES_CSS, /\.hbeui-lane--hbe\{[^}]*border-radius:4px/);
});

test('Issue #79: classifyAttentionItems ranks overdue/critical/unread/date/high', () => {
  const now = Date.parse('2026-09-17T18:00:00Z');
  const items = classifyAttentionItems({
    now,
    notifications: [
      { id: 'n1', type: 'buyer_submission', read_at: null },
      { id: 'n2', type: 'buyer_submission', read_at: '2026-09-16T00:00:00Z' }
    ],
    tasks: [
      { id: 't1', title: 'Overdue call', status: 'open', priority: 'normal', due_at: '2026-09-10' },
      { id: 't2', title: 'Critical review', status: 'open', priority: 'critical', due_at: null },
      { id: 't3', title: 'Due soon', status: 'open', priority: 'normal', due_at: '2026-09-18' },
      { id: 't4', title: 'High later', status: 'open', priority: 'high', due_at: '2026-10-01' },
      { id: 't5', title: 'Done critical', status: 'done', priority: 'critical', due_at: '2026-09-10' },
      { id: 't6', title: 'Normal far', status: 'open', priority: 'normal', due_at: '2026-12-01' }
    ]
  });
  assert.equal(items.some(i => i.kind === 'overdue' && i.sourceId === 't1'), true);
  assert.equal(items.some(i => i.kind === 'critical' && i.sourceId === 't2'), true);
  assert.equal(items.some(i => i.kind === 'date_critical' && i.sourceId === 't3'), true);
  assert.equal(items.some(i => i.kind === 'high_priority' && i.sourceId === 't4'), true);
  assert.equal(items.some(i => i.kind === 'unread'), true);
  assert.equal(items.some(i => i.sourceId === 't5'), false);
  assert.equal(items.some(i => i.sourceId === 't6'), false);
  // overdue before critical before date before high before unread severity order
  assert.ok(items[0].severity <= items[1].severity);
  assert.equal(isOverdue('2026-09-10', now), true);
  assert.equal(isDueSoon('2026-09-18', now), true);
  assert.equal(isDateCritical({ status: 'open', priority: 'critical', due_at: null }, now), true);
});

test('Issue #79: Needs Me rail is sparse (max 3) and quiet when empty', () => {
  const quiet = needsMeRailHtml([]);
  assert.match(quiet, /Nothing needs you right now/);
  assert.match(quiet, /hbeui-needs-me--quiet/);
  assert.equal(needsMeRailHtml([], { collapseWhenEmpty: true }), '');

  const many = classifyAttentionItems({
    tasks: [
      { id: 'a', title: 'A', status: 'open', priority: 'critical', due_at: null },
      { id: 'b', title: 'B', status: 'open', priority: 'critical', due_at: null },
      { id: 'c', title: 'C', status: 'open', priority: 'critical', due_at: null },
      { id: 'd', title: 'D', status: 'open', priority: 'critical', due_at: null }
    ],
    notifications: []
  });
  const rail = needsMeRailHtml(many);
  assert.match(rail, /hbeui-needs-me--active/);
  assert.match(rail, /Needs me/);
  assert.equal((rail.match(/hbeui-needs-item/g) || []).length, 3);
  assert.match(rail, /#task-a/);
});

test('Issue #79: attention accents at source for critical/date/high only', () => {
  assert.match(attentionClassForTask({ status: 'open', priority: 'critical', due_at: null }), /hbeui-attn--critical/);
  assert.match(attentionClassForTask({ status: 'open', priority: 'normal', due_at: '2099-01-01' }), /^$/);
  assert.equal(attentionClassForTask({ status: 'done', priority: 'critical', due_at: '2020-01-01' }), '');
});

test('Issue #79: HBE ops slot inject is append-safe and HBE-only', () => {
  const base = `<main>${hbeOpsSlotHtml()}</main>`;
  const once = injectHbeOps(base, '<section id="ops-a">A</section>');
  const twice = injectHbeOps(once, '<section id="ops-b">B</section>');
  assert.match(twice, /id="ops-a"/);
  assert.match(twice, /id="ops-b"/);
  assert.equal((twice.match(/<!--hbeui-ops-anchor-->/g) || []).length, 1);
  // fallback without slot still works
  const fallback = injectHbeOps('<main>x</main>', '<section id="ops-c">C</section>');
  assert.match(fallback, /<main>x<section id="ops-c">C<\/section><\/main>/);
});

test('Issue #79: hbe-worker wires lanes into selected buyer workspace', () => {
  const worker = read('src/hbe-worker.js');
  assert.match(worker, /from '\.\/hbeui-lanes\.js'/);
  assert.match(worker, /lane-buyer/);
  assert.match(worker, /lane-hbe/);
  assert.match(worker, /needsMeRailHtml/);
  assert.match(worker, /laneBandHtml/);
  assert.match(worker, /hbeOpsSlotHtml/);
  assert.match(worker, /HBEUI_LANES_CSS/);
  assert.match(worker, /BUYER DECISION PROFILE/);
  assert.match(worker, /WHAT MATTERS/);
  assert.match(worker, /HBE WORK/);
  assert.match(worker, /HBE NOTES/);
  assert.match(worker, /attentionClassForTask/);
  assert.match(worker, /id="task-\$/);
  // sticky Needs Me + mobile static
  assert.match(HBEUI_LANES_CSS, /position:sticky/);
  assert.match(HBEUI_LANES_CSS, /@media\(max-width:900px\)\{[^}]*\.hbeui-needs-me\{position:static/);
});

test('Issue #79: issue29 + showing-card inject into HBE ops slot only', () => {
  const i29 = read('src/issue29-convergence-worker.js');
  const sc = read('src/showing-card/routes.js');
  assert.match(i29, /injectHbeOps\(text, panel\)/);
  assert.match(sc, /injectHbeOps\(text,/);
  // Buyer portal enhancement must not use injectHbeOps
  const portalBlock = i29.slice(i29.indexOf('async function enhanceBuyerPortal'), i29.indexOf('function enhancePublic'));
  assert.doesNotMatch(portalBlock, /injectHbeOps/);
});

test('Issue #79: no BuyerUI / portal / questionnaire / acquisition path edits', () => {
  // Static regression: buyer-facing focus script and portal worker untouched by this issue’s module.
  const focus = read('src/issue33-production-worker.js');
  assert.match(focus, /BUYER_PORTAL_FOCUS_JS|buyer-portal-focus|buyer-focus-card/);
  const portal = read('src/portal-worker.js');
  assert.doesNotMatch(portal, /hbeui-lane|needsMeRailHtml|HBEUI_LANES/);
  const acq = readFileSync(join(repoRoot, 'themes/hbe/static/js/acquisition.js'), 'utf8');
  assert.doesNotMatch(acq, /hbeui-lane|Needs me/);
});
