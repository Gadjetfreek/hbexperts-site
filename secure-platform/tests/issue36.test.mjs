import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuyerFirstClarity } from '../src/issue33-production-worker.js';

const questionnaire = `<!doctype html><html><head></head><body><main><form id="buyerExperienceForm" method="post" action="/api/intake" novalidate><input name="first_name" required><input name="last_name" required><input type="email" name="email" required><textarea name="why"></textarea><input name="timeline"><input name="location"><textarea name="concerns"></textarea><textarea name="notes"></textarea><div class="submitbox"><strong>This is the moment HBE receives your information.</strong><p>Submitting creates your private buyer record and alerts HBE that your Buyer Experience is ready for review. HBE will store what you actually submitted; unanswered reflective questions remain unanswered.</p><button class="btn primary" type="submit">Submit to HBE</button></div></form></main></body></html>`;

test('questionnaire adds plain-English buyer-only explanation', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /helps people buy homes/i);
  assert.match(html, /only for home buyers/i);
  assert.match(html, /never for the seller/i);
  assert.match(html, /walk away/i);
});

test('questionnaire requires review before final submission', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /Review before sending/);
  assert.match(html, /Here is what HBE will receive/);
  assert.match(html, /Back and edit/);
  assert.match(html, /Send to HomeBuyer Experts/);
  assert.match(html, /does not hire HBE/i);
  assert.match(html, /does not.*sign an agency agreement/i);
  assert.match(html, /does not.*obligate you to buy/i);
  assert.doesNotMatch(html, />Submit to HBE<\/button>/);
});

test('pre-submit review preserves the existing intake action', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /action="\/api\/intake"/);
  assert.match(html, /form\.requestSubmit\(\)/);
});

test('review UI does not expose invitation token values', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /hidden=new Set\(\['household_invite_token'\]\)/);
});

test('open-ended typed answers receive suggestions and explicit uncertainty permission', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /buyer-guided-answer-script/);
  assert.match(html, /Need a starting point\?/);
  assert.match(html, /It is okay not to know yet/);
  assert.match(html, /I’m not sure yet/);
  assert.match(html, /why:\{help:/);
  assert.match(html, /timeline:\{help:/);
  assert.match(html, /location:\{help:/);
  assert.match(html, /concerns:\{help:/);
  assert.match(html, /notes:\{help:/);
  assert.doesNotMatch(html, /first_name:\{help:/);
  assert.doesNotMatch(html, /email:\{help:/);
});

test('public journey gets buyer-only explanation without submission dialog markup', () => {
  const home = '<!doctype html><html><head></head><body><main><h1>Journey</h1></main></body></html>';
  const html = addBuyerFirstClarity(home, '/');
  assert.match(html, /helps people buy homes/i);
  assert.doesNotMatch(html, /id="buyer-review-backdrop"/);
  assert.doesNotMatch(html, /id="buyer-first-review-script"/);
});

test('buyer portal gets a focused Now Next Why Time layer while preserving expandable detail', () => {
  const portal = '<!doctype html><html><head></head><body><main><div class="i29-map"><div class="i29-stop current"><strong>Consultation</strong></div></div><section class="i29-next"><div>What’s Next</div><h2>Highest priority right now</h2><strong>Schedule the strategy session</strong><small>Turn answers into understanding</small></section><section class="i29-story"></section><section class="i29-compass"></section><section class="i29-checklist"></section><section class="i29-comp"></section></main></body></html>';
  const html = addBuyerFirstClarity(portal, '/portal');
  assert.match(html, /buyer-portal-focus-script/);
  assert.match(html, /YOU ARE HERE/);
  assert.match(html, /Best next step/);
  assert.match(html, /Why this matters/);
  assert.match(html, /Time/);
  assert.match(html, /See the full 17-stage journey/);
  assert.match(html, /Current-step checklist/);
});
