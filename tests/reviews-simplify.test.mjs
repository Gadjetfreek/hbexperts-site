/**
 * Reviews page guards (Issue #84): quote + attribution only.
 * Asserts existing excerpts remain, and clutter (freshness, counts,
 * outbound review-source CTAs) stays out of content/reviews.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = join(root, 'content', 'reviews.md');
const cssPath = join(root, 'themes', 'hbe', 'static', 'css', 'style.css');

function read(path) {
  return readFileSync(path, 'utf8');
}

/** Existing excerpts and attributions — do not invent or rewrite. */
const keptQuotes = [
  {
    quote: 'Working with Chris as our Home Buyer Expert was one of the best decisions that my husband and I have made.',
    attribution: 'Julie',
  },
  {
    quote: 'Chris is a very positive member of our group.',
    attribution: 'Marge',
  },
  {
    quote: 'They were very personable.',
    attribution: 'Frank',
  },
  {
    quote: 'Chris is your partner in finding the right home.',
    attribution: 'Barb',
  },
  {
    quote: 'He puts your needs first.',
    attribution: 'Matthew',
  },
  {
    quote: 'Chris was the consumate professional with the right skill set to best assist a home buyer.',
    attribution: 'A Zillow reviewer',
  },
  {
    quote: "I couldn't have asked for a better experience buying my first home.",
    attribution: 'A Zillow reviewer',
  },
  {
    quote: 'Chris was great. He listens very well.',
    attribution: 'A Zillow reviewer',
  },
];

test('reviews markdown exists', () => {
  assert.equal(existsSync(mdPath), true, 'content/reviews.md must exist');
});

test('keeps every existing quote and attribution verbatim', () => {
  const md = read(mdPath);
  for (const { quote, attribution } of keptQuotes) {
    assert.ok(md.includes(quote), `missing quote: ${quote}`);
    assert.ok(
      md.includes(`— ${attribution}`) || md.includes(`class="attribution">— ${attribution}`),
      `missing attribution: ${attribution}`,
    );
  }
});

test('each kept quote uses blockquote + attribution markup', () => {
  const md = read(mdPath);
  const blocks = md.match(/<blockquote>[\s\S]*?<\/blockquote>/g) || [];
  assert.equal(blocks.length, keptQuotes.length, 'expected one blockquote per kept review');
  for (const block of blocks) {
    assert.match(block, /class="attribution"/);
    assert.match(block, /—\s+/);
  }
});

test('forbids freshness / verification-status language', () => {
  const md = read(mdPath).toLowerCase();
  const forbidden = [
    'source information checked',
    'when checked',
    'we checked',
    'checked august',
    'verified',
    'verification',
  ];
  for (const phrase of forbidden) {
    assert.equal(md.includes(phrase), false, `forbidden freshness phrase: ${phrase}`);
  }
});

test('forbids review-count and rating chrome', () => {
  const md = read(mdPath);
  const forbidden = [
    /13 recommendations/i,
    /8 reviews/i,
    /3 team reviews/i,
    /5\.0\s+(overall\s+)?rating/i,
    /rating from 1 review/i,
    /review counts/i,
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(md), false, `forbidden count/rating pattern: ${pattern}`);
  }
});

test('forbids outbound review-source CTAs and platform chrome links', () => {
  const md = read(mdPath).toLowerCase();
  const forbidden = [
    'linkedin.com',
    'angi.com',
    'zillow.com',
    'experience.com',
    'google.com/maps',
    'read the homebuyer experts reviews',
    'read christopher',
    'read the reviews on',
    'view the mirrored',
    'view homebuyer experts on google',
    'check it out',
  ];
  for (const phrase of forbidden) {
    assert.equal(md.includes(phrase), false, `forbidden outbound/source chrome: ${phrase}`);
  }
});

test('front matter no longer promises platform links or verification framing', () => {
  const md = read(mdPath);
  const fm = md.slice(0, md.indexOf('---', 3) + 3);
  assert.equal(/original platform/i.test(fm), false);
  assert.equal(/link(s)? back/i.test(fm), false);
  assert.equal(/verif/i.test(fm), false);
});

test('attribution styles exist for quote-dominant reviews', () => {
  const css = read(cssPath);
  assert.match(css, /\.page-content blockquote \.attribution/);
  assert.match(css, /\.page-content blockquote > p:first-child/);
});
