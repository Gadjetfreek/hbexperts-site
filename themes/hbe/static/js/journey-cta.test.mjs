import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const themeRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const layoutsRoot = join(themeRoot, 'layouts');

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.(html|md)$/.test(name.name)) out.push(p);
  }
  return out;
}

test('public layouts use one Journey host CTA and do not deep-link private surfaces', () => {
  const files = walk(layoutsRoot);
  const joined = files.map(f => readFileSync(f, 'utf8')).join('\n');
  assert.match(joined, /https:\/\/buyer\.hbexperts\.com\/"/);
  assert.doesNotMatch(joined, /buyer\.hbexperts\.com\/questionnaire/);
  assert.doesNotMatch(joined, /buyer\.hbexperts\.com\/portal/);
  assert.doesNotMatch(joined, /buyer\.hbexperts\.com\/hbe/);
  const header = readFileSync(join(layoutsRoot, 'partials/header.html'), 'utf8');
  assert.match(header, /Explore the Buyer Journey/);
  assert.match(header, /https:\/\/buyer\.hbexperts\.com\/"/);
  const partial = readFileSync(join(layoutsRoot, 'partials/journey-cta.html'), 'utf8');
  assert.match(partial, /Next you open HBE/);
  assert.match(partial, /before sharing personal information/);
  assert.match(partial, /deliberately review and send/);
  assert.doesNotMatch(joined, /Submit to HBE/);
});

test('public privacy and assessment copy use review-and-send verbs', () => {
  const root = join(themeRoot, '../..');
  const privacy = readFileSync(join(root, 'content/privacy.md'), 'utf8');
  const assessment = readFileSync(join(layoutsRoot, '_default/assessment.html'), 'utf8');
  assert.doesNotMatch(privacy, /Submit to HBE/);
  assert.match(privacy, /review and send/i);
  assert.doesNotMatch(assessment, /Submit to HBE/);
  assert.match(assessment, /review and send/i);
});
