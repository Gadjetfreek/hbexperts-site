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

test('public journey first view emphasizes now / next / why / resume', () => {
  const ui = read('src/ui-worker.js');
  assert.match(ui, /What happens next/i);
  assert.match(ui, /Start My Buyer Experience/);
  assert.match(ui, /Review &amp; Send to HomeBuyer Experts/);
  assert.match(ui, /Open my Buyer Portal/);
  assert.match(ui, /<details[\s\S]*See all 17 stages/);
  assert.match(ui, /Pause anytime|Come back later|Open my Buyer Portal/i);
  assert.doesNotMatch(ui, /Begin the Buyer Experience/);
  assert.doesNotMatch(ui, /Start the Experience(?!\.)/);
  assert.doesNotMatch(ui, /Open my BuyerUI/);
  assert.doesNotMatch(ui, /does not have to dominate/i);
  assert.doesNotMatch(ui, /YOU ARE HERE|You are here/i);
});

test('refinePublicJourney wraps 17-stage map in details instead of deleting it', () => {
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
  assert.match(refined, /Buyer Experience/);
  assert.doesNotMatch(refined, /Begin the Buyer Experience/);
  assert.doesNotMatch(refined, /Open my BuyerUI/);
  assert.doesNotMatch(refined, /You are here/i);

  // Idempotent wrap
  const twice = wrapPublicRoadmapInDisclosure(refined);
  assert.equal((twice.match(/id="public-journey-stages"/g) || []).length, 1);
});

test('questionnaire skip deeper is only offered inside Parts 3–5 and jumps to Part 6', () => {
  const portal = read('src/portal-worker.js');
  const steps = [...portal.matchAll(/<section class="step[^"]*"[^>]*>([\s\S]*?)<\/section>/g)].map(m => m[1]);
  assert.equal(steps.length, 8, 'expected 8 questionnaire steps');
  assert.match(steps[0], /Part 1/);
  assert.match(steps[1], /Part 2/);
  assert.match(steps[2], /Part 3/);
  assert.match(steps[5], /Part 6/);

  // Parts 1–2 stay on the normal Continue path (What matters is not skipped)
  assert.doesNotMatch(steps[0], /skip-deeper|data-skip-to=/);
  assert.doesNotMatch(steps[1], /skip-deeper|data-skip-to=/);

  // Skip only once the buyer reaches the deeper reflection block
  for (const i of [2, 3, 4]) {
    assert.match(steps[i], /class="btn secondary skip-deeper"/);
    assert.match(steps[i], /data-skip-to="5"/);
    assert.equal((steps[i].match(/data-skip-to="5"/g) || []).length, 1);
  }
  // Part 6+ have no skip control
  for (const i of [5, 6, 7]) {
    assert.doesNotMatch(steps[i], /skip-deeper|data-skip-to=/);
  }

  assert.match(portal, /const target=Number\(b\.dataset\.skipTo\|\|5\);show\(target\)/);
  assert.match(portal, /id="review-before-send"[^>]*type="button"[^>]*>Review &amp; Send to HomeBuyer Experts/);
});

test('every buyer-visible Review & Send control requires review before POST', () => {
  const portal = read('src/portal-worker.js');
  const issue33 = read('src/issue33-production-worker.js');
  const ui = read('src/ui-worker.js');
  const worker = read('src/worker.js');

  // Live gated control
  assert.match(
    portal,
    /<button class="btn primary" id="review-before-send" type="button">Review &amp; Send to HomeBuyer Experts<\/button>/
  );
  assert.doesNotMatch(portal, /type="submit"[^>]*>Review &amp; Send to HomeBuyer Experts</);

  // Middleware rewrite target must also be gated (type=button + review-before-send)
  assert.match(
    issue33,
    /id="review-before-send" type="button">Review &amp; Send to HomeBuyer Experts<\/button>/
  );

  // Dual-build direct-submit paths keep Send label (not Review & Send)
  for (const [name, src] of [['ui-worker', ui], ['worker', worker]]) {
    assert.doesNotMatch(src, /type="submit">Review &amp; Send to HomeBuyer Experts</, name);
    assert.match(src, /type="submit">Send to HomeBuyer Experts</, name);
  }
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

test('VALUE page includes one anonymized illustrative example', () => {
  const value = readFileSync(join(repoRoot, 'content/value.md'), 'utf8');
  assert.match(value, /Illustrative|illustrative/);
  assert.match(value, /One Example|example/i);
  assert.match(value, /not.*testimonials|not.*client story/i);
  assert.doesNotMatch(value, /finishes in \d+ minutes/i);
  assert.doesNotMatch(value, /Scenario B/);
  assert.doesNotMatch(value, /What VALUE Is Not/);
  assert.doesNotMatch(value, /decision-support practice/i);
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
  assert.doesNotMatch(index, /Agency Before Urgency/);
  assert.doesNotMatch(index, /Buyer Advantage/);
  assert.doesNotMatch(index, /consequential decision/i);
});

test('portal focus script still discloses full roadmap after current/next', () => {
  const html = addBuyerFirstClarity(
    '<!doctype html><html><head></head><body><main><div class="i29-map"><div class="i29-stop current"><strong>Consultation</strong></div></div><section class="i29-next"><strong>Schedule the strategy session</strong><small>Turn answers into understanding</small></section></main></body></html>',
    '/portal'
  );
  assert.match(html, />NOW</);
  assert.match(html, /See the full 17-stage journey/);
  assert.doesNotMatch(html, /full journey is here when you want context/i);
});
