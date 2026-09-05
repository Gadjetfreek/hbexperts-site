import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { refinePublicJourney, wrapPublicRoadmapInDisclosure } from '../src/issue29-production-worker.js';
import { addBuyerFirstClarity } from '../src/issue33-production-worker.js';
import { stageMapHtml } from '../src/issue29-ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test('public journey first view emphasizes You are here / next / why / time / resume', () => {
  const ui = read('src/ui-worker.js');
  assert.match(ui, /YOU ARE HERE|You are here/i);
  assert.match(ui, /What happens next/i);
  assert.match(ui, /Start My Buyer Experience/);
  assert.match(ui, /Review &amp; Send to HomeBuyer Experts/);
  assert.match(ui, /Open my Buyer Portal/);
  assert.match(ui, /<details[\s\S]*See all 17 stages/);
  assert.match(ui, /pause anytime|come back/i);
  assert.doesNotMatch(ui, /Begin the Buyer Experience/);
  assert.doesNotMatch(ui, /Start the Experience(?!\.)/);
  assert.doesNotMatch(ui, /Open my BuyerUI/);
});

test('refinePublicJourney wraps 17-stage map in progressive disclosure instead of deleting it', () => {
  const map = stageMapHtml({
    currentStage: 'buyerExperience',
    completed: [],
    actor: { kind: 'buyer' },
    hrefFor: id => `/#stage-${id}`
  });
  const html = `<!doctype html><html><head></head><body>
    <h1>Your HomeBuyer journey, from first questions to keys.</h1>
    <a href="/questionnaire">Begin the Buyer Experience</a>
    ${map}
    <div class="actions"><a href="/questionnaire">Start the Experience</a><a href="/login">Open my BuyerUI</a></div>
    <div class="value-context"><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div>
  </body></html>`;

  const refined = refinePublicJourney(html);
  assert.match(refined, /id="public-journey-stages"/);
  assert.match(refined, /<details[\s\S]*See all 17 stages/);
  assert.match(refined, /class="i29-map"/);
  assert.equal((refined.match(/class="i29-stop /g) || []).length, 17);
  assert.match(refined, /Start My Buyer Experience/);
  assert.match(refined, /Open my Buyer Portal/);
  assert.doesNotMatch(refined, /Begin the Buyer Experience/);
  assert.doesNotMatch(refined, /Open my BuyerUI/);

  // Idempotent wrap
  const twice = wrapPublicRoadmapInDisclosure(refined);
  assert.equal((twice.match(/id="public-journey-stages"/g) || []).length, 1);
});

test('questionnaire offers skip deeper optional path past personality blocks', () => {
  const portal = read('src/portal-worker.js');
  assert.match(portal, /skip-deeper/);
  assert.match(portal, /Skip deeper optional questions/);
  assert.match(portal, /data-skip-to="5"/);
  assert.match(portal, /Skipping them does not reduce the quality/);
  assert.match(portal, /Review &amp; Send to HomeBuyer Experts/);
  assert.match(portal, /querySelectorAll\('\.skip-deeper'\)\.forEach/);
});

test('buyer-facing naming smoke: no stale Submit to HBE / Buyer Discovery Experience in touched surfaces', () => {
  const files = [
    'src/ui-worker.js',
    'src/portal-worker.js',
    'src/issue29-production-worker.js',
    'src/issue33-production-worker.js'
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(text, /Buyer Discovery Experience/, rel);
    // Allow historical replace patterns targeting Submit to HBE in issue33
    if (rel.includes('issue33-production-worker.js')) {
      assert.match(text, /Submit to HBE/); // replacement source patterns
      assert.match(text, /Review &amp; Send to HomeBuyer Experts/);
      continue;
    }
    assert.doesNotMatch(text, />Submit to HBE</, rel);
  }

  const strategy = readFileSync(join(repoRoot, 'content/strategy-session.md'), 'utf8');
  const value = readFileSync(join(repoRoot, 'content/value.md'), 'utf8');
  const index = readFileSync(join(repoRoot, 'themes/hbe/layouts/index.html'), 'utf8');
  for (const [name, text] of [['strategy', strategy], ['value', value], ['index', index]]) {
    assert.doesNotMatch(text, /Submit to HBE/, name);
    assert.doesNotMatch(text, /Buyer Discovery Experience/, name);
    assert.match(text, /Explore the Buyer Journey/, name);
  }
  assert.match(strategy, /Start My Buyer Experience/);
  assert.match(strategy, /Review & Send to HomeBuyer Experts/);
});

test('VALUE page includes anonymized demonstration section', () => {
  const value = readFileSync(join(repoRoot, 'content/value.md'), 'utf8');
  assert.match(value, /VALUE in Practice/);
  assert.match(value, /Illustrative/);
  assert.match(value, /Scenario A/);
  assert.match(value, /Scenario B/);
  assert.match(value, /not.*testimonials|not client stories/i);
  assert.doesNotMatch(value, /finishes in \d+ minutes/i);
});

test('homepage keeps one clear primary Journey CTA ahead of secondary VALUE link', () => {
  const index = readFileSync(join(repoRoot, 'themes/hbe/layouts/index.html'), 'utf8');
  const hero = index.match(/<div class="hero-cta">[\s\S]*?<\/div>/)[0];
  const primaryAt = hero.indexOf('btn-primary');
  const secondaryAt = hero.indexOf('btn-secondary');
  assert.ok(primaryAt >= 0 && secondaryAt >= 0);
  assert.ok(primaryAt < secondaryAt, 'primary Journey CTA should appear before secondary VALUE link');
  assert.match(hero, /Explore the Buyer Journey/);
  assert.doesNotMatch(hero, /questionnaire/);
});

test('portal focus script still discloses full roadmap after current/next', () => {
  const html = addBuyerFirstClarity(
    '<!doctype html><html><head></head><body><main><div class="i29-map"><div class="i29-stop current"><strong>Consultation</strong></div></div><section class="i29-next"><strong>Schedule the strategy session</strong><small>Turn answers into understanding</small></section></main></body></html>',
    '/portal'
  );
  assert.match(html, /YOU ARE HERE/);
  assert.match(html, /See the full 17-stage journey/);
});
