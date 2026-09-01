import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateProgram, assistanceAmount } from '../src/bimatrix/evaluator.js';
import { evaluateSourceText, summarizeFreshness, renderBimatrixPanel } from '../src/bimatrix/freshness.js';

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const akron = await loadJson('../bimatrix/catalog/akron-dreams.json');
const ohfa = await loadJson('../bimatrix/catalog/ohfa-down-payment-assistance.json');

test('Akron Dreams hard geography mismatch is not_match', () => {
  const result = evaluateProgram(akron, {
    'target.municipality': 'Canton',
    'household.property_owner_within_3_years': false,
    'occupancy.intended': 'primary_residence',
    'credit.score': 700,
    'household.size': 2,
    'household.gross_income': 60000,
    'financing.preapproved': true,
    'financing.fixed_rate_30_year': true,
    'education.hud_homebuyer_8hr_current': true,
    'credit.bankruptcy_or_foreclosure_within_2_years': false,
    'household.liquid_assets': 10000,
    'property.units': 1,
    'program.akron_dreams_funding_confirmed': true,
    'property.purchase_price': 180000,
    'program.akron_dreams_current_value_limit': 220000
  }, { evaluatedAt: '2026-09-01T12:00:00Z' });
  assert.equal(result.classification, 'not_match');
  assert.ok(result.reasons.some(r => r.rule_id === 'akron-city-limits' && r.outcome === 'fail'));
});

test('Akron Dreams missing income produces info_missing and names facts', () => {
  const result = evaluateProgram(akron, {
    'target.municipality': 'Akron',
    'household.property_owner_within_3_years': false,
    'occupancy.intended': 'primary_residence',
    'credit.score': 700
  });
  assert.equal(result.classification, 'info_missing');
  assert.ok(result.missing_fact_keys.includes('household.size'));
  assert.ok(result.missing_fact_keys.includes('household.gross_income'));
});

test('Akron Dreams clean known facts remains worth_checking until live external checks resolve', () => {
  const result = evaluateProgram(akron, {
    'target.municipality': 'Akron',
    'household.property_owner_within_3_years': false,
    'occupancy.intended': 'primary_residence',
    'credit.score': 700,
    'household.size': 2,
    'household.gross_income': 60000,
    'financing.preapproved': true,
    'financing.fixed_rate_30_year': true,
    'education.hud_homebuyer_8hr_current': true,
    'credit.bankruptcy_or_foreclosure_within_2_years': false,
    'household.liquid_assets': 10000,
    'property.units': 1,
    'program.akron_dreams_funding_confirmed': true,
    'property.purchase_price': 180000,
    'program.akron_dreams_current_value_limit': 220000
  });
  assert.equal(result.classification, 'worth_checking');
  assert.ok(result.external_checks.includes('funding-availability'));
});

test('OHFA DPA computes 3% conventional and 3.5% government assistance', () => {
  assert.equal(assistanceAmount(ohfa, { 'property.purchase_price': 200000, 'financing.type': 'conventional' }), 6000);
  assert.equal(assistanceAmount(ohfa, { 'property.purchase_price': 200000, 'financing.type': 'FHA' }), 7000);
  assert.equal(assistanceAmount(ohfa, { 'property.purchase_price': 200000, 'financing.type': 'VA' }), 7000);
});

test('OHFA DPA credit score below selected loan threshold is not_match', () => {
  const result = evaluateProgram(ohfa, {
    'target.state': 'OH',
    'financing.type': 'FHA',
    'credit.score': 640,
    'occupancy.intended': 'primary_residence',
    'target.county': 'Summit',
    'household.size': 2,
    'household.gross_income': 65000,
    'property.target_area_status': 'non_target',
    'property.purchase_price': 200000,
    'household.primary_residence_owned_within_3_years': false,
    'buyer.honorably_discharged_veteran': false,
    'program.ohfa_path': 'first_time',
    'financing.ohfa_approved_lender_confirmed': true,
    'financing.dti_approved': true,
    'program.ohfa_current_rate_comparison_reviewed': true
  });
  assert.equal(result.classification, 'not_match');
  assert.ok(result.reasons.some(r => r.rule_id === 'credit-score-conventional-va-usda' && r.outcome === 'fail'));
});

test('OHFA DPA cannot become likely while county limits/path/rate remain external', () => {
  const result = evaluateProgram(ohfa, {
    'target.state': 'OH',
    'financing.type': 'conventional',
    'credit.score': 700,
    'occupancy.intended': 'primary_residence',
    'target.county': 'Summit',
    'household.size': 2,
    'household.gross_income': 65000,
    'property.target_area_status': 'non_target',
    'property.purchase_price': 200000,
    'household.primary_residence_owned_within_3_years': false,
    'buyer.honorably_discharged_veteran': false,
    'program.ohfa_path': 'first_time',
    'financing.ohfa_approved_lender_confirmed': true,
    'financing.dti_approved': true,
    'program.ohfa_current_rate_comparison_reviewed': true
  });
  assert.equal(result.classification, 'worth_checking');
  assert.ok(result.external_checks.length >= 1);
});

test('freshness source verifier distinguishes current, changed, and unavailable', () => {
  const source = { source_id: 'test', label: 'Test Program', markers: ['down payment assistance', '3.5%'] };
  assert.equal(evaluateSourceText(source, 200, 'Down Payment Assistance is 3.5%').outcome, 'current');
  assert.equal(evaluateSourceText(source, 200, 'Down Payment Assistance changed').outcome, 'review_pending');
  assert.equal(evaluateSourceText(source, 503, '').outcome, 'unavailable');
});

test('freshness summary fails safely toward HBE review', () => {
  assert.equal(summarizeFreshness([{ outcome: 'current' }, { outcome: 'current' }]), 'current');
  assert.equal(summarizeFreshness([{ outcome: 'current' }, { outcome: 'review_pending' }]), 'review_pending');
  assert.equal(summarizeFreshness([{ outcome: 'current' }, { outcome: 'unavailable' }]), 'unavailable');
});

test('BuyerUI panel uses final Last updated / Update now wording', () => {
  const html = renderBimatrixPanel({ csrfField: '<input name="csrf" value="safe">' });
  assert.match(html, /Last updated:/);
  assert.match(html, />Update now</);
  assert.match(html, /Possible Assistance/);
  assert.match(html, /Akron Dreams 2026/);
  assert.match(html, /OHFA Down Payment Assistance/);
  assert.doesNotMatch(html, /Likely|Not a Match|Info Missing/);
});
