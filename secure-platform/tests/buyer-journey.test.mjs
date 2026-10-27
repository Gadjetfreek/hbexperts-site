import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyFacts, templateJourney, generateJourney, handleJourney, journeyPanelHtml, JOURNEY_PATH } from '../src/buyer-journey.js';
import { STAGES } from '../src/journey-stages.js';

// Synthetic fixture only.
const BUYER = { id: 'b-test', first_name: 'Sam', stage: 'consultation', completed_stages: '["buyerExperience"]',
  answers_json: JSON.stringify({ why: 'We need more room for a home office', decision_style: 'Careful, wants options side by side', info_preference: 'Short written summaries', concerns: ['Rising rates'], timeline: 'Within a year' }) };
const OWNER = { ok: true, professional: { email: 'cwhitehead@hbexperts.com' } };
const auth = { authenticate: async () => OWNER };
const ORIGIN = 'https://buyer.hbexperts.com';

function fakeDb() {
  const t = { j: new Map(), gens: [] };
  return { t, prepare(sql) { return { bind(...a) { return {
    async first() {
      if (sql.startsWith('SELECT id,first_name')) return a[0] === BUYER.id ? BUYER : null;
      if (sql.includes('FROM hbe_buyer_journeys')) return t.j.get(a[0]) || null;
      if (sql.includes('COUNT(*)')) { const g = t.gens.filter(x => x.created_at > a[1]); const mine = g.filter(x => x.buyer_id === a[0]).map(x => x.created_at).sort(); return { n: g.length, last: mine.at(-1) || null }; }
    },
    async run() {
      if (sql.startsWith('INSERT INTO hbe_buyer_journey_generations')) { t.gens.push({ buyer_id: a[0], created_at: a[1] }); return { meta: { changes: 1 } }; }
      if (sql.startsWith('INSERT INTO hbe_buyer_journeys')) { t.j.set(a[0], { buyer_id: a[0], body: a[1], source: a[2], model: a[3], stage_at_generation: a[4], generated_at: a[5], edited_at: null }); return { meta: { changes: 1 } }; }
      if (sql.startsWith('UPDATE hbe_buyer_journeys')) { const r = t.j.get(a[2]); if (!r) return { meta: { changes: 0 } }; r.body = a[0]; r.edited_at = a[1]; r.source = r.source.endsWith('edited') ? r.source : r.source + '+edited'; return { meta: { changes: 1 } }; }
    } }; } }; } };
}
const post = body => new Request(ORIGIN + JOURNEY_PATH, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('facts split past / current / ahead from the 17 stages', () => {
  const f = journeyFacts(BUYER);
  assert.equal(f.past.length, 1); assert.equal(f.current.id, 'consultation'); assert.equal(f.ahead.length, STAGES.length - 2);
});

test('template uses only provided answers, with tense sections', () => {
  const s = templateJourney(journeyFacts(BUYER));
  for (const h of ['Their story', 'Based on their style', 'Where they have been', 'Where they are now', "What's ahead"]) assert.ok(s.includes(h), h);
  assert.match(s, /home office/); assert.match(s, /is in Stage 2, Consultation/); assert.match(s, /they will /); assert.match(s, /completed this stage/);
  const empty = templateJourney(journeyFacts({ first_name: 'Sam', stage: 'buyerExperience', answers_json: '{}' }));
  assert.match(empty, /not yet described|not shared yet/);
});

test('falls back to template when AI fails or is missing', async () => {
  const g1 = await generateJourney({ AI: { run: async () => { throw new Error('quota'); } } }, journeyFacts(BUYER));
  assert.equal(g1.source, 'template');
  const g2 = await generateJourney({}, journeyFacts(BUYER));
  assert.equal(g2.source, 'template');
  const good = 'Their story\n' + 'x'.repeat(300) + '\nWhere they are now\nSam is here.';
  const g3 = await generateJourney({ AI: { run: async () => ({ response: good }) } }, journeyFacts(BUYER));
  assert.equal(g3.source, 'ai');
});

test('generate, read, edit, rate-limit, owner-only', async () => {
  const env = { BUYER_DB: fakeDb() };
  const logs = []; const orig = console.log; console.log = m => logs.push(String(m));
  try {
    let r = await handleJourney(post({ action: 'generate', buyer: 'b-test' }), env, new URL(ORIGIN + JOURNEY_PATH), auth);
    assert.equal(r.status, 200); const j = (await r.json()).journey; assert.equal(j.source, 'template'); assert.equal(j.stage_at_generation, 'consultation');
    r = await handleJourney(post({ action: 'generate', buyer: 'b-test' }), env, new URL(ORIGIN + JOURNEY_PATH), auth);
    assert.equal(r.status, 429);
    r = await handleJourney(post({ action: 'save', buyer: 'b-test', body: 'edited draft' }), env, new URL(ORIGIN + JOURNEY_PATH), auth);
    const saved = (await r.json()).journey; assert.equal(saved.body, 'edited draft'); assert.ok(saved.edited_at);
    const g = await handleJourney(new Request(ORIGIN + JOURNEY_PATH + '?buyer=b-test'), env, new URL(ORIGIN + JOURNEY_PATH + '?buyer=b-test'), auth);
    assert.equal((await g.json()).journey.body, 'edited draft');
  } finally { console.log = orig; }
  assert.ok(logs.every(l => !l.includes('home office') && !l.includes('edited draft')), 'no answers or story text in logs');
  const other = { authenticate: async () => ({ ok: true, professional: { email: 'someone@example.com' } }) };
  const r = await handleJourney(new Request(ORIGIN + JOURNEY_PATH + '?buyer=b-test'), env, new URL(ORIGIN + JOURNEY_PATH + '?buyer=b-test'), other);
  assert.equal(r.status, 403);
  const bad = await handleJourney(new Request(ORIGIN + JOURNEY_PATH, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }), env, new URL(ORIGIN + JOURNEY_PATH), auth);
  assert.equal(bad.status, 403);
});

test('panel has the button and escapes buyer id', () => {
  const h = journeyPanelHtml('x"</script>');
  assert.match(h, /Build buyer's journey/); assert.ok(!h.includes('x"</script>'));
});
