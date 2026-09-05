/**
 * Issue #67 — public copy clarity smoke.
 * Fails on banned internal/UX-rationale phrases in touched buyer-facing surfaces,
 * and asserts Home / VALUE / Strategy / Journey still have one clear Explore/Start CTA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');

function readRepo(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function readSp(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const BANNED = [
  /does not have to dominate/i,
  /attention architecture/i,
  /progressive disclosure/i,
  /decision-support practice/i
];

const BUYER_FACING = [
  'themes/hbe/layouts/index.html',
  'themes/hbe/layouts/partials/journey-cta.html',
  'themes/hbe/layouts/_default/assessment.html',
  'content/_index.md',
  'content/value.md',
  'content/strategy-session.md',
  'content/relocation.md',
  'content/about.md',
  'secure-platform/src/ui-worker.js',
  'secure-platform/src/portal-worker.js',
  'secure-platform/src/issue29-production-worker.js',
  'secure-platform/src/issue33-production-worker.js',
  'secure-platform/src/buyer-guidance.js'
];

test('banned internal phrases are absent from touched buyer-facing surfaces', () => {
  for (const rel of BUYER_FACING) {
    const text = readRepo(rel);
    for (const pattern of BANNED) {
      // Allow health-metadata key inside issue33 only if present as JSON field name —
      // but ban the buyer-facing prose forms. attention_architecture as API key is
      // internal; still fail if the spaced phrase appears in HTML/markdown copy.
      if (pattern.source.includes('attention architecture') && rel.endsWith('issue33-production-worker.js')) {
        assert.doesNotMatch(text, /attention architecture/i, rel);
        continue;
      }
      assert.doesNotMatch(text, pattern, `${rel} matched ${pattern}`);
    }
  }
});

test('Home, VALUE, Strategy Session keep Explore the Buyer Journey CTA', () => {
  for (const rel of [
    'themes/hbe/layouts/index.html',
    'content/value.md',
    'content/strategy-session.md',
    'content/_index.md'
  ]) {
    assert.match(readRepo(rel), /Explore the Buyer Journey/, rel);
  }
});

test('public journey landing keeps Start My Buyer Experience and Open my Buyer Portal', () => {
  const ui = readSp('src/ui-worker.js');
  const explorer = ui.slice(ui.indexOf('function explorer()'), ui.indexOf('function page(body)'));
  assert.match(explorer, /Start My Buyer Experience/);
  assert.match(explorer, /Open my Buyer Portal/);
  assert.match(explorer, /Nothing is sent until you review and send it/);
  assert.match(explorer, /See all 17 stages/);
  assert.doesNotMatch(explorer, /START HERE|buyer-focus-card/);
});

test('VALUE page is compressed to one illustrative example with CTA', () => {
  const value = readRepo('content/value.md');
  assert.match(value, /\*\*Values\*\*/);
  assert.match(value, /\*\*Alternatives\*\*/);
  assert.match(value, /\*\*Learning\*\*/);
  assert.match(value, /\*\*Uncertainty\*\*/);
  assert.match(value, /\*\*Evidence\*\*/);
  assert.match(value, /What This Means for You|what this means for you/i);
  assert.match(value, /Explore the Buyer Journey/);
  assert.equal((value.match(/### Scenario/g) || []).length, 0);
});

test('Strategy Session states no-pressure once and CTA early', () => {
  const strategy = readRepo('content/strategy-session.md');
  assert.match(strategy, /no cost, no obligation, and no sales pressure/i);
  const firstCta = strategy.indexOf('Explore the Buyer Journey');
  const secondNoPressureBlock = strategy.indexOf('What This Is — and What It Isn');
  assert.ok(firstCta >= 0);
  assert.equal(secondNoPressureBlock, -1, 'old repeated no-pressure section should be gone');
  // CTA appears before "What Happens Next" deep steps end — at least before Fair Housing
  assert.ok(firstCta < strategy.indexOf('## Fair Housing'), 'primary Journey CTA should appear before Fair Housing');
});

test('portal keeps Prefer not to answer and review-before-send gate', () => {
  const portal = readSp('src/portal-worker.js');
  assert.match(portal, /Prefer not to answer/);
  assert.match(portal, /id="review-before-send"[^>]*type="button"/);
  assert.match(portal, /Skip deeper optional questions/);
});
