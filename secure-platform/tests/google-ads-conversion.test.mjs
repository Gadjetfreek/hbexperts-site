import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOOGLE_ADS_ID,
  addGoogleAdsSubmissionConversion,
  allowGoogleAdsForSubmission,
  normalizeConversionLabel
} from '../src/google-ads-conversion.js';

const root = join(import.meta.dirname, '..', '..');
const html = '<!doctype html><html><head><title>Done</title></head><body>Submitted</body></html>';

test('base tag is added without inventing or sending a conversion label', () => {
  const out = addGoogleAdsSubmissionConversion(html);
  assert.match(out, new RegExp(`gtag/js\\?id=${GOOGLE_ADS_ID}`));
  assert.match(out, new RegExp(`gtag\\('config','${GOOGLE_ADS_ID}'\\)`));
  assert.doesNotMatch(out, /send_to/);
  assert.match(out, /hbe:buyer-experience-submitted/);
});

test('a deployment-provided label enables exactly one non-sensitive conversion call', () => {
  const out = addGoogleAdsSubmissionConversion(html, 'AbC_123-xYz');
  assert.equal((out.match(/'conversion'/g) || []).length, 1);
  assert.match(out, /send_to:'AW-18500305800\/AbC_123-xYz'/);
  assert.doesNotMatch(out, /email|phone|questionnaire|buyer_id|household/i);
});

test('invalid labels fail closed and injection is idempotent', () => {
  assert.equal(normalizeConversionLabel('bad/value'), '');
  const once = addGoogleAdsSubmissionConversion(html, 'valid-label');
  assert.equal(addGoogleAdsSubmissionConversion(once, 'valid-label'), once);
  assert.doesNotMatch(addGoogleAdsSubmissionConversion(html, 'bad/value'), /send_to/);
});

test('submission response CSP permits only the Google endpoints needed by the tag', () => {
  const headers = new Headers({
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:;"
  });
  const csp = allowGoogleAdsForSubmission(headers).get('content-security-policy');
  assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/www\.google\.com[^;]*https:\/\/www\.googleadservices\.com/);
  assert.match(csp, /img-src[^;]*https:\/\/www\.googleadservices\.com/);
});

test('public base tag is scoped to the buyer representation landing page', () => {
  const layout = readFileSync(join(root, 'themes/hbe/layouts/_default/baseof.html'), 'utf8');
  assert.match(layout, /if eq \.RelPermalink "\/buyer-representation\/"/);
  assert.equal((layout.match(/AW-18500305800/g) || []).length, 2);
});

test('production worker gates Google injection on successful intake only', () => {
  const worker = readFileSync(join(root, 'secure-platform/src/issue33-production-worker.js'), 'utf8');
  assert.match(worker, /request\.method === 'POST'/);
  assert.match(worker, /url\.pathname === '\/api\/intake'/);
  assert.match(worker, /response\.status >= 200 && response\.status < 300/);
  assert.match(worker, /env\.GOOGLE_ADS_CONVERSION_LABEL/);
});
