import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addBuyerFirstClarity } from '../src/issue33-production-worker.js';

const CONSENT = 'By submitting, you agree HomeBuyer Experts may call or email you about your home search.';
const PRIVACY = 'https://hbexperts.com/privacy/';
const FAIR_HOUSING = 'https://hbexperts.com/fair-housing/';
const EHO_IMG = 'https://www.hud.gov/sites/dfiles/FHEO/images/fheo100.gif';

const questionnaire = `<!doctype html><html><head></head><body><main><form id="buyerExperienceForm" method="post" action="/api/intake" novalidate><input name="first_name" required><input name="last_name" required><input type="email" name="email" required><textarea name="why"></textarea><div class="submitbox"><strong>This is the moment HBE receives your information.</strong><p>Submitting creates your private buyer record and alerts HBE that your Buyer Experience is ready for review. HBE will store what you actually submitted; unanswered reflective questions remain unanswered.</p><button class="btn primary" type="submit">Submit to HBE</button></div></form></main></body></html>`;

function assertCompliance(html) {
  assert.match(html, /id="hbe-qx-compliance-footer"/);
  assert.match(html, /HomeBuyer Experts LLC/);
  assert.match(html, /Broker of Record Christopher Whitehead/);
  assert.match(html, /Ohio license #2005015772/);
  assert.match(html, new RegExp(PRIVACY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, />Privacy Policy</);
  assert.match(html, /Equal Housing Opportunity/);
  assert.match(html, new RegExp(EHO_IMG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(FAIR_HOUSING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /id="hbe-qx-contact-consent"/);
  assert.match(html, new RegExp(CONSENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const submitbox = html.match(/<div class="submitbox">[\s\S]*?<\/div>/);
  assert.ok(submitbox, 'submit box should exist');
  assert.match(submitbox[0], /id="hbe-qx-contact-consent"/);
  assert.match(submitbox[0], new RegExp(CONSENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /id="hbe-qx-review-consent"/);
  const review = html.match(/<section class="buyer-review"[\s\S]*?<\/section>/);
  assert.ok(review, 'review dialog should exist');
  assert.match(review[0], new RegExp(CONSENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /text(?:ing|s)?(?:\s|\/|,| or )*SMS|SMS(?:\s|\/|,| or )*text/i);
  assert.doesNotMatch(html, /\$\d|percent of|commission rate|flat fee of/i);
}

test('questionnaire receives a compliance footer, EHO, privacy link, and call-or-email consent', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assertCompliance(html);
  assert.match(html, /id="buyer-first-clarity"/);
});

test('compliance footer and consent are idempotent and stay off other pages', () => {
  const once = addBuyerFirstClarity(questionnaire, '/questionnaire');
  const twice = addBuyerFirstClarity(once, '/questionnaire');
  assert.equal(twice.split('id="hbe-qx-compliance-footer"').length - 1, 1);
  assert.equal(twice.split('id="hbe-qx-contact-consent"').length - 1, 1);
  assert.equal(twice.split('id="hbe-qx-review-consent"').length - 1, 1);

  const login = addBuyerFirstClarity('<!doctype html><html><head></head><body><main><h1>Sign in</h1></main></body></html>', '/login');
  assert.doesNotMatch(login, /id="hbe-qx-compliance-footer"/);
  assert.doesNotMatch(login, /id="hbe-qx-contact-consent"/);
  assert.doesNotMatch(login, /id="hbe-qx-review-consent"/);
  assert.doesNotMatch(login, /<footer class="hbe-qx-compliance-footer"/);

  const home = addBuyerFirstClarity('<!doctype html><html><head></head><body><main class="wrap journey-landing"><a href="/questionnaire">Start</a></main></body></html>', '/');
  assert.doesNotMatch(home, /id="hbe-qx-compliance-footer"/);
  assert.doesNotMatch(home, /id="hbe-qx-contact-consent"/);
  assert.doesNotMatch(home, /<footer class="hbe-qx-compliance-footer"/);
});

test('live portal questionnaire gets the same compliance footer and consent', () => {
  const portal = readFileSync(new URL('../src/portal-worker.js', import.meta.url), 'utf8');
  const match = portal.match(/function questionnairePage[\s\S]*?return `<!doctype html>[\s\S]*?<\/html>`/);
  assert.ok(match, 'portal questionnairePage template should be found');
  const template = match[0].match(/`<!doctype html>[\s\S]*?<\/html>`/)[0].slice(1, -1);
  const html = addBuyerFirstClarity(template, '/questionnaire');
  assertCompliance(html);
});
