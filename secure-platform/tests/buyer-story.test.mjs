// Your Buyer Story. Synthetic fixtures only: no real buyer names, emails, or answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  STORY_COPY, createStoryEngine, clearStoryStorage, readStorySubmission, addBuyerStoryStep,
  buyerStoryScriptSource, QUESTIONNAIRE_DRAFT_KEY, STORY_TEXT_MAX, CONTACT_FIELDS, missingContactFields, fillUi
} from '../src/buyer-story.js';
import { addGoogleAdsConversionFrame, GOOGLE_ADS_CONVERSION_FRAME_URL } from '../src/google-ads-conversion.js';
import productionWorker from '../src/issue33-production-worker.js';
import portalWorker from '../src/portal-worker.js';
import baseWorker from '../src/worker.js';
import { submissionAlertText, buyerStoryFromPayload } from '../src/submission-alerts.js';

const SRC = readFileSync(new URL('../src/buyer-story.js', import.meta.url), 'utf8');
const E = createStoryEngine(STORY_COPY);
const DATE = 'January 2, 2030';
const withMoney = on => ({ ...STORY_COPY, config: { ...STORY_COPY.config, moneyInSummaryAndAdvocate: on } });

const FULL = {
  first_name: ['Synthetic'], last_name: ['Tester'], email: ['synthetic.tester@example.test'], phone: ['555-0100'],
  has_other_buyer: ['no'],
  why: ['Our lease ends and we want a place that feels calm.'],
  success_definition: ['Less time in the car and more time outside.'],
  priorities: ['Commute', 'Yard / outdoor space', 'Price / monthly cost'],
  non_negotiables: ['A busy road right outside.'],
  lifestyle_pace: ['Work-from-home life — the space has to function for living and working'],
  space_priority: ['More outdoor space, even if the house is smaller'],
  info_preference: ['Walk me through it step by step'],
  uncertainty_style: ['Keep gathering information until the uncertainty is smaller'],
  disagreement_style: ['Put the evidence side by side'],
  past_experience_detail: ['Explain each form before I sign it.'],
  timeline: ['6–12 months'],
  location: ['Synthetic Town or nearby'],
  financing: ['Preapproved'],
  concerns: ['Inspection issues', 'Paying too much', 'Financing / monthly cost', 'I do not know what I do not know'],
  consultation_success: ['A synthetic consult note'],
  notes: ['A synthetic private note']
};
const textOf = story => E.toText(story);
const ids = story => story.sections.map(s => s.id);

test('full answers stitch into Vera’s section order, quoting free text verbatim', () => {
  const story = E.build(FULL, { anonymous: true, date: DATE });
  assert.deepEqual(ids(story), ['story', 'matters', 'needs', 'mind', 'known', 'options', 'decide', 'advocate']);
  const txt = textOf(story);
  assert.match(txt, /You said: "Our lease ends and we want a place that feels calm\."/);
  assert.match(txt, /"Less time in the car and more time outside\."/);
  assert.match(txt, /\[Need\] You said this would rule a home out: "A busy road right outside\."/);
  assert.match(txt, /\n- You'd take a smaller house for more outdoor space\./, 'no tag on space_priority');
  assert.match(txt, /\n- You work from home, so the space has to work for living and working\./, 'no tag on lifestyle_pace');
  assert.equal((txt.match(/\[Need\]/g) || []).length, 1, 'Need tag only on non_negotiables');
  assert.doesNotMatch(txt, /\[Flexible\]/);
  assert.match(txt, /You'd like to move in about 6 to 12 months\./, 'timing stays in What You Know');
  assert.match(txt, /Explain each form before I sign it\./);
  assert.match(txt, /Generated on January 2, 2030\./);
  assert.match(txt, /Created on your device\. Nothing was sent to us\./);
  for (const s of story.sections) {
    assert.ok(s.heading && Array.isArray(s.items) && 'intro_sentence' in s);
    assert.ok(s.items.length <= 5, `${s.id} capped at 5 items`);
  }
  const advocate = story.sections.find(s => s.id === 'advocate');
  assert.ok(advocate.items.length >= 3 && advocate.items.length <= 5);
  assert.equal(advocate.note, STORY_COPY.advocateFact);
});

test('contact details, financing, notes and consult notes never reach the story', () => {
  const txt = textOf(E.build(FULL, { anonymous: true, date: DATE }));
  for (const bad of ['Synthetic Tester', 'Synthetic\n', 'synthetic.tester@example.test', '555-0100', 'Preapproved', 'synthetic private note', 'synthetic consult note']) {
    assert.ok(!txt.includes(bad), `story must not include ${JSON.stringify(bad)}`);
  }
});

test('missing answers drop their sections silently; Your Story uses the fallback line', () => {
  const story = E.build({}, { anonymous: true, date: DATE });
  assert.deepEqual(ids(story), ['story', 'advocate']);
  assert.equal(story.sections[0].intro_sentence, 'This is a snapshot of what you told us matters, in your words.');
  assert.equal(story.sections[0].items.length, 0);
  const html = E.toHtml(story);
  assert.doesNotMatch(html, /<ul><\/ul>|undefined|null/);
  // "Prefer not to answer" and unknown option values are omitted, never guessed
  const s2 = E.build({ lifestyle_pace: ['Prefer not to answer'], priorities: ['Something not in the bank'], timeline: ['Next Tuesday'] }, {});
  assert.deepEqual(ids(s2), ['story', 'advocate']);
});

test('free text is escaped in HTML, kept verbatim in text, and capped with ...', () => {
  const nasty = '<script>alert(1)</script> & "quotes" \'single\'';
  const story = E.build({ why: [nasty] }, { anonymous: true, date: DATE });
  const html = E.toHtml(story);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;/);
  assert.ok(textOf(story).includes(nasty), 'plain text keeps their wording');
  const long = 'word '.repeat(200);
  const it = E.build({ why: [long] }, {}).sections[0].items[0];
  assert.equal(it.truncated, true);
  assert.ok(it.quote.endsWith('...') && it.quote.length <= STORY_COPY.limits.freeTextChars + 3);
  assert.match(E.toHtml(E.build({ why: [long] }, {})), /see your full answers/);
});

test('story sections stay money-free except the two approved worries in What’s on Your Mind', () => {
  const money = /monthly cost|paying|financ|lender|credit|income|down payment|assistance|\bfees?\b|price|\$|budget|investment|resale|worth|school|family/i;
  for (const on of [false, true]) {
    const eng = createStoryEngine(withMoney(on));
    const story = eng.build({ ...FULL, priorities: ['Price / monthly cost', 'Schools', 'Space for family', 'Investment potential', 'Future resale'], budget_comfort: ['Synthetic comfortable range'] }, { anonymous: true, date: DATE });
    for (const s of story.sections.filter(s => !['glance', 'advocate', 'mind'].includes(s.id))) {
      assert.doesNotMatch(eng.toText({ ...story, sections: [s], closing: '', footer: '', anonymousLine: '', contact: '' }), money, `${s.id} must stay money-free (switch ${on})`);
    }
    const mind = story.sections.find(s => s.id === 'mind').items.map(i => i.text);
    assert.ok(mind.includes('Paying more than a home is worth'));
    assert.ok(mind.includes('Financing and the monthly cost'));
    for (const m of mind.filter(t => money.test(t))) assert.ok(['Paying more than a home is worth', 'Financing and the monthly cost'].includes(m), m);
    const glance = story.sections.find(s => s.id === 'glance');
    assert.doesNotMatch(glance ? JSON.stringify(glance) : '', /school|family|preapproved|financ/i);
  }
});

test('money worries never change the advocate steps unless the money switch is on', () => {
  const base = { ...FULL, concerns: ['Inspection issues'] };
  const withMoneyWorries = { ...FULL, concerns: ['Inspection issues', 'Paying too much', 'Financing / monthly cost'] };
  const steps = (eng, a) => eng.build(a, {}).sections.find(s => s.id === 'advocate').items.map(i => i.rule);
  assert.deepEqual(steps(E, withMoneyWorries), steps(E, base));
  assert.ok(!steps(E, withMoneyWorries).includes('lender'));
  assert.ok(steps(createStoryEngine(withMoney(true)), withMoneyWorries).includes('lender'));
});

test('money switch (default OFF) gates budget comfort in the summary and the generic lender step', () => {
  assert.equal(STORY_COPY.config.moneyInSummaryAndAdvocate, false);
  const answers = { ...FULL, budget_comfort: ['Synthetic comfortable range'] };
  const offStory = E.build(answers, {});
  assert.ok(!ids(offStory).includes('glance'), 'glance renders only with the money switch on');
  const off = textOf(offStory);
  assert.doesNotMatch(off, /lender|Monthly cost|Synthetic comfortable range/);
  const onE = createStoryEngine(withMoney(true));
  const on = onE.toText(onE.build(answers, {}));
  assert.match(on, /Priorities you picked: Commute, Yard \/ outdoor space, Monthly cost/);
  assert.match(on, /Budget you said feels comfortable: "Synthetic comfortable range"/);
  assert.match(on, /talk with a lender early/);
  // budget comfort renders only when the buyer gave one
  const none = onE.toText(onE.build(FULL, {}));
  assert.doesNotMatch(none, /Budget you said feels comfortable/);
});

test('advocate steps come from the fixed rule table, in order, max 5, with a not-yet path', () => {
  const steps = E.build(FULL, {}).sections.find(s => s.id === 'advocate').items.map(s => s.rule);
  assert.deepEqual(steps, ['listen', 'checklist', 'condition', 'pace', 'pros'], 'pros always kept; others capped at 4');
  const minimal = E.build({}, {}).sections.find(s => s.id === 'advocate').items.map(s => s.rule);
  assert.deepEqual(minimal, ['listen', 'pros']);
});

test('advocate overflow: with every rule firing, pros is always last and the rest cap at 4 in table order', () => {
  const eng = createStoryEngine(withMoney(true));
  const all = { ...FULL, concerns: ['Inspection issues', 'Negotiating effectively', 'Timing / market conditions'], timeline: ['Just exploring / unsure'] };
  const steps = eng.build(all, {}).sections.find(s => s.id === 'advocate').items.map(s => s.rule);
  assert.deepEqual(steps, ['listen', 'checklist', 'condition', 'lender', 'pros']);
  assert.equal(steps.length, 5);
  for (let i = 0; i < 3; i++) assert.deepEqual(eng.build(all, {}).sections.find(s => s.id === 'advocate').items.map(s => s.rule), steps, 'deterministic');
});

test('options section appears only when answers support it', () => {
  assert.ok(!ids(E.build({ timeline: ['1–3 months'] }, {})).includes('options'));
  const txt = textOf(E.build({ timeline: ['Just exploring / unsure'] }, {}));
  assert.match(txt, /Taking more time is a real option/);
  assert.match(txt, /Renting a while longer/);
  assert.doesNotMatch(textOf(E.build({ concerns: ['Timing / market conditions'] }, {})), /Renting/);
});

test('co-buyer answers are never merged: the story notes it reflects only this buyer', () => {
  assert.match(textOf(E.build({ has_other_buyer: ['yes'] }, {})), /shows only your answers/);
});

test('the anonymous line appears only on the on-device version', () => {
  assert.doesNotMatch(textOf(E.build(FULL, { anonymous: false, date: DATE })), /Nothing was sent to us/);
  assert.doesNotMatch(E.toHtml(E.build(FULL, { anonymous: false })), /story-anon-line/);
});

test('copy follows Vera’s tone rules: no banned words, exclamation marks, or emoji', () => {
  const answers = { ...FULL, concerns: Object.keys(STORY_COPY.phrases.concerns), priorities: Object.keys(STORY_COPY.phrases.priorities) };
  const out = textOf(createStoryEngine(withMoney(true)).build(answers, { anonymous: true, date: DATE })) + JSON.stringify(STORY_COPY.ui);
  assert.doesNotMatch(out.replace(/Our lease[^"]*|A busy road[^"]*/g, ''), /property|price point|\bleads?\b|!|\p{Extended_Pictographic}|score|readiness|best in|#1|guarantee|act now|limited time|free\b|claim\b|submit\b|get started/iu);
});

test('every multiple-choice option on the live questionnaire is in the versioned phrase bank', async () => {
  const res = await productionWorker.fetch(new Request('https://buyer.hbexperts.com/questionnaire'), {}, { waitUntil() {} });
  const html = await res.text();
  for (const field of ['priorities', 'lifestyle_pace', 'space_priority', 'info_preference', 'uncertainty_style', 'disagreement_style', 'concerns']) {
    const values = [...html.matchAll(new RegExp(`name="${field}" value="([^"]*)"`, 'g'))].map(m => m[1]);
    assert.ok(values.length, `${field} options found`);
    for (const v of values) assert.ok(Object.hasOwn(STORY_COPY.phrases[field], v), `${field}: "${v}" missing from phrase bank`);
  }
  const tl = html.match(/<select name="timeline">([\s\S]*?)<\/select>/)[1];
  for (const v of [...tl.matchAll(/<option>([^<]*)<\/option>/g)].map(m => m[1])) assert.ok(Object.hasOwn(STORY_COPY.phrases.timeline, v), `timeline "${v}"`);
  assert.ok(STORY_COPY.phraseBankVersion && STORY_COPY.version);
});

// ---- Path 1: no network, no storage, no tags ----------------------------------------------

const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\bimport\s*\(|navigator\.|\.src\s*=|new\s+Image\b|setItem|postMessage|gtag|dataLayer|googletagmanager|google-analytics|GTM-|AW-\d/;

test('path 1 static check: the story module and its page script make no network or storage writes', () => {
  assert.doesNotMatch(SRC, NETWORK);
  const script = buyerStoryScriptSource();
  assert.doesNotMatch(script, NETWORK);
  new vm.Script(script); // embedded engine + UI compile
  assert.match(script, /window\.print\(\)/);
  assert.match(script, /clearStoryStorage\(\[window\.sessionStorage,window\.localStorage\],DRAFT_KEY\)/);
});

test('path 1 route check: the questionnaire adds the story step but no new endpoint exists', async () => {
  const res = await productionWorker.fetch(new Request('https://buyer.hbexperts.com/questionnaire'), {}, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const html = await res.text();
  assert.equal(html.split('id="buyer-story-step"').length - 1, 1);
  assert.ok(html.indexOf('id="buyer-story-step"') < html.indexOf('<div class="submitbox">'));
  assert.ok(html.indexOf('id="buyer-story-step"') > html.indexOf('id="buyerExperienceForm"'));
  // The story module defines no routes; the only POST target in the page is the existing intake.
  assert.doesNotMatch(SRC, /pathname|new Request|Response\(/);
  const actions = [...html.matchAll(/action="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(actions)], ['/api/intake']);
  for (const p of ['/api/buyer-story', '/api/story', '/story']) {
    let touched = false;
    const db = { prepare() { touched = true; throw new Error('no db'); }, batch() { touched = true; throw new Error('no db'); } };
    const r = await productionWorker.fetch(new Request(`https://buyer.hbexperts.com${p}`, { method: 'POST', body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), { BUYER_DB: db }, { waitUntil() {} });
    assert.ok(r.status >= 300, `${p} must not be a story endpoint (got ${r.status})`);
  }
});

test('no Google tags on the questionnaire, the story step, or the portal page source', async () => {
  const TAGS = /googletagmanager|gtag\(|GTM-[A-Z0-9]+|AW-\d+|google-analytics|googleadservices|dataLayer/;
  const html = await (await productionWorker.fetch(new Request('https://buyer.hbexperts.com/questionnaire'), {}, { waitUntil() {} })).text();
  assert.doesNotMatch(html, TAGS);
  assert.doesNotMatch(SRC, TAGS);
  assert.doesNotMatch(readFileSync(new URL('../src/portal-worker.js', import.meta.url), 'utf8'), TAGS);
  const portal = await productionWorker.fetch(new Request('https://buyer.hbexperts.com/portal'), { BUYER_DB: { prepare() { const s = { bind() { return s; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return {}; } }; return s; } } }, { waitUntil() {} });
  assert.doesNotMatch(await portal.text(), TAGS);
});

test('clearStoryStorage removes the questionnaire draft and any story keys, nothing else', () => {
  const mk = init => { const m = new Map(Object.entries(init)); return { get length() { return m.size; }, key: i => [...m.keys()][i], removeItem: k => m.delete(k), m }; };
  const session = mk({ [QUESTIONNAIRE_DRAFT_KEY]: '{"why":["synthetic"]}', 'hbe:buyer-story:tmp': 'x', other: 'keep' });
  const local = mk({ 'hbe:buyer-story:x': 'y', theme: 'keep' });
  assert.equal(clearStoryStorage([session, local, null], QUESTIONNAIRE_DRAFT_KEY), 3);
  assert.deepEqual([...session.m.keys()], ['other']);
  assert.deepEqual([...local.m.keys()], ['theme']);
  assert.equal(clearStoryStorage([{ get length() { throw new Error('blocked'); } }], QUESTIONNAIRE_DRAFT_KEY), 0);
});

test('print/PDF smoke: print stylesheet isolates a light, page-friendly story', () => {
  const page = addBuyerStoryStep('<html><head></head><body><form id="buyerExperienceForm"><div class="submitbox">x</div></form></body></html>');
  assert.match(page, /@media print\{/);
  assert.match(page, /@page\{margin:16mm\}/);
  assert.match(page, /html\.hbe-story-printing body>\*:not\(#buyer-story-print\)\{display:none!important\}/);
  assert.match(page, /break-inside:avoid-page/);
  assert.match(page, /@media \(max-width:640px\)\{\.story-choices\{grid-template-columns:1fr\}\}/);
  assert.doesNotMatch(page.match(/<style id="buyer-story-css">[\s\S]*?<\/style>/)[0], /background:#(000|111|1a1a2e)\b/);
  assert.equal(addBuyerStoryStep(page), page, 'idempotent');
  assert.equal(addBuyerStoryStep('<html><body>no form</body></html>'), '<html><body>no form</body></html>');
});

test('the two choices have equal weight; sharing starts disabled behind an OFF consent switch', () => {
  const page = addBuyerStoryStep('<html><head></head><body><form id="buyerExperienceForm"><div class="submitbox">x</div></form></body></html>');
  assert.match(page, /<button class="story-choice" id="buyer-story-download" type="button">/);
  assert.match(page, /<button class="story-choice" id="buyer-story-share" type="button" disabled aria-disabled="true"/);
  const consent = page.match(/<input type="checkbox" id="buyer-story-consent"[^>]*>/)[0];
  assert.doesNotMatch(consent, /(?<![-\w])checked|\sname=/);
  assert.equal(STORY_COPY.names, 'Jen and Chris');
  assert.match(page, /Yes, save my Buyer Journey and share it, along with my story, with Jen and Chris at HomeBuyer Experts so they can follow up with me\. No mailing lists, no texts\. I can ask to have it deleted anytime\. <a href="https:\/\/hbexperts\.com\/privacy\/"/);
  assert.match(page, /<strong>Share my story with HBE and keep my journey<\/strong><small>Jen and Chris will read it personally/);
  assert.doesNotMatch(page.match(/<section class="buyer-story-step"[\s\S]*?<\/section>/)[0] + JSON.stringify(fillUi(STORY_COPY)), /Sebastian|\{names\}|\{max\}/);
  assert.doesNotMatch(SRC + buyerStoryScriptSource(), /Sebastian/);
  assert.equal(fillUi(STORY_COPY).afterDownload, 'Your story is ready to save as a PDF or print. We\u2019ve cleared your draft answers from this browser.');
  assert.doesNotMatch(page.match(/<section class="buyer-story-step"[\s\S]*?<\/section>/)[0] + JSON.stringify(STORY_COPY.ui), /\btexting\b|\bSMS\b|text message|we.ll text|text you/i);
});

// ---- Path 2: consent gating and the existing lead flow --------------------------------------

function fakeDb({ failSend = false } = {}) {
  const log = [];
  const notes = new Map();
  const buyers = [];
  const deliveries = new Map();
  const stmt = (sql, args = []) => ({
    sql, args,
    bind(...a) { return stmt(sql, a); },
    async run() { apply(sql, args); log.push({ op: 'run', sql }); return { meta: { changes: 1 } }; },
    async first() {
      log.push({ op: 'first', sql });
      if (/FROM notifications n JOIN buyers b/.test(sql)) {
        const n = notes.get(args[0]); const b = buyers.find(x => x.id === n?.buyer_id);
        return n && b ? { id: n.id, created_at: n.created_at, payload_json: n.payload_json, first_name: b.first_name, last_name: b.last_name, email: b.email, phone: b.phone } : null;
      }
      if (/SELECT id FROM buyers WHERE email=/.test(sql)) return buyers.find(b => b.email === args[0]) || null;
      return null;
    },
    async all() { return { results: [] }; }
  });
  function apply(sql, a) {
    if (/^INSERT INTO buyers/.test(sql)) buyers.push({ id: a[0], first_name: a[4], last_name: a[5], email: a[6], phone: a[7] });
    if (/^INSERT INTO notifications /.test(sql)) notes.set(a[0], { id: a[0], buyer_id: a[1], type: a[2], created_at: a[3], payload_json: a[4] });
    if (/^INSERT INTO notification_deliveries/.test(sql)) deliveries.set(a[0], { status: 'pending' });
    if (/^UPDATE notification_deliveries\s+SET status='sent'/.test(sql)) deliveries.get(a[2]).status = 'sent';
    if (/^UPDATE notification_deliveries\s+SET status='failed'/.test(sql)) { const k = a[a.length - 1]; if (deliveries.has(k)) deliveries.get(k).status = 'failed'; }
  }
  const db = {
    prepare: sql => stmt(sql.trim()),
    async batch(list) { for (const s of list) { apply(s.sql, s.args); log.push({ op: 'batch', sql: s.sql }); } return []; }
  };
  const sent = [];
  const mail = { async send(m) { log.push({ op: 'email' }); if (failSend) throw Object.assign(new Error('synthetic send failure'), { code: 'SYNTH' }); sent.push(m); return { messageId: 'synthetic-id' }; } };
  return { db, mail, log, notes, buyers, deliveries, sent };
}

function intakeForm(extra = {}) {
  const f = new FormData();
  const base = { first_name: 'Synthetic', last_name: 'Buyer', email: 'synthetic.buyer@example.test', has_other_buyer: 'no', why: 'A synthetic reason.', ...extra };
  for (const [k, v] of Object.entries(base)) f.append(k, v);
  return f;
}
const STORY_TEXT = 'Your Buyer Story\n\nYOUR STORY\n- You said: "A synthetic reason."';

test('readStorySubmission: consent is required and story text is capped', () => {
  assert.deepEqual(readStorySubmission(intakeForm()), { present: false });
  assert.equal(readStorySubmission(intakeForm({ story_source: 'buyer_story', story_text: 'x' })).ok, false);
  assert.equal(readStorySubmission(intakeForm({ story_source: 'buyer_story', story_consent: 'on', story_text: 'x' })).ok, false);
  assert.equal(readStorySubmission(intakeForm({ story_source: 'other', story_consent: 'yes', story_text: 'x' })).ok, false);
  assert.equal(readStorySubmission(intakeForm({ story_source: 'buyer_story', story_consent: 'yes', story_text: '  ' })).ok, false);
  const big = readStorySubmission(intakeForm({ story_source: 'buyer_story', story_consent: 'yes', story_text: 'y'.repeat(STORY_TEXT_MAX + 50) }));
  assert.equal(big.ok, true);
  assert.equal(big.text.length, STORY_TEXT_MAX);
});

test('a story without consent never rejects the lead: it is saved as an ordinary submission, story dropped', async () => {
  for (const extra of [{ story_source: 'buyer_story', story_text: STORY_TEXT }, { story_source: 'buyer_story', story_consent: 'yes', story_text: '   ' }]) {
    const f = fakeDb();
    const waits = [];
    const res = await portalWorker.fetch(new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', body: intakeForm(extra) }), { BUYER_DB: f.db, HBE_ALERT: f.mail }, { waitUntil(p) { waits.push(p); } });
    await Promise.allSettled(waits);
    assert.equal(res.status, 200);
    const [note] = [...f.notes.values()];
    assert.equal(note.type, 'buyer_experience_submitted');
    const payload = JSON.parse(note.payload_json);
    assert.equal(payload.story_text, undefined);
    assert.equal(payload.source, undefined);
    assert.equal(f.sent.length, 1);
    assert.doesNotMatch(f.sent[0].text, /BUYER STORY|YOUR STORY/);
    assert.match(f.sent[0].text, /Questionnaire answers are intentionally not copied/);
  }
});

async function submitWithStory(opts) {
  const f = fakeDb(opts);
  const waits = [];
  const res = await portalWorker.fetch(new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', body: intakeForm({ story_source: 'buyer_story', story_consent: 'yes', story_text: STORY_TEXT }) }), { BUYER_DB: f.db, HBE_ALERT: f.mail }, { waitUntil(p) { waits.push(p); } });
  await Promise.allSettled(waits);
  return { res, ...f };
}

test('path 2 reuses the existing lead flow: buyer_experience_submitted + delivery row in D1 first, then email', async () => {
  const { res, log, notes, deliveries, sent } = await submitWithStory();
  assert.equal(res.status, 200);
  const firstEmail = log.findIndex(e => e.op === 'email');
  const noteWrite = log.findIndex(e => /^INSERT INTO notifications /.test(e.sql || ''));
  const deliveryWrite = log.findIndex(e => /^INSERT INTO notification_deliveries/.test(e.sql || ''));
  assert.ok(noteWrite >= 0 && deliveryWrite >= 0 && firstEmail > deliveryWrite, 'D1 write before email');
  const [note] = [...notes.values()];
  assert.equal(note.type, 'buyer_experience_submitted');
  const payload = JSON.parse(note.payload_json);
  assert.equal(payload.source, 'buyer_story');
  assert.equal(payload.story_consent, true);
  assert.equal(payload.story_text, STORY_TEXT);
  assert.equal([...deliveries.values()][0].status, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['buyers@hbexperts.com'], 'existing recipients only (no new addresses)');
  assert.equal(sent[0].subject, 'New HBE Buyer Experience submitted');
  const body = sent[0].text;
  assert.ok(body.indexOf('Buyer: Synthetic Buyer') < body.indexOf('THEIR BUYER STORY'), 'lead summary first');
  assert.ok(body.includes(STORY_TEXT), 'story readable in the email body');
  assert.match(body, /Source: Buyer Story/);
  // source flag also lands on the saved journey answers
  const answersWrite = log.find(e => /^UPDATE buyers SET answers_json/.test(e.sql || ''));
  assert.ok(answersWrite);
});

test('path 2: an email failure still leaves the lead, and the delivery row records the failure', async () => {
  const { res, notes, buyers, deliveries, sent } = await submitWithStory({ failSend: true });
  assert.equal(res.status, 200);
  assert.equal(buyers.length, 1);
  assert.equal([...notes.values()][0].type, 'buyer_experience_submitted');
  assert.equal([...deliveries.values()][0].status, 'failed');
  assert.equal(sent.length, 0);
});

test('ordinary submissions are unchanged: no story, answers stay out of email', () => {
  const row = { first_name: 'Synthetic', last_name: 'Buyer', email: 's@example.test', phone: '', created_at: '2030-01-02T00:00:00Z', payload_json: JSON.stringify({ first_name: 'Synthetic', last_name: 'Buyer', email: 's@example.test' }) };
  const text = submissionAlertText(row);
  assert.match(text, /Questionnaire answers are intentionally not copied into this email\./);
  assert.doesNotMatch(text, /BUYER STORY/);
  assert.equal(buyerStoryFromPayload('{"source":"buyer_story","story_text":"x"}'), '', 'consent flag required');
  assert.equal(buyerStoryFromPayload('not json'), '');
});

// ---- Download without contact details; share needs them ----------------------------------

test('download needs no contact details; share/submit is gated on them', async () => {
  assert.deepEqual(CONTACT_FIELDS, ['first_name', 'last_name', 'email', 'has_other_buyer']);
  const empty = new FormData();
  assert.deepEqual(missingContactFields(n => empty.get(n), CONTACT_FIELDS), CONTACT_FIELDS);
  const filled = intakeForm();
  assert.deepEqual(missingContactFields(n => filled.get(n), CONTACT_FIELDS), []);
  // Download works from empty contact fields: the story ignores them and the handler never gates.
  const story = E.build({ why: ['A synthetic reason.'] }, { anonymous: true, date: DATE });
  assert.match(textOf(story), /A synthetic reason/);
  const script = buyerStoryScriptSource();
  const dlHandler = script.slice(script.indexOf("dl.addEventListener('click'"), script.indexOf("const reviewBtn="));
  assert.doesNotMatch(dlHandler, /gateShare|missingContact|restoreContact/);
  const shareHandler = script.slice(script.indexOf("share.addEventListener('click'"), script.indexOf("// Runs before the review dialog"));
  assert.match(shareHandler, /if\(!gateShare\(\)\)return;[\s\S]*reviewBtn\.click\(\)/, 'share checks contact before opening review');
  assert.match(script, /reviewBtn\.addEventListener\('click',e=>\{[^\n]*if\(!gateShare\(\)\)\{e\.stopImmediatePropagation\(\)/, 'Review & Send is gated too');
  assert.match(script, /function relaxContact\(\)\{contactEls\(\)/);
  // The live page offers a "continue without contact details" link on Part 1 only.
  const html = await (await productionWorker.fetch(new Request('https://buyer.hbexperts.com/questionnaire'), {}, { waitUntil() {} })).text();
  const part1 = html.slice(0, html.indexOf('data-title="What matters at home"'));
  assert.match(part1, /id="buyer-story-skip-contact"/);
  assert.equal(html.split('id="buyer-story-skip-contact"').length - 1, 1);
  // Server side still refuses a lead without contact details (unchanged validation).
  const f = fakeDb();
  const res = await portalWorker.fetch(new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', body: (() => { const x = new FormData(); x.set('story_source', 'buyer_story'); x.set('story_consent', 'yes'); x.set('story_text', STORY_TEXT); return x; })() }), { BUYER_DB: f.db, HBE_ALERT: f.mail }, { waitUntil() {} });
  assert.equal(res.status, 400);
  assert.equal(f.notes.size, 0);
});

test('preview counter matches the 12,000-character server cap and blocks sharing above it', () => {
  assert.equal(STORY_COPY.limits.shareChars, STORY_TEXT_MAX);
  const script = buyerStoryScriptSource();
  assert.match(script, /const MAX=COPY\.limits\.shareChars;/);
  assert.match(script, /doc\.addEventListener\('input',sync\)/);
  assert.match(script, /if\(text\.length>MAX\)\{e\.stopImmediatePropagation\(\)/);
  assert.match(fillUi(STORY_COPY).overLimit, /12,000 characters/);
  assert.match(addBuyerStoryStep('<html><head></head><body><form id="buyerExperienceForm"><div class="submitbox">x</div></form></body></html>'), /id="buyer-story-count"/);
});

test('#108 conversion on the shared path carries only the click id, and story text is never logged', async () => {
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  let ok, failed;
  try {
    ok = await submitWithStory();
    failed = await submitWithStory({ failSend: true });
  } finally { Object.assign(console, orig); }
  const page = await ok.res.text();
  assert.ok(!page.includes('A synthetic reason') && !page.includes('THEIR BUYER STORY'), 'post-submit page has no story');
  const framed = addGoogleAdsConversionFrame(page, { key: 'gclid', value: 'TeSt_GcLiD-0123456789abcXYZ' });
  const added = framed.slice(framed.indexOf('<iframe id="hbe-google-ads-conversion-frame"'));
  const src = added.match(/frame\.src='([^']*)'/)[1];
  assert.equal(src, `${GOOGLE_ADS_CONVERSION_FRAME_URL}?gclid=TeSt_GcLiD-0123456789abcXYZ`);
  assert.match(added, /postMessage\('hbe:buyer-experience-submitted'/);
  assert.doesNotMatch(added, /synthetic|story|Synthetic Buyer|example\.test/i);
  for (const line of logs) assert.ok(!line.includes('A synthetic reason') && !line.includes('YOUR STORY'), `log leaked story: ${line}`);
  assert.equal(failed.res.status, 200);
  assert.doesNotMatch(SRC, /console\./, 'story module never logs');
});
