import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { STAGES, STAGE_CHECKLISTS, STAGE_COUNT, assertSeventeenStages, stageLabel, COMPENSATION_PUBLIC } from '../src/journey-stages.js';
import { deriveWhatsNext, filterStory, defaultCompass, canSeeItem, sha256Hex, randomToken, dueDateFromOffset, authorizePreview } from '../src/household-state.js';
import { stageMapHtml, splitHouseholdCard, storyPanel, compassPanel, whatsNextPanel, checklistPanel, modeSwitcher, thankYouHtml, compensationPublicHtml, dashboardShell, previewBanner, ISSUE29_CSS } from '../src/issue29-ui.js';

const RIVERA = {
  members: [
    { id: 'alex-rivera', first_name: 'Alex', last_name: 'Rivera', email: 'alex.rivera@example.test', stage: 'possibilities' },
    { id: 'sam-rivera', first_name: 'Sam', last_name: 'Rivera', email: 'sam.rivera@example.test', stage: 'possibilities' }
  ],
  story: {
    shared_story: 'We are trying to make daily life quieter without giving up a workable commute or the chance to have people over. We would rather get the street and the condition right than win on square footage.',
    hbe_synthesis: 'Rivera household: two decision-makers. Alex wants major risks named. Sam wants time to feel a street. Do not collapse that difference into a fake consensus. Current stage: Discover Possibilities.',
    wants: 'Calmer daily home base, practical commute, room to host family.',
    needs: 'Condition and neighborhood feel over maximum size.',
    tradeoffs: 'Willing to trade some square footage for location and a settled street.',
    risks: 'HBE-only: watch jumping to offer-readiness before the search has taught them what they value.',
    decision_style: 'HBE-only: Alex evidence-first; Sam talk-it-through.',
    unresolved_questions: 'Which streets still feel right on a weeknight after dark?',
    evidence: 'Consultation complete. Representation chosen. Criteria drafted.',
    what_changed: 'Size dropped in priority after they named the daily-life problem.'
  },
  private: {
    alex: 'I want the real risks named rather than being surprised later.',
    sam: 'I need time to feel a street, not just score it.'
  }
};

test('exactly 17 stages, live 16 preserved, no 18-21', () => {
  assert.equal(STAGES.length, STAGE_COUNT);
  assert.equal(assertSeventeenStages(), true);
  assert.equal(STAGES[0][0], 'buyerExperience');
  assert.equal(STAGES[15][1], 'Get the Keys');
  assert.equal(STAGES[16][0], 'afterKeys');
  assert.equal(STAGES[16][1], 'After the Keys');
  assert.ok(STAGE_CHECKLISTS.afterKeys.some(i => /30-day/i.test(i.title)));
  assert.ok(STAGE_CHECKLISTS.afterKeys.some(i => /90-day/i.test(i.title)));
  assert.ok(STAGE_CHECKLISTS.afterKeys.some(i => /one-year/i.test(i.title)));
  assert.ok(STAGE_CHECKLISTS.afterKeys.some(i => /anniversary/i.test(i.title)));
  assert.ok(STAGE_CHECKLISTS.afterKeys.some(i => /warranty/i.test(i.title)));
  for (const banned of ['care30','care90','care365','anniversary']) {
    assert.equal(STAGES.some(s => s[0] === banned), false);
  }
});

test('stage map HTML contains all 17 and peek + open checklist', () => {
  const html = stageMapHtml({ currentStage: 'possibilities', completed: ['buyerExperience','consultation','representation','search','market'], actor: { kind: 'buyer' } });
  assert.equal((html.match(/class="i29-stop /g) || []).length, 17);
  assert.match(html, /After the Keys/);
  assert.match(html, /Get the Keys/);
  assert.match(html, /i29-peek/);
  assert.match(html, /Open full checklist/);
  assert.doesNotMatch(html, /30-day care/);
  assert.doesNotMatch(html, /No tasks yet/);
});

test('buyer cannot see HBE-only checklist items', () => {
  const hbeOnly = STAGE_CHECKLISTS.representation.find(i => i.visibility === 'hbe');
  assert.ok(hbeOnly);
  assert.equal(canSeeItem(hbeOnly, { kind: 'buyer' }), false);
  assert.equal(canSeeItem(hbeOnly, { kind: 'hbe' }), true);
});

test('shared story never dumps questionnaire or HBE synthesis', () => {
  const shared = filterStory(RIVERA.story, { kind: 'buyer', id: 'alex-rivera', private_context: RIVERA.private.alex }, 'shared');
  assert.equal(shared.hbe_synthesis, '');
  assert.equal(shared.private_context, '');
  assert.equal(shared.risks, '');
  assert.equal(shared.decision_style, '');
  assert.match(shared.shared_story, /quieter/);
  const mine = filterStory(RIVERA.story, { kind: 'buyer', id: 'alex-rivera', private_context: RIVERA.private.alex }, 'mine');
  assert.match(mine.private_context, /risks named/);
  assert.equal(mine.hbe_synthesis, '');
  const hbe = filterStory(RIVERA.story, { kind: 'hbe' }, 'hbe');
  assert.match(hbe.hbe_synthesis, /two decision-makers/);
  assert.match(hbe.risks, /offer-readiness/);
});

test('What’s Next is never empty and never says No tasks yet', () => {
  const empty = deriveWhatsNext({ stage: 'possibilities', checklistItems: [], completions: [], tasks: [], actor: { kind: 'buyer' } });
  assert.ok(empty.title.length > 8);
  assert.doesNotMatch(empty.title, /No tasks yet/i);
  const fromChecklist = deriveWhatsNext({
    stage: 'possibilities',
    checklistItems: [{ id: '1', stage_id: 'possibilities', item_key: 'review_fits', title: 'Review today’s best-fit possibilities', visibility: 'shared' }],
    completions: [],
    tasks: [],
    actor: { kind: 'buyer' }
  });
  assert.match(fromChecklist.title, /best-fit/);
  const labeled = deriveWhatsNext({
    stage: 'possibilities',
    checklistItems: [],
    completions: [],
    tasks: [{ id: 't1', title: 'Confirm three tour candidates', status: 'open', visibility: 'shared', is_whats_next: 1, priority: 'high' }],
    actor: { kind: 'buyer' }
  });
  assert.equal(labeled.title, 'Confirm three tour candidates');
});

test('compass default is never empty', () => {
  const c = defaultCompass('possibilities');
  assert.ok(c.optimizing_for && c.tradeoffs && c.uncertainty && c.evidence && c.next_conversation);
});

test('invite tokens are hashed, not stored in the clear, and not seed-replayable', async () => {
  const a = randomToken(32);
  const b = randomToken(32);
  assert.notEqual(a, b);
  assert.notEqual(a, 'forge-rivera-sam-invite');
  const hash = await sha256Hex(a);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, a);
});

test('authorizePreview fail-closed without Access email', () => {
  const missing = authorizePreview({ headers: { get: () => null } }, {});
  assert.equal(missing.ok, false);
  const mismatch = authorizePreview({ headers: { get: (k) => k === 'Cf-Access-Authenticated-User-Email' ? 'a@hbexperts.com' : (k === 'X-HBE-Verified-Professional-Email' ? 'b@hbexperts.com' : '') } }, {});
  assert.equal(mismatch.ok, false);
  const ok = authorizePreview({ headers: { get: (k) => k.includes('Email') ? 'cwhitehead@hbexperts.com' : 'hbe-pro-1' } }, {});
  assert.equal(ok.ok, true);
});

test('public compensation has no percentages, dollars, packages, or seller-paid automatic', () => {
  const copy = compensationPublicHtml() + ' ' + COMPENSATION_PUBLIC.body;
  assert.doesNotMatch(copy, /2\.75/);
  assert.doesNotMatch(copy, /\d%/);
  assert.doesNotMatch(copy, /\$\d/);
  assert.doesNotMatch(copy, /our fee is/i);
  assert.match(copy, /does not publish percentages/);
  assert.match(copy, /negotiable/i);
  assert.match(copy, /not automatic/i);
  assert.match(COMPENSATION_PUBLIC.body, /not automatic/);
});

test('thank-you has privacy and next steps, no hire pressure', () => {
  const html = thankYouHtml({ first: 'Alex', accessCode: 'AAAA-BBBB-CCCC-DDDD', remembered: true });
  assert.match(html, /does not hire/i);
  assert.match(html, /Privacy/i);
  assert.match(html, /Strategy Session/i);
  assert.match(html, /no-obligation/i);
  assert.doesNotMatch(html, /sign today/i);
});

test('split household card has two click targets', () => {
  const html = splitHouseholdCard({
    householdName: 'Rivera',
    members: RIVERA.members,
    stage: 'possibilities',
    selected: true,
    hbeHref: '/hbe?buyer=alex-rivera',
    buyerHref: '/hbe/preview?buyer=alex-rivera'
  });
  assert.match(html, /HBE Dashboard/);
  assert.match(html, /Buyer Dashboard/);
  assert.match(html, /Alex Rivera &amp; Sam Rivera/);
});

test('mode greeting makes My View vs Shared obvious', () => {
  const mine = modeSwitcher({ mode: 'mine', firstName: 'Alex', others: [RIVERA.members[1]], mineHref: '/portal?view=mine', sharedHref: '/portal?view=shared' });
  assert.match(mine, /My View as Alex/);
  assert.match(mine, /not a shared credential/);
  const shared = modeSwitcher({ mode: 'shared', firstName: 'Alex', others: [RIVERA.members[1]], mineHref: '/portal?view=mine', sharedHref: '/portal?view=shared' });
  assert.match(shared, /Shared Household View/);
  assert.match(shared, /Sam/);
});

test('completing an item can create a dated action', () => {
  const due = dueDateFromOffset(new Date('2026-08-31T12:00:00Z'), 7);
  assert.equal(due, '2026-09-07');
  const item = STAGE_CHECKLISTS.possibilities.find(i => i.creates);
  assert.ok(item.creates.title.length > 5);
});

test('write desktop + mobile HTML evidence from synthetic Rivera fixtures', () => {
  mkdirSync('/workspace/hbexperts-site/docs/issue29', { recursive: true });
  const items = [];
  let n = 0;
  for (const [id] of STAGES) {
    for (const spec of STAGE_CHECKLISTS[id]) {
      n += 1;
      items.push({ id: spec.key, stage_id: id, item_key: spec.key, title: spec.title, visibility: spec.visibility, creates_action_title: spec.creates?.title || null });
    }
  }
  const actorHbe = { kind: 'hbe', id: 'cwhitehead@hbexperts.com' };
  const actorAlex = { kind: 'buyer', id: 'alex-rivera', private_context: RIVERA.private.alex };
  const tasks = [{ id: 't1', title: 'Each buyer reacts privately, then compare only shared facts', status: 'open', visibility: 'shared', is_whats_next: 1, priority: 'high', due_at: '2026-09-03', source: 'checklist' }];
  const hbeBody = [
    splitHouseholdCard({ householdName: 'Rivera', members: RIVERA.members, stage: 'possibilities', selected: true, hbeHref: '/hbe?buyer=alex-rivera', buyerHref: '/hbe/preview?buyer=alex-rivera' }),
    stageMapHtml({ currentStage: 'possibilities', completed: ['buyerExperience','consultation','representation','search','market'], actor: actorHbe }),
    whatsNextPanel({ stage: 'possibilities', checklistItems: items, completions: [], tasks, actor: actorHbe }),
    storyPanel(RIVERA.story, { mode: 'hbe', actor: actorHbe }),
    compassPanel({
      optimizing_for: 'A calmer daily home base with a practical commute and enough room to host family.',
      tradeoffs: 'Square footage vs location, condition, and a neighborhood that feels settled.',
      uncertainty: 'Which streets still feel right on a weeknight after dark.',
      evidence: 'Consultation complete. Representation chosen. Criteria drafted around commute, quiet, gathering space, and condition.',
      next_conversation: 'Look at three homes that test the space-versus-location tradeoff.'
    }),
    checklistPanel({ stageId: 'possibilities', items, completions: [], actor: actorHbe, action: '/api/hbe/checklist/toggle' }),
    checklistPanel({ stageId: 'afterKeys', items, completions: [], actor: actorHbe, action: '/api/hbe/checklist/toggle' })
  ].join('\n');
  const hbe = dashboardShell({ title: 'HBE Dashboard · Rivera (synthetic)', body: hbeBody });
  const buyer = dashboardShell({
    title: 'Buyer Portal · Alex Rivera (synthetic)',
    body: [
      modeSwitcher({ mode: 'mine', firstName: 'Alex', others: [RIVERA.members[1]], mineHref: '/portal?view=mine', sharedHref: '/portal?view=shared' }),
      stageMapHtml({ currentStage: 'possibilities', completed: ['buyerExperience','consultation','representation','search','market'], actor: actorAlex }),
      whatsNextPanel({ stage: 'possibilities', checklistItems: items, completions: [], tasks, actor: actorAlex }),
      storyPanel(RIVERA.story, { mode: 'mine', actor: actorAlex }),
      compassPanel({
        optimizing_for: 'A calmer daily home base with a practical commute and enough room to host family.',
        tradeoffs: 'Square footage vs location, condition, and a neighborhood that feels settled.',
        uncertainty: 'Which streets still feel right on a weeknight after dark.',
        evidence: 'Consultation complete. Representation chosen. Criteria drafted around commute, quiet, gathering space, and condition.',
        next_conversation: 'Look at three homes that test the space-versus-location tradeoff.'
      }),
      checklistPanel({ stageId: 'possibilities', items, completions: [], actor: actorAlex, action: '/api/portal/checklist/toggle' }),
      compensationPublicHtml()
    ].join('\n')
  });
  const preview = dashboardShell({
    title: 'HBE preview of buyer dashboard',
    banner: previewBanner({ buyerName: 'Alex Rivera', returnHref: '/hbe?buyer=alex-rivera' }),
    body: buyer.match(/<main[\s\S]*<\/main>/)[0].replace(/<\/?main[^>]*>/g, '')
  });
  const thanks = thankYouHtml({ first: 'Alex', accessCode: 'AAAA-BBBB-CCCC-DDDD', remembered: true });
  writeFileSync('/workspace/hbexperts-site/docs/issue29/hbe-dashboard.html', hbe);
  writeFileSync('/workspace/hbexperts-site/docs/issue29/buyer-dashboard.html', buyer);
  writeFileSync('/workspace/hbexperts-site/docs/issue29/hbe-preview-buyer.html', preview);
  writeFileSync('/workspace/hbexperts-site/docs/issue29/thank-you.html', thanks);
  writeFileSync('/workspace/hbexperts-site/docs/issue29/public-compensation.html', dashboardShell({ title: 'Public compensation', body: compensationPublicHtml() + stageMapHtml({ currentStage: 'buyerExperience', actor: { kind: 'buyer' } }) }));
  assert.ok(hbe.includes('After the Keys'));
  assert.ok(!buyer.includes(RIVERA.story.hbe_synthesis));
  assert.ok(!buyer.includes(RIVERA.private.sam));
  assert.ok(ISSUE29_CSS.includes('max-width:560px'));
});
