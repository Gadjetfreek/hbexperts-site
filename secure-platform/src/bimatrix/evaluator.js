const CLASSIFICATIONS = new Set(['likely', 'worth_checking', 'not_match', 'info_missing']);

function hasFact(facts, key) {
  return Object.prototype.hasOwnProperty.call(facts, key) && facts[key] !== null && facts[key] !== undefined && facts[key] !== '';
}

function compare(rule, facts) {
  const keys = rule.fact_keys || [];
  const missing = keys.filter((key) => !hasFact(facts, key));
  if (missing.length) return { outcome: 'missing', missing };

  const value = facts[keys[0]];
  const comparison = rule.comparison;

  switch (rule.operator) {
    case 'present':
      return { outcome: 'pass' };
    case 'equals':
      return { outcome: Object.is(value, comparison) ? 'pass' : 'fail' };
    case 'not_equals':
      return { outcome: !Object.is(value, comparison) ? 'pass' : 'fail' };
    case 'in':
      return { outcome: Array.isArray(comparison) && comparison.includes(value) ? 'pass' : 'fail' };
    case 'not_in':
      return { outcome: Array.isArray(comparison) && !comparison.includes(value) ? 'pass' : 'fail' };
    case 'gte':
      return { outcome: Number(value) >= Number(comparison) ? 'pass' : 'fail' };
    case 'lte':
      return { outcome: Number(value) <= Number(comparison) ? 'pass' : 'fail' };
    case 'between_inclusive': {
      const [min, max] = comparison || [];
      return { outcome: Number(value) >= Number(min) && Number(value) <= Number(max) ? 'pass' : 'fail' };
    }
    case 'lte_lookup':
    case 'gte_lookup': {
      const table = comparison?.table || {};
      const keyFact = comparison?.key_fact;
      const valueFact = comparison?.value_fact;
      if (!keyFact || !valueFact || !hasFact(facts, keyFact) || !hasFact(facts, valueFact)) {
        const lookupMissing = [keyFact, valueFact].filter((key) => key && !hasFact(facts, key));
        return { outcome: 'missing', missing: lookupMissing.length ? lookupMissing : keys };
      }
      const threshold = table[String(facts[keyFact])];
      if (threshold === undefined || threshold === null) return { outcome: 'unresolved' };
      const actual = Number(facts[valueFact]);
      const pass = rule.operator === 'lte_lookup' ? actual <= Number(threshold) : actual >= Number(threshold);
      return { outcome: pass ? 'pass' : 'fail', threshold };
    }
    case 'geography_in':
      return { outcome: Array.isArray(comparison) && comparison.includes(value) ? 'pass' : 'fail' };
    default:
      return { outcome: 'unresolved' };
  }
}

export function evaluateProgram(program, facts, { evaluatedAt = new Date().toISOString() } = {}) {
  if (!program || !Array.isArray(program.rules)) throw new TypeError('Program with rules[] is required');
  if (!facts || typeof facts !== 'object') throw new TypeError('facts object is required');

  const reasons = [];
  const missingFactKeys = new Set();
  const externalChecks = new Set();
  let hasHardFailure = false;
  let hasMissing = false;
  let hasWorthChecking = false;

  for (const rule of program.rules) {
    const result = compare(rule, facts);
    let effect = null;

    if (result.outcome === 'fail') {
      effect = rule.failure_effect;
      if (effect === 'not_match') hasHardFailure = true;
      if (effect === 'worth_checking') hasWorthChecking = true;
    } else if (result.outcome === 'missing') {
      effect = rule.missing_effect;
      for (const key of result.missing || rule.fact_keys || []) missingFactKeys.add(key);
      if (effect === 'info_missing') hasMissing = true;
      if (effect === 'worth_checking') hasWorthChecking = true;
    } else if (result.outcome === 'unresolved') {
      effect = 'worth_checking';
      hasWorthChecking = true;
    }

    if (rule.external_dependency) {
      externalChecks.add(rule.rule_id);
      if (result.outcome === 'pass') hasWorthChecking = true;
    }

    reasons.push({
      rule_id: rule.rule_id,
      outcome: rule.external_dependency && result.outcome === 'pass' ? 'external' : result.outcome,
      effect,
      fact_keys: rule.fact_keys || [],
      threshold: result.threshold ?? null
    });
  }

  let classification;
  if (hasHardFailure) classification = 'not_match';
  else if (hasMissing) classification = 'info_missing';
  else if (hasWorthChecking || externalChecks.size) classification = 'worth_checking';
  else classification = 'likely';

  if (!CLASSIFICATIONS.has(classification)) throw new Error('Invalid classification');

  if (['paused', 'exhausted', 'unknown'].includes(program.status) && classification === 'likely') {
    classification = 'worth_checking';
  }
  if (['closed', 'retired'].includes(program.status)) {
    classification = 'not_match';
    reasons.unshift({
      rule_id: 'program-availability',
      outcome: 'fail',
      effect: 'not_match',
      fact_keys: [],
      threshold: null
    });
  }

  return {
    program_id: program.program_id,
    program_version: String(program.version),
    classification,
    evaluated_at: evaluatedAt,
    reasons,
    missing_fact_keys: [...missingFactKeys].sort(),
    external_checks: [...externalChecks].sort()
  };
}

export function assistanceAmount(program, facts) {
  if (program.program_id !== 'ohfa-down-payment-assistance') return null;
  const price = Number(facts['property.purchase_price']);
  const loanType = facts['financing.type'];
  if (!Number.isFinite(price) || price <= 0 || !loanType) return null;
  if (loanType === 'conventional') return Math.round(price * 0.03 * 100) / 100;
  if (['FHA', 'VA', 'USDA-RD'].includes(loanType)) return Math.round(price * 0.035 * 100) / 100;
  return null;
}
