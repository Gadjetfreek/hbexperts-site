import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(root, 'src/ui-worker.js'), 'utf8');
const explorer = ui.slice(ui.indexOf('function explorer()'), ui.indexOf('function page(body)'));

test('journey landing uses centered action column classes', () => {
  assert.match(explorer, /journey-hero/);
  assert.match(explorer, /journey-landing/);
  assert.match(explorer, /journey-action/);
  assert.match(explorer, /journey-trust/);
  assert.match(explorer, /Start My Buyer Experience/);
  assert.match(explorer, /Open my Buyer Portal/);
  assert.match(explorer, /Nothing is sent until you review and send it/);
  assert.match(explorer, /See all 17 stages/);
  assert.doesNotMatch(explorer, /align-items:flex-start/);
  assert.doesNotMatch(explorer, /style="display:flex;flex-direction:column;align-items:flex-start/);
});

test('journey landing icons are decorative SVG and do not replace CTA text', () => {
  assert.match(explorer, /aria-hidden="true"/);
  assert.match(explorer, /<svg[\s\S]*Buyer Journey/);
  assert.match(explorer, /Start My Buyer Experience<\/span>/);
  assert.match(explorer, /Open my Buyer Portal<\/span>/);
  assert.doesNotMatch(explorer, /<img\b/i);
  assert.doesNotMatch(explorer, /unsplash|stock photo|pexels/i);
});

test('THEME includes journey layout CSS for centered hierarchy', () => {
  const theme = ui.slice(ui.indexOf('const THEME'), ui.indexOf('const HEADER'));
  assert.match(theme, /\.journey-landing\{/);
  assert.match(theme, /\.journey-action\{/);
  assert.match(theme, /align-items:center/);
  assert.match(theme, /min-height:48px/);
});
