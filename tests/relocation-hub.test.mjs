/**
 * Relocation hub content guards (node-native, $0).
 * Asserts Fair Housing posture, buyer-only language, Journey CTA,
 * and absence of common steering / invented-stat phrasing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = join(root, 'content', 'relocation.md');
const hugoPath = join(root, 'hugo.toml');
const publicHtml = join(root, 'public', 'relocation', 'index.html');

function read(path) {
  return readFileSync(path, 'utf8');
}

test('relocation markdown exists', () => {
  assert.equal(existsSync(mdPath), true, 'content/relocation.md must exist');
});

test('menu lists Relocation -> /relocation/', () => {
  const hugo = read(hugoPath);
  assert.match(hugo, /name\s*=\s*"Relocation"/);
  assert.match(hugo, /url\s*=\s*"\/relocation\/"/);
});

test('buyer-only language and Journey CTA present in markdown', () => {
  const md = read(mdPath);
  assert.match(md, /works?\s+only\s+for\s+home\s+buyers/i);
  assert.match(md, /never\s+(represent(s)?\s+the\s+seller|for the seller)/i);
  assert.match(md, /https:\/\/buyer\.hbexperts\.com\//);
  assert.match(md, /Explore the Buyer Journey/);
});

test('Fair Housing link present', () => {
  const md = read(mdPath);
  assert.match(md, /relref "fair-housing"|\/fair-housing\//);
  assert.match(md, /Fair Housing/i);
});

test('covers required decision themes without thin city-page swarm', () => {
  const md = read(mdPath);
  for (const theme of [
    /commute/i,
    /property tax/i,
    /inspect/i,
    /HOA|municipal/i,
    /remote/i,
    /Summit,\s*Stark,\s*Medina,\s*Wayne/
  ]) {
    assert.match(md, theme);
  }
  // Prefer one hub: no swarm of city-named content files required by this feature
  assert.equal(existsSync(join(root, 'content', 'akron.md')), false);
  assert.equal(existsSync(join(root, 'content', 'cleveland.md')), false);
});

test('forbids common steering and unsupported claim phrases', () => {
  const md = read(mdPath).toLowerCase();
  const forbidden = [
    'best neighborhood',
    'best neighborhoods',
    'safest neighborhood',
    'top-rated school',
    'school ranking',
    'median home price',
    'crime rate of',
    'drive time of',
    'tax rate of',
    'millage rate'
  ];
  for (const phrase of forbidden) {
    assert.equal(md.includes(phrase), false, `forbidden phrase present: ${phrase}`);
  }
});

test('optional built HTML (if public/ exists) mirrors key assertions', () => {
  if (!existsSync(publicHtml)) {
    // Hugo build is optional for this unit check; skip quietly when not built.
    return;
  }
  const html = read(publicHtml);
  assert.match(html, /https:\/\/buyer\.hbexperts\.com\//);
  assert.match(html, /fair-housing/i);
  assert.match(html, /only for home buyers/i);
  assert.equal(html.toLowerCase().includes('best neighborhood'), false);
  if (html.includes('application/ld+json')) {
    assert.match(html, /"@type":\s*"WebPage"/);
    assert.doesNotMatch(html, /"@type":\s*"AggregateRating"/);
  }
});
