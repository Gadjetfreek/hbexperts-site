import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  chipPanelHtml, injectHbeOps, HBE_STAGE_MERGE_ANCHOR, HBEUI_COMPACT_CSS, HBEUI_COMPACT_JS
} from '../src/hbeui-lanes.js';
import { STAGES } from '../src/journey-stages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

test('chipPanelHtml wraps a body in an open <details> chip with lane + id', () => {
  const html = chipPanelHtml({ id: 'tasks', label: 'Tasks', badge: 2, lane: 'hbe', body: '<section id="x">B</section>' });
  assert.match(html, /^<details class="hbe-chip-panel hbe-chip-panel--hbe" id="chip-tasks" data-hbe-chip="tasks" data-hbeui-lane="hbe"[^>]* open>/);
  assert.match(html, /<summary class="hbe-chip">[\s\S]*Tasks[\s\S]*<\/summary><div class="hbe-chip-body"><section id="x">B<\/section><\/div><\/details>$/);
  const merged = chipPanelHtml({ id: 'stage-map', label: 'Stage map', body: 'm', mergeInto: 'stage' });
  assert.match(merged, /data-hbe-merge-into="stage"/);
  assert.match(chipPanelHtml({ id: 'c', label: 'C', body: '', mobileOnly: true }), /hbe-mobile-only/);
  assert.doesNotMatch(chipPanelHtml({ id: 'e', label: '<b>', body: '' }), /<b>/);
});

test('every HBE /hbe panel is rendered inside a chip', () => {
  const hbe = read('src/hbe-worker.js');
  for (const id of ['profile', 'matters', 'journey', 'contact', 'needs', 'stage', 'tasks', 'notes']) {
    assert.match(hbe, new RegExp(`chipPanelHtml\\(\\{\\s*id:\\s*'${id}'`), `hbe-worker chip ${id}`);
  }
  const conv = read('src/issue29-convergence-worker.js');
  for (const id of ['stage-map', 'next', 'story', 'compass', 'checklist', 'compensation']) {
    assert.match(conv, new RegExp(`id:\\s*'${id}'`), `convergence chip ${id}`);
  }
  assert.equal((read('src/showing-card/routes.js').match(/chipPanelHtml\(\{\s*id:\s*'showings'/g) || []).length, 2);
  for (const [file, id] of [['pilot', 'pilot'], ['consultation', 'consult'], ['representation', 'hire'], ['search', 'search']]) {
    assert.match(read(`src/${file}-worker.js`), new RegExp(`injectBeforeMainEnd\\(text, chipPanelHtml\\(\\{ id: '${id}'`), `${file} chip`);
  }
});

test('buyer-facing surfaces do not use chips', () => {
  for (const f of ['src/ui-worker.js']) assert.doesNotMatch(read(f), /chipPanelHtml/);
  for (const f of ['src/pilot-worker.js', 'src/representation-worker.js', 'src/search-worker.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /injectBeforeMainEnd\(text, chipPanelHtml\(\{[^}]*buyer[A-Z]\w*Panel/);
  }
});

test('splice markers survive and ops panels land inside the chip deck', () => {
  const hbe = read('src/hbe-worker.js');
  assert.match(hbe, /hbeOpsSlotHtml\(\)|<!--hbeui-ops-anchor-->/);
  assert.match(hbe, /HBE_STAGE_MERGE_ANCHOR/);
  assert.match(hbe, /class="buyer-strip"/);
  assert.match(read('src/buyer-journey.js'), /private draft/i);
  assert.match(hbe, /id: 'journey'[^}]*note: 'Private'/);
  assert.match(hbe, /no-store/);
  assert.match(hbe, /noindex/);
  assert.equal(HBE_STAGE_MERGE_ANCHOR, '<!--hbe-stage-merge-anchor-->');
  const page = `<main class="shell has-selected"><div class="hbe-chip-deck">${chipPanelHtml({ id: 'stage', label: 'Stage', body: `r${HBE_STAGE_MERGE_ANCHOR}` })}<div class="hbeui-ops-slot"><!--hbeui-ops-anchor--></div></div></main>`;
  let out = injectHbeOps(page, chipPanelHtml({ id: 'showings', label: 'Showings', body: '<section id="properties-showings">s</section>' }));
  out = injectHbeOps(out, chipPanelHtml({ id: 'next', label: "What's Next", body: 'n' }));
  assert.match(out, /<!--hbeui-ops-anchor-->/);
  assert.match(out, /<!--hbe-stage-merge-anchor-->/);
  const deck = out.slice(out.indexOf('hbe-chip-deck'), out.lastIndexOf('</div></main>'));
  assert.match(deck, /id="chip-showings"[\s\S]*id="properties-showings"/);
  assert.match(deck, /id="chip-next"/);
});

test('stage labels come from journey-stages.js', () => {
  assert.equal(STAGES.length, 17);
  const hbe = read('src/hbe-worker.js');
  assert.match(hbe, /STAGES as CANONICAL_STAGES[^;]*journey-stages\.js/);
  const literal = [...hbe.matchAll(/\['(\w+)',\s*'([^']+)'\]/g)].map(m => [m[1], m[2]]);
  const canon = Object.fromEntries(STAGES.map(s => [s.id, s.label]));
  for (const [id, label] of literal) if (canon[id]) assert.equal(label, canon[id], `stage ${id}`);
});

test('mobile CSS/JS: <=720px only, one-open accordion, merge, menu, stage confirm', () => {
  assert.match(HBEUI_COMPACT_CSS, /@media ?\(max-width: ?720px\)/);
  assert.match(HBEUI_COMPACT_CSS, /\.hbe-chip-panel\[hidden\]\{display:none!important\}/);
  assert.match(HBEUI_COMPACT_JS, /hbe-buyer-panels/);
  assert.match(HBEUI_COMPACT_JS, /data-hbe-merge-into|hbeMergeInto/);
  assert.match(HBEUI_COMPACT_JS, /confirm\(/);
  assert.match(HBEUI_COMPACT_JS, /720/);
});
