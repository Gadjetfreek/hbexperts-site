import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { STAGES, STAGE_CHECKLISTS, STAGE_COUNT, assertSeventeenStages, stageLabel, COMPENSATION_PUBLIC } from '../src/journey-stages.js';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { deriveWhatsNext, filterStory, defaultCompass, canSeeItem, sha256Hex, randomToken, dueDateFromOffset, completeChecklistItem, isCompletedForActor, completionScopeKey, mutationCsrfToken, assertMutationCsrf, sameOriginRequest, validStageId, loadHouseholdBundle, taskVisibleToActor, generatedActionVisibility } from '../src/household-state.js';
import { stageMapHtml, splitHouseholdCard, storyPanel, compassPanel, whatsNextPanel, checklistPanel, modeSwitcher, thankYouHtml, compensationPublicHtml, dashboardShell, previewBanner, ISSUE29_CSS, buyerDashboardBody, previewMemberNav } from '../src/issue29-ui.js';
import worker from '../src/issue29-convergence-worker.js';
import consentWorker, { inviteResultHtml } from '../src/co-buyer-consent-worker.js';

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

test('buyerDashboardBody is defined and preview HTML renders both views plus 17 stages', () => {
  assert.equal(typeof buyerDashboardBody, 'function');
  const items = [];
  for (const [id] of STAGES) {
    for (const spec of STAGE_CHECKLISTS[id]) {
      items.push({ id: spec.key, stage_id: id, item_key: spec.key, title: spec.title, visibility: spec.visibility });
    }
  }
  const actor = { kind: 'buyer', id: 'alex-rivera', private_context: RIVERA.private.alex };
  const html = buyerDashboardBody({
    buyer: RIVERA.members[0],
    bundle: { items, completions: [], tasks: [], story: RIVERA.story, compass: defaultCompass('possibilities'), members: RIVERA.members, privateContexts: [] },
    actor,
    mode: 'mine',
    currentStage: 'possibilities',
    selectedStage: 'afterKeys',
    checklistAction: '/api/hbe/checklist/toggle',
    others: [RIVERA.members[1]],
    mineHref: '/hbe/preview?buyer=alex-rivera&view=mine',
    sharedHref: '/hbe/preview?buyer=alex-rivera&view=shared',
    compensationHtml: compensationPublicHtml(),
    stageHrefFor: id => `/hbe/preview?buyer=alex-rivera&view=mine&stage=${id}`
  });
  assert.match(html, /After the Keys/);
  assert.match(html, /data-selected-stage="afterKeys"/);
  assert.match(html, /My View/);
  assert.match(html, /Shared Household View/);
  assert.equal((html.match(/class="i29-stop /g) || []).length, 17);
  assert.doesNotMatch(html, /buyerDashboardBody is not defined/);
});

test('compass HBE edit form posts to /api/hbe/compass', () => {
  const html = compassPanel(defaultCompass('possibilities'), {
    editable: true,
    csrfField: '<input type="hidden" name="csrf" value="token">',
    hiddenFields: '<input type="hidden" name="buyer_id" value="alex-rivera">'
  });
  assert.match(html, /action="\/api\/hbe\/compass"/);
  assert.match(html, /name="optimizing_for"/);
  assert.match(html, /name="csrf"/);
  assert.match(html, /Save journey compass/);
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

const TEAM_DOMAIN = 'https://hbexperts.cloudflareaccess.com';
const ACCESS_AUD = 'issue29-test-audience';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_JWK = publicKey.export({ format: 'jwk' });
TEST_JWK.kid = 'issue29-test-kid';
TEST_JWK.use = 'sig';
TEST_JWK.alg = 'RS256';

function mintAccessJwt(email, extra = {}) {
  const header = { alg: 'RS256', kid: TEST_JWK.kid, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: TEAM_DOMAIN,
    aud: ACCESS_AUD,
    email,
    exp: now + 3600,
    iat: now,
    ...extra
  };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = nodeSign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (url.includes('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [TEST_JWK] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (typeof realFetch === 'function') return realFetch(input, init);
  throw new Error(`unexpected fetch ${url}`);
};

function createMemoryD1() {
  const tables = {
    buyers: [],
    buyer_sessions: [],
    buyer_cases: [],
    buyer_case_members: [],
    hbe_professionals: [],
    household_checklist_items: [],
    household_checklist_completions: [],
    household_tasks: [],
    household_audit_events: [],
    household_stories: [],
    household_compass: [],
    household_view_permissions: [],
    buyer_private_context: [],
    buyer_tasks: [],
    buyer_notes: [],
    notifications: [],
    buyer_representation_records: [],
    buyer_case_invitations: [],
    buyer_person_profiles: [],
    buyer_case_financials: []
  };
  const log = [];

  function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function parseWhere(sql, args) {
    const idx = sql.search(/\bwhere\b/i);
    if (idx < 0) return { filters: [] };
    let where = sql.slice(idx + 5);
    where = where.split(/\border\s+by\b|\blimit\b|\bgroup\s+by\b|\bon\s+conflict\b/i)[0];
    const filters = [];
    let i = 0;
    const parts = where.split(/\s+AND\s+/i);
    for (const part of parts) {
      const p = part.trim().replace(/^\(|\)$/g, '').trim();
      let m;
      if ((m = p.match(/^lower\((\w+)\)\s*=\s*\?$/i))) {
        filters.push({ col: m[1], value: args[i++], lower: true });
      } else if ((m = p.match(/^(?:coalesce|ifnull)\((\w+),\s*''\)\s*=\s*\?$/i))) {
        filters.push({ col: m[1], value: args[i++], coalesceEmpty: true });
      } else if ((m = p.match(/^(\w+)\s*=\s*\?$/i))) {
        filters.push({ col: m[1], value: args[i++] });
      } else if ((m = p.match(/^(\w+)\s*>\s*\?$/i))) {
        filters.push({ col: m[1], value: args[i++], gt: true });
      }
    }
    return { filters };
  }

  function matchRow(row, filters) {
    return filters.every(f => {
      let v = row[f.col];
      if (f.lower) return String(v || '').toLowerCase() === String(f.value || '').toLowerCase();
      if (f.coalesceEmpty) return String(v ?? '') === String(f.value ?? '');
      if (f.gt) return String(v) > String(f.value);
      return v == f.value || String(v) === String(f.value);
    });
  }

  function parseInsert(sql, args) {
    const m = sql.match(/insert(?:\s+or\s+ignore)?\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (!m) return null;
    const cols = m[2].split(',').map(c => c.trim());
    const row = {};
    cols.forEach((c, idx) => { row[c] = args[idx]; });
    return { table: m[1], row, ignore: /^\s*insert\s+or\s+ignore/i.test(sql), conflict: /on conflict/i.test(sql) };
  }

  const api = {
    _tables: tables,
    _log: log,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      const bound = (args = []) => ({
        async first() {
          log.push({ op: 'first', sql: normalized, args });
          return api._select(normalized, args)[0] || null;
        },
        async all() {
          log.push({ op: 'all', sql: normalized, args });
          return { results: api._select(normalized, args) };
        },
        async run() {
          log.push({ op: 'run', sql: normalized, args });
          return api._run(normalized, args);
        }
      });
      return Object.assign(bound([]), {
        bind(...args) { return bound(args); }
      });
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) {
        if (s && typeof s.run === 'function') out.push(await s.run());
      }
      return out;
    },
    _select(sql, args) {
      const count = /^\s*select count\(\*\) as n from (\w+)/i.exec(sql);
      if (count) {
        const { filters } = parseWhere(sql, args);
        return [{ n: getTable(count[1]).filter(r => matchRow(r, filters)).length }];
      }
      const from = sql.match(/\bfrom\s+(\w+)/i);
      if (!from) return [];
      const { filters } = parseWhere(sql, args);
      if (/left join buyer_case_members/i.test(sql) && from[1] === 'buyers') {
        return getTable('buyers').map(b => {
          const m = getTable('buyer_case_members').find(x => x.buyer_id === b.id);
          return { ...b, case_id: m?.case_id || null };
        });
      }
      let rows = getTable(from[1]).filter(r => matchRow(r, filters));
      if (/join\s+buyers/i.test(sql) && from[1] === 'buyer_sessions') {
        rows = rows.map(s => {
          const b = getTable('buyers').find(x => x.id === s.buyer_id);
          return b ? { ...b, session_id: s.id, buyer_id: s.buyer_id, expires_at: s.expires_at, token_hash: s.token_hash } : null;
        }).filter(Boolean).filter(r => matchRow(r, filters));
      }
      if (/join\s+buyers/i.test(sql) && from[1] === 'buyer_case_members') {
        rows = getTable('buyer_case_members').filter(r => matchRow(r, filters)).flatMap(m => {
          const b = getTable('buyers').find(x => x.id === m.buyer_id);
          return b ? [{ ...b, ...m }] : [];
        });
      }
      return rows;
    },
    _run(sql, args) {
      if (/^\s*insert/i.test(sql)) {
        const parsed = parseInsert(sql, args);
        if (parsed) {
          const t = getTable(parsed.table);
          if (parsed.conflict || parsed.ignore) {
            const pk = parsed.row.id != null ? 'id' : (parsed.row.case_id != null && parsed.table !== 'buyer_case_members' ? 'case_id' : 'id');
            const existing = t.find(r => r[pk] === parsed.row[pk]);
            if (existing) {
              if (parsed.conflict) Object.assign(existing, parsed.row);
              return { success: true, meta: { changes: parsed.conflict ? 1 : 0 } };
            }
          }
          t.push({ ...parsed.row });
          return { success: true, meta: { changes: 1 } };
        }
      }
      if (/^\s*delete/i.test(sql)) {
        const m = sql.match(/delete from (\w+)/i);
        const { filters } = parseWhere(sql, args);
        const t = getTable(m[1]);
        const keep = t.filter(r => !matchRow(r, filters));
        const changes = t.length - keep.length;
        tables[m[1]] = keep;
        return { success: true, meta: { changes } };
      }
      if (/^\s*update/i.test(sql)) {
        const m = sql.match(/update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)/i);
        if (!m) return { success: true, meta: { changes: 0 } };
        const setSql = m[2];
        const whereSql = m[3];
        const assigns = {};
        let i = 0;
        for (const part of setSql.split(',').map(s => s.trim())) {
          const sm = part.match(/^(\w+)\s*=\s*\?$/);
          if (sm) assigns[sm[1]] = args[i++];
          else {
            const lit = part.match(/^(\w+)\s*=\s*'([^']*)'$/);
            if (lit) assigns[lit[1]] = lit[2];
            else {
              const num = part.match(/^(\w+)\s*=\s*(\d+)$/);
              if (num) assigns[num[1]] = Number(num[2]);
            }
          }
        }
        const { filters } = parseWhere('WHERE ' + whereSql, args.slice(i));
        let changes = 0;
        for (const row of getTable(m[1])) {
          if (matchRow(row, filters)) {
            Object.assign(row, assigns);
            changes += 1;
          }
        }
        return { success: true, meta: { changes } };
      }
      return { success: true, meta: { changes: 0 } };
    }
  };
  return api;
}

function seedRiveraHousehold(db) {
  const now = '2026-08-31T12:00:00.000Z';
  db._tables.hbe_professionals.push({
    id: 'hbe-pro-christopher-whitehead',
    email: 'cwhitehead@hbexperts.com',
    display_name: 'Christopher Whitehead',
    role: 'broker_admin',
    status: 'active',
    workspace_status: 'provisioned',
    workspace_user_id: null
  });
  db._tables.buyers.push({
    id: 'alex-rivera', created_at: now, submitted_at: now, updated_at: now,
    first_name: 'Alex', last_name: 'Rivera', email: 'alex.rivera@example.test', phone: '',
    stage: 'possibilities', completed_stages: '["buyerExperience","consultation","representation","search","market"]',
    answers_json: '{}'
  });
  db._tables.buyers.push({
    id: 'sam-rivera', created_at: now, submitted_at: now, updated_at: now,
    first_name: 'Sam', last_name: 'Rivera', email: 'sam.rivera@example.test', phone: '',
    stage: 'possibilities', completed_stages: '["buyerExperience","consultation","representation","search","market"]',
    answers_json: '{}'
  });
  db._tables.buyer_cases.push({ id: 'case-rivera', created_at: now, updated_at: now, stage: 'possibilities', completed_stages: '[]', status: 'active' });
  db._tables.buyer_case_members.push({ case_id: 'case-rivera', buyer_id: 'alex-rivera', role: 'buyer', created_at: now });
  db._tables.buyer_case_members.push({ case_id: 'case-rivera', buyer_id: 'sam-rivera', role: 'buyer', created_at: now });
  db._tables.household_checklist_items.push({
    id: 'item-buyer-private', case_id: 'case-rivera', stage_id: 'possibilities', item_key: 'my_reaction',
    title: 'Record my private reaction to today’s possibilities', visibility: 'buyer', sort_order: 1,
    creates_action_kind: 'buyer_task', creates_action_title: 'Write a private reaction', creates_due_offset_days: 3, creates_priority: 'high'
  });
  db._tables.household_checklist_items.push({
    id: 'item-shared', case_id: 'case-rivera', stage_id: 'possibilities', item_key: 'review_fits',
    title: 'Review today’s best-fit possibilities', visibility: 'shared', sort_order: 2,
    creates_action_kind: 'buyer_task', creates_action_title: 'Each buyer reacts privately, then compare only shared facts', creates_due_offset_days: 3, creates_priority: 'high'
  });
  db._tables.household_checklist_items.push({
    id: 'item-hbe', case_id: 'case-rivera', stage_id: 'possibilities', item_key: 'rejection_pattern',
    title: 'Record why rejected homes missed', visibility: 'hbe', sort_order: 3,
    creates_action_kind: 'hbe_task', creates_action_title: 'Update the household story', creates_due_offset_days: 3, creates_priority: 'high'
  });
  return db;
}

function testEnv(db) {
  return {
    BUYER_DB: db,
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: ACCESS_AUD,
    HBE_ADMIN_EMAIL: 'cwhitehead@hbexperts.com'
  };
}

async function hbeHeaders(extra = {}) {
  const jwt = mintAccessJwt('cwhitehead@hbexperts.com');
  return {
    jwt,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      origin: 'https://buyer.hbexperts.com',
      ...extra
    }
  };
}

test('missing JWT is rejected on /api/hbe/*', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/checklist/toggle', {
    method: 'POST',
    headers: { origin: 'https://buyer.hbexperts.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'item_id=item-shared&case_id=case-rivera&buyer_id=alex-rivera'
  }), testEnv(db), {});
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Cloudflare Access authentication required|HBE Access is not fully configured|HBE access required|HBE_ACCESS_AUTH|session has ended/i);
});

test('spoofed Access email header alone is not enough for /api/hbe/*', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/story', {
    method: 'POST',
    headers: {
      origin: 'https://buyer.hbexperts.com',
      'Cf-Access-Authenticated-User-Email': 'cwhitehead@hbexperts.com',
      'X-HBE-Verified-Professional-Email': 'cwhitehead@hbexperts.com',
      'X-HBE-Verified-Professional-Id': 'hbe-pro-christopher-whitehead',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'case_id=case-rivera&buyer_id=alex-rivera&shared_story=nope'
  }), testEnv(db), {});
  assert.equal(res.status, 403);
  const completions = db._tables.household_checklist_completions.length;
  assert.equal(completions, 0);
});

test('preview renders without ReferenceError and supports My View plus Shared Household View', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const { jwt, headers } = await hbeHeaders();
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=alex-rivera', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Previewing buyer-facing UI for Alex Rivera/);
  assert.match(html, /My View/);
  assert.match(html, /Shared Household View/);
  assert.match(html, /After the Keys/);
  assert.doesNotMatch(html, /buyerDashboardBody is not defined/);
  assert.doesNotMatch(html, /ReferenceError/);

  const shared = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=alex-rivera&view=shared', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /Shared Household View/);
  void jwt;
});

test('selecting stage 17 does not mutate current stage', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const { headers } = await hbeHeaders();
  const before = db._tables.buyers.find(b => b.id === 'alex-rivera').stage;
  assert.equal(before, 'possibilities');
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=alex-rivera&stage=afterKeys', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-selected-stage="afterKeys"/);
  assert.match(html, /Stage checklist · After the Keys/);
  assert.equal(db._tables.buyers.find(b => b.id === 'alex-rivera').stage, 'possibilities');
  const mutated = db._log.some(e => /update\s+buyers\s+set\s+stage/i.test(e.sql));
  assert.equal(mutated, false);
  assert.equal(validStageId('afterKeys'), 'afterKeys');
});

test('person A complete != person B for buyer-private items; shared stays household-level', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const alex = { kind: 'buyer', id: 'alex-rivera' };
  const sam = { kind: 'buyer', id: 'sam-rivera' };
  const privateItem = db._tables.household_checklist_items.find(i => i.id === 'item-buyer-private');
  const sharedItem = db._tables.household_checklist_items.find(i => i.id === 'item-shared');

  const alexDone = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: privateItem.id, actor: alex });
  assert.equal(alexDone.ok, true);
  assert.equal(isCompletedForActor(privateItem, db._tables.household_checklist_completions, alex), true);
  assert.equal(isCompletedForActor(privateItem, db._tables.household_checklist_completions, sam), false);

  const samDone = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: privateItem.id, actor: sam });
  assert.equal(samDone.ok, true);
  assert.equal(samDone.already, undefined);
  assert.equal(db._tables.household_checklist_completions.filter(c => c.item_id === privateItem.id).length, 2);
  assert.equal(isCompletedForActor(privateItem, db._tables.household_checklist_completions, sam), true);

  const sharedAlex = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: sharedItem.id, actor: alex });
  assert.equal(sharedAlex.ok, true);
  const sharedSam = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: sharedItem.id, actor: sam });
  assert.equal(sharedSam.already, true);
  assert.equal(db._tables.household_checklist_completions.filter(c => c.item_id === sharedItem.id).length, 1);
  assert.equal(completionScopeKey(sharedItem, alex), 'item-shared:household');
  assert.match(completionScopeKey(privateItem, alex), /alex-rivera/);
});

test('reopen/complete is idempotent and does not duplicate tasks', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const actor = { kind: 'buyer', id: 'alex-rivera' };
  const itemId = 'item-shared';

  const first = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(first.ok, true);
  const second = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(second.already, true);
  assert.equal(db._tables.household_tasks.filter(t => t.source_item_id === itemId).length, 1);
  const auditsAfterComplete = db._tables.household_audit_events.filter(a => a.action === 'checklist_completed').length;

  const reopenOpen = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor, reopen: true });
  assert.equal(reopenOpen.reopened, true);
  const reopenAgain = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor, reopen: true });
  assert.equal(reopenAgain.reopened, false);
  assert.equal(reopenAgain.already, true);
  assert.equal(db._tables.household_audit_events.filter(a => a.action === 'checklist_reopened').length, 1);

  const recomplete = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(recomplete.ok, true);
  assert.equal(recomplete.already, undefined);
  assert.equal(db._tables.household_tasks.filter(t => t.source_item_id === itemId).length, 1);
  assert.equal(db._tables.household_tasks[0].status, 'open');
  const recompleteAgain = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(recompleteAgain.already, true);
  assert.equal(db._tables.household_audit_events.filter(a => a.action === 'checklist_completed').length, auditsAfterComplete + 1);
  assert.equal(db._tables.household_audit_events.filter(a => a.action === 'task_created_from_checklist').length, 1);
});

test('CSRF rejection on new POSTs: missing origin, wrong origin, missing token', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const jwt = mintAccessJwt('cwhitehead@hbexperts.com');
  const token = await mutationCsrfToken(jwt);

  const noOrigin = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/compass', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, 'content-type': 'application/x-www-form-urlencoded' },
    body: `csrf=${token}&case_id=case-rivera&buyer_id=alex-rivera&optimizing_for=x`
  }), env, {});
  assert.equal(noOrigin.status, 403);
  assert.match(await noOrigin.text(), /CSRF rejected/);

  const wrongOrigin = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/compass', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: `csrf=${token}&case_id=case-rivera&buyer_id=alex-rivera&optimizing_for=x`
  }), env, {});
  assert.equal(wrongOrigin.status, 403);

  const missingToken = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/checklist/toggle', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, origin: 'https://buyer.hbexperts.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'item_id=item-shared&case_id=case-rivera&buyer_id=alex-rivera'
  }), env, {});
  assert.equal(missingToken.status, 403);

  const ok = await worker.fetch(new Request('https://buyer.hbexperts.com/api/hbe/checklist/toggle', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, origin: 'https://buyer.hbexperts.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: `csrf=${encodeURIComponent(token)}&item_id=item-shared&case_id=case-rivera&buyer_id=alex-rivera&stage_id=afterKeys`
  }), env, {});
  assert.equal(ok.status, 303);
  assert.equal(db._tables.buyers.find(b => b.id === 'alex-rivera').stage, 'possibilities');
  assert.match(ok.headers.get('location'), /stage=afterKeys/);

  const fake = { url: 'https://buyer.hbexperts.com/x', headers: { get: k => k === 'Origin' ? 'https://buyer.hbexperts.com' : null } };
  assert.equal(sameOriginRequest(fake), true);
  assert.equal(await assertMutationCsrf(fake, token, jwt), true);
  assert.equal(await assertMutationCsrf(fake, 'nope', jwt), false);
});

test('exactly 17 stages still after sentinel repairs', () => {
  assert.equal(STAGES.length, 17);
  assert.equal(STAGES[16][0], 'afterKeys');
  assert.equal(STAGE_CHECKLISTS.afterKeys.some(i => /30-day/i.test(i.title)), true);
  assert.equal(STAGES.some(s => s[0] === 'care30'), false);
});

test('Alex-specific task is invisible to Sam My View / What’s Next and visible to Alex and HBE', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const alex = { kind: 'buyer', id: 'alex-rivera' };
  const sam = { kind: 'buyer', id: 'sam-rivera' };
  const hbe = { kind: 'hbe', id: 'cwhitehead@hbexperts.com' };
  const privateItem = db._tables.household_checklist_items.find(i => i.id === 'item-buyer-private');
  assert.equal(generatedActionVisibility(privateItem), 'buyer');

  const done = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: privateItem.id, actor: alex });
  assert.equal(done.ok, true);
  const task = db._tables.household_tasks.find(t => t.source_item_id === privateItem.id);
  assert.ok(task);
  assert.equal(task.visibility, 'buyer');
  assert.equal(task.buyer_id, 'alex-rivera');
  assert.equal(taskVisibleToActor(task, alex), true);
  assert.equal(taskVisibleToActor(task, sam), false);
  assert.equal(taskVisibleToActor(task, hbe), true);

  const samBundle = await loadHouseholdBundle(env, 'case-rivera', sam);
  assert.equal(samBundle.tasks.some(t => t.id === task.id), false);
  const alexBundle = await loadHouseholdBundle(env, 'case-rivera', alex);
  assert.equal(alexBundle.tasks.some(t => t.id === task.id), true);
  const hbeBundle = await loadHouseholdBundle(env, 'case-rivera', hbe);
  assert.equal(hbeBundle.tasks.some(t => t.id === task.id), true);

  const samNext = deriveWhatsNext({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor: sam
  });
  assert.notEqual(samNext.id, task.id);
  assert.notEqual(samNext.title, task.title);
  assert.doesNotMatch(samNext.title, /Write a private reaction/);

  const alexNext = deriveWhatsNext({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor: alex
  });
  assert.equal(alexNext.title, task.title);

  const samPanel = whatsNextPanel({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor: sam
  });
  assert.doesNotMatch(samPanel, /Write a private reaction/);
  const alexPanel = whatsNextPanel({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor: alex
  });
  assert.match(alexPanel, /Write a private reaction/);
  const hbePanel = whatsNextPanel({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor: hbe
  });
  assert.match(hbePanel, /Write a private reaction/);
});

test('HBE cannot create an HBE-scoped completion for a buyer-private item without an explicit target', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const hbe = { kind: 'hbe', id: 'cwhitehead@hbexperts.com' };
  const privateItem = db._tables.household_checklist_items.find(i => i.id === 'item-buyer-private');

  const blocked = await completeChecklistItem(env, { caseId: 'case-rivera', itemId: privateItem.id, actor: hbe });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'explicit-target-required');
  assert.equal(db._tables.household_checklist_completions.length, 0);
  assert.equal(db._tables.household_checklist_completions.some(c => String(c.scope_key || '').includes(':hbe:')), false);

  const alex = { kind: 'buyer', id: 'alex-rivera' };
  await completeChecklistItem(env, { caseId: 'case-rivera', itemId: privateItem.id, actor: alex });
  const html = checklistPanel({
    stageId: 'possibilities',
    items: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    actor: hbe,
    action: '/api/hbe/checklist/toggle',
    members: RIVERA.members
  });
  assert.match(html, /Alex done \/ Sam not/);
  assert.match(html, /read-only/i);
  assert.doesNotMatch(html, /name="item_id" value="item-buyer-private"/);
});

test('HBE preview navigation reaches Alex My View, Sam My View, and Shared View', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const { headers } = await hbeHeaders();
  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=alex-rivera', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Alex My View/);
  assert.match(html, /Sam My View/);
  assert.match(html, /Shared Household View/);
  assert.match(html, /\/hbe\/preview\?buyer=alex-rivera&amp;view=mine/);
  assert.match(html, /\/hbe\/preview\?buyer=sam-rivera&amp;view=mine/);
  assert.match(html, /view=shared/);

  const sam = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=sam-rivera&view=mine', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(sam.status, 200);
  const samHtml = await sam.text();
  assert.match(samHtml, /Sam My View/);
  assert.match(samHtml, /Previewing buyer-facing UI for Sam Rivera/);

  const shared = await worker.fetch(new Request('https://buyer.hbexperts.com/hbe/preview?buyer=alex-rivera&view=shared', {
    method: 'GET',
    headers
  }), testEnv(db), {});
  assert.equal(shared.status, 200);
  const sharedHtml = await shared.text();
  assert.match(sharedHtml, /Shared Household View/);

  const nav = previewMemberNav({ members: RIVERA.members, currentBuyerId: 'alex-rivera', mode: 'mine' });
  assert.match(nav, /Alex My View/);
  assert.match(nav, /Sam My View/);
  assert.match(nav, /Shared Household View/);
});

test('reopen suppresses generated task; re-complete reuses\/reactivates without duplicates', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const env = testEnv(db);
  const actor = { kind: 'buyer', id: 'alex-rivera' };
  const itemId = 'item-buyer-private';

  const first = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(first.ok, true);
  assert.equal(db._tables.household_tasks.filter(t => t.source_item_id === itemId).length, 1);
  const taskId = db._tables.household_tasks[0].id;
  assert.equal(db._tables.household_tasks[0].status, 'open');

  const reopen = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor, reopen: true });
  assert.equal(reopen.reopened, true);
  assert.equal(db._tables.household_tasks.length, 1);
  assert.equal(db._tables.household_tasks[0].id, taskId);
  assert.equal(db._tables.household_tasks[0].status, 'suppressed');
  assert.equal(db._tables.household_tasks[0].is_whats_next, 0);
  assert.equal(db._tables.household_audit_events.some(a => a.action === 'reopen_deactivated_task'), true);

  const stale = deriveWhatsNext({
    stage: 'possibilities',
    checklistItems: db._tables.household_checklist_items,
    completions: db._tables.household_checklist_completions,
    tasks: db._tables.household_tasks,
    actor
  });
  assert.notEqual(stale.id, taskId);

  const recomplete = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(recomplete.ok, true);
  assert.equal(db._tables.household_tasks.length, 1);
  assert.equal(db._tables.household_tasks[0].id, taskId);
  assert.equal(db._tables.household_tasks[0].status, 'open');
  assert.equal(db._tables.household_audit_events.some(a => a.action === 'complete_reactivated_task'), true);
  const again = await completeChecklistItem(env, { caseId: 'case-rivera', itemId, actor });
  assert.equal(again.already, true);
  assert.equal(db._tables.household_tasks.filter(t => t.source_item_id === itemId).length, 1);
});

test('invite result includes mailto Email invitation and Copy link while persisting no invitee email', async () => {
  const db = seedRiveraHousehold(createMemoryD1());
  const sessionToken = 'alex-session-token';
  const tokenHash = await sha256Hex(sessionToken);
  db._tables.buyer_sessions.push({
    id: 'sess-alex',
    buyer_id: 'alex-rivera',
    token_hash: tokenHash,
    created_at: '2026-08-31T12:00:00.000Z',
    last_seen_at: '2026-08-31T12:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
    remembered: 1
  });

  const snapshot = inviteResultHtml('https://buyer.hbexperts.com/invite/example-token');
  assert.match(snapshot, /mailto:/);
  assert.match(snapshot, /Email invitation/);
  assert.match(snapshot, /Copy invitation link/);
  assert.doesNotMatch(snapshot, /name="invitee_email"|name="email"/);

  const res = await worker.fetch(new Request('https://buyer.hbexperts.com/api/household/invite', {
    method: 'POST',
    headers: {
      origin: 'https://buyer.hbexperts.com',
      cookie: `hbe_session=${sessionToken}`
    }
  }), testEnv(db), {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /mailto:/);
  assert.match(html, /Email invitation/);
  assert.match(html, /Copy invitation link/);
  assert.doesNotMatch(html, /name="invitee_email"/);
  assert.doesNotMatch(html, /<input[^>]*name="email"/i);
  assert.equal(db._tables.buyer_case_invitations.length, 1);
  const row = db._tables.buyer_case_invitations[0];
  assert.equal(row.invitee_email, undefined);
  assert.equal(row.email, undefined);
  assert.ok(row.token_hash);
  assert.equal(row.token_hash.length, 64);
  assert.notEqual(row.token_hash, sessionToken);
  const keys = Object.keys(row).join(',');
  assert.doesNotMatch(keys, /invitee|email/i);
  void consentWorker;
});
