import appWorker from './value-brand-worker.js';
import { authenticateHbeProfessional } from './hbe-access-worker.js';
import { STAGES, STAGE_CHECKLISTS, assertSeventeenStages } from './journey-stages.js';
import {
  ensureHouseholdState, loadHouseholdBundle, completeChecklistItem, saveStory, saveCompass,
  caseIdForBuyer, mutationCsrfToken, assertMutationCsrf, validStageId
} from './household-state.js';
import {
  ISSUE29_CSS, ISSUE29_JS, stageMapHtml, splitHouseholdCard, storyPanel, compassPanel,
  whatsNextPanel, checklistPanel, previewBanner, thankYouHtml,
  compensationPublicHtml, compensationPostHireHtml, dashboardShell, buyerDashboardBody, previewMemberNav, esc
} from './issue29-ui.js';
import { handleShowingCardRoutes, enhanceHbeWithProperties } from './showing-card/index.js';

assertSeventeenStages();

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const showing = await handleShowingCardRoutes(request, env, ctx);
    if (showing) return showing;

    if (request.method === 'POST' && url.pathname === '/api/hbe/checklist/toggle') {
      return handleChecklistToggle(request, env, ctx, 'hbe');
    }
    if (request.method === 'POST' && url.pathname === '/api/portal/checklist/toggle') {
      return handleChecklistToggle(request, env, ctx, 'buyer');
    }
    if (request.method === 'POST' && url.pathname === '/api/hbe/story') {
      return handleStorySave(request, env, ctx);
    }
    if (request.method === 'POST' && url.pathname === '/api/hbe/compass') {
      return handleCompassSave(request, env, ctx);
    }

    if (request.method === 'GET' && url.pathname === '/hbe/preview') {
      return hbeBuyerPreview(request, env, ctx, url);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (request.method === 'GET' && url.pathname === '/health' && type.includes('application/json')) {
      try {
        const body = await response.json();
        body.issue29 = { stages: STAGES.length, stage17: 'afterKeys', persistence: 'd1-household-state' };
        body.showingCard = { enabled: true, dossier: 'brigham-v1', r2: Boolean(env.SHOWING_PHOTOS) };
        return json(body);
      } catch {
        return response;
      }
    }

    if (!type.includes('text/html')) return response;

    let text = await response.text();

    try {
      if (request.method === 'GET' && url.pathname === '/hbe' && response.status === 200) {
        text = await enhanceHbeDashboard(request, env, url, text);
        text = await enhanceHbeWithProperties(request, env, url, text);
      }
      if (request.method === 'GET' && url.pathname === '/portal' && response.status === 200) {
        text = await enhanceBuyerPortal(request, env, url, text);
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/questionnaire' || url.pathname === '/login')) {
        text = enhancePublic(text, url.pathname);
      }
      if (isThankYouPage(text)) {
        text = rewriteThankYou(text) || text;
      }
    } catch (err) {
      console.error('Issue 29 enhancement failed', err);
    }

    if (!text.includes('id="issue29-convergence"')) {
      text = text.replace('</head>', `${ISSUE29_CSS}</head>`);
    }
    if (!text.includes('data-i29-stop') === false && text.includes('data-i29-stop') && !text.includes('data-i29-js-applied')) {
      text = text.replace('</body>', `${ISSUE29_JS}</body>`);
    } else if (text.includes('data-i29-stop') && !text.includes('[data-i29-stop]')) {
      text = text.replace('</body>', `${ISSUE29_JS}</body>`);
    }

    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }
};

async function requireHbeProfessional(request, env, ctx) {
  const auth = await authenticateHbeProfessional(request, env);
  if (!auth.ok) return { ok: false, response: auth.response };
  try {
    const probe = new Request(new URL('/hbe', request.url), { method: 'GET', headers: request.headers });
    const gate = await appWorker.fetch(probe, env, ctx);
    if (gate.status === 403) return { ok: false, response: gate };
  } catch (err) {
    console.error('HBE /hbe probe failed after JWT verification', err);
  }
  return { ok: true, professional: auth.professional };
}

async function csrfFieldFor(secret) {
  const token = await mutationCsrfToken(secret);
  return token ? `<input type="hidden" name="csrf" value="${esc(token)}">` : '';
}

async function handleChecklistToggle(request, env, ctx, expectedKind) {
  if (expectedKind === 'hbe') {
    const auth = await requireHbeProfessional(request, env, ctx);
    if (!auth.ok) return auth.response;
    if (!env.BUYER_DB) return unavailable();
    const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
    const form = await request.formData();
    if (!await assertMutationCsrf(request, form.get('csrf'), jwt)) return forbidden('CSRF rejected.');
    const buyerId = clean(form.get('buyer_id'));
    const caseId = clean(form.get('case_id')) || (buyerId ? await caseIdForBuyer(env, buyerId) : '');
    if (!caseId) return redirect('/hbe');
    await ensureHouseholdState(env, caseId, { actorId: auth.professional.email });
    await completeChecklistItem(env, {
      caseId,
      itemId: clean(form.get('item_id')),
      actor: { kind: 'hbe', id: auth.professional.email },
      reopen: clean(form.get('reopen')) === 'yes',
      targetBuyerId: clean(form.get('target_buyer_id'))
    });
    const selected = validStageId(form.get('stage_id'));
    const q = new URLSearchParams();
    if (buyerId) q.set('buyer', buyerId);
    if (selected) q.set('stage', selected);
    const qs = q.toString();
    return redirect(`/hbe${qs ? `?${qs}` : ''}${selected ? `#stage-${selected}` : ''}`);
  }

  const buyer = await getBuyerSession(request, env);
  if (!buyer) return redirect('/login');
  if (!env.BUYER_DB) return unavailable();
  const sessionToken = getCookie(request, 'hbe_session');
  const form = await request.formData();
  if (!await assertMutationCsrf(request, form.get('csrf'), sessionToken)) return forbidden('CSRF rejected.');
  const caseId = await caseIdForBuyer(env, buyer.buyer.id);
  if (!caseId) return redirect('/portal');
  await ensureHouseholdState(env, caseId, { actorId: buyer.buyer.id });
  await completeChecklistItem(env, {
    caseId,
    itemId: clean(form.get('item_id')),
    actor: { kind: 'buyer', id: buyer.buyer.id },
    reopen: clean(form.get('reopen')) === 'yes'
  });
  const view = clean(form.get('view')) === 'shared' ? 'shared' : 'mine';
  const selected = validStageId(form.get('stage_id'));
  const q = new URLSearchParams({ view });
  if (selected) q.set('stage', selected);
  return redirect(`/portal?${q.toString()}${selected ? `#stage-${selected}` : ''}`);
}

async function handleStorySave(request, env, ctx) {
  const auth = await requireHbeProfessional(request, env, ctx);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const form = await request.formData();
  if (!await assertMutationCsrf(request, form.get('csrf'), jwt)) return forbidden('CSRF rejected.');
  const buyerId = clean(form.get('buyer_id'));
  const caseId = clean(form.get('case_id')) || (buyerId ? await caseIdForBuyer(env, buyerId) : '');
  if (!caseId) return redirect('/hbe');
  await saveStory(env, {
    caseId,
    actor: { kind: 'hbe', id: auth.professional.email },
    fields: {
      shared_story: clean(form.get('shared_story')),
      hbe_synthesis: clean(form.get('hbe_synthesis')),
      wants: clean(form.get('wants')),
      needs: clean(form.get('needs')),
      tradeoffs: clean(form.get('tradeoffs')),
      risks: clean(form.get('risks')),
      decision_style: clean(form.get('decision_style')),
      unresolved_questions: clean(form.get('unresolved_questions')),
      evidence: clean(form.get('evidence')),
      what_changed: clean(form.get('what_changed'))
    }
  });
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#household-story`);
}

async function handleCompassSave(request, env, ctx) {
  const auth = await requireHbeProfessional(request, env, ctx);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const form = await request.formData();
  if (!await assertMutationCsrf(request, form.get('csrf'), jwt)) return forbidden('CSRF rejected.');
  const buyerId = clean(form.get('buyer_id'));
  const caseId = clean(form.get('case_id')) || (buyerId ? await caseIdForBuyer(env, buyerId) : '');
  if (!caseId) return redirect('/hbe');
  await saveCompass(env, {
    caseId,
    actor: { kind: 'hbe', id: auth.professional.email },
    fields: {
      optimizing_for: clean(form.get('optimizing_for')),
      tradeoffs: clean(form.get('tradeoffs')),
      uncertainty: clean(form.get('uncertainty')),
      evidence: clean(form.get('evidence')),
      next_conversation: clean(form.get('next_conversation'))
    }
  });
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#journey-compass`);
}

async function hbeBuyerPreview(request, env, ctx, url) {
  const auth = await requireHbeProfessional(request, env, ctx);
  if (!auth.ok) return auth.response;
  const buyerId = clean(url.searchParams.get('buyer'));
  if (!buyerId) return redirect('/hbe');
  const mode = url.searchParams.get('view') === 'shared' ? 'shared' : 'mine';
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const csrfField = await csrfFieldFor(jwt);
  if (!env.BUYER_DB) {
    return html(dashboardShell({
      title: 'Buyer Dashboard preview',
      banner: previewBanner({ buyerName: 'this household', returnHref: '/hbe' }),
      body: `<p>D1 is not bound in this environment. Preview chrome is in place; persistence lives in schema-issue29.sql.</p>`
    }));
  }
  const buyer = await env.BUYER_DB.prepare('SELECT * FROM buyers WHERE id=?').bind(buyerId).first();
  if (!buyer) return redirect('/hbe');
  const caseId = await caseIdForBuyer(env, buyerId);
  if (caseId) await ensureHouseholdState(env, caseId, { actorId: auth.professional.email });
  const previewActor = { kind: 'buyer', id: buyer.id };
  const bundle = caseId ? await loadHouseholdBundle(env, caseId, previewActor) : emptyBundle(buyer);
  const others = bundle.members.filter(m => m.id !== buyer.id);
  const actor = { kind: 'buyer', id: buyer.id, private_context: mode === 'mine' ? privateFor(bundle, buyer.id) : '' };
  const hired = await isHired(env, caseId);
  const currentStage = buyer.stage;
  const selectedStage = validStageId(url.searchParams.get('stage')) || currentStage;
  const compensationHtml = hired ? compensationPostHireHtml(await compensationSummary(env, caseId)) : compensationPublicHtml();
  const memberNav = previewMemberNav({
    members: bundle.members,
    currentBuyerId: buyer.id,
    mode,
    householdBuyerId: buyer.id
  });
  const body = buyerDashboardBody({
    buyer, bundle, actor, mode, hired,
    currentStage,
    selectedStage,
    checklistAction: '/api/hbe/checklist/toggle',
    hiddenFields: `<input type="hidden" name="buyer_id" value="${esc(buyer.id)}"><input type="hidden" name="case_id" value="${esc(caseId||'')}"><input type="hidden" name="view" value="${esc(mode)}">`,
    csrfField,
    compensationHtml,
    others,
    members: bundle.members,
    modeNavHtml: memberNav,
    forcePrivateReadOnly: true,
    mineHref: `/hbe/preview?buyer=${encodeURIComponent(buyerId)}&view=mine`,
    sharedHref: `/hbe/preview?buyer=${encodeURIComponent(buyerId)}&view=shared`,
    compassEditable: false,
    stageHrefFor: id => `/hbe/preview?buyer=${encodeURIComponent(buyerId)}&view=${encodeURIComponent(mode)}&stage=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}`
  });
  return html(dashboardShell({
    title: `Preview · ${buyer.first_name} ${buyer.last_name}`,
    banner: previewBanner({ buyerName: `${buyer.first_name} ${buyer.last_name}`, returnHref: `/hbe?buyer=${encodeURIComponent(buyerId)}` }),
    body
  }));
}

async function enhanceHbeDashboard(request, env, url, text) {
  const selectedId = clean(url.searchParams.get('buyer'));
  if (!env.BUYER_DB) {
    return injectBeforeMainEnd(text, `<section class="i29-comp"><p>Issue 29 persistence schema is ready; D1 is not bound here.</p></section>`);
  }

  const memberRows = await env.BUYER_DB.prepare(`
    SELECT m.case_id,b.id,b.first_name,b.last_name,b.email,b.stage,b.submitted_at
    FROM buyers b LEFT JOIN buyer_case_members m ON m.buyer_id=b.id
    ORDER BY b.submitted_at DESC`).all();
  const households = groupHouseholds(memberRows.results || []);
  const cards = households.map(h => splitHouseholdCard({
    householdName: h.name,
    members: h.members,
    stage: h.stage,
    selected: h.members.some(m => m.id === selectedId),
    hbeHref: `/hbe?buyer=${encodeURIComponent(h.primaryId)}`,
    buyerHref: `/hbe/preview?buyer=${encodeURIComponent(h.primaryId)}`
  })).join('');

  if (text.includes('class="buyer-strip"')) {
    text = text.replace(/<section class="buyer-strip"[\s\S]*?<\/section>/, `<section class="buyer-strip" aria-label="Active households">${cards || '<div class="empty">No submitted buyers yet.</div>'}</section>`);
  } else {
    text = injectBeforeMainEnd(text, `<section class="buyer-strip">${cards}</section>`);
  }

  const buyerId = selectedId || households[0]?.primaryId;
  if (!buyerId) return text.replace('No tasks yet.', 'Review the current-stage checklist and keep the household story current.');

  const caseId = await caseIdForBuyer(env, buyerId);
  if (caseId) await ensureHouseholdState(env, caseId, { actorId: 'hbe' });
  const bundle = caseId ? await loadHouseholdBundle(env, caseId, { kind: 'hbe', id: 'hbe' }) : emptyBundle();
  const buyer = bundle.members.find(m => m.id === buyerId) || { id: buyerId, stage: 'consultation', first_name: '', last_name: '' };
  const actor = { kind: 'hbe', id: 'hbe' };
  const hired = await isHired(env, caseId);
  const currentStage = buyer.stage || 'consultation';
  const selectedStage = validStageId(url.searchParams.get('stage')) || currentStage;
  const completed = STAGES.slice(0, Math.max(0, STAGES.findIndex(s => s[0] === currentStage))).map(s => s[0]);
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const csrfField = await csrfFieldFor(jwt);
  const ids = `<input type="hidden" name="buyer_id" value="${esc(buyerId)}"><input type="hidden" name="case_id" value="${esc(caseId||'')}">`;

  const panel = `
    ${stageMapHtml({
      currentStage,
      selectedStage,
      completed,
      actor,
      hrefFor: id => `/hbe?buyer=${encodeURIComponent(buyerId)}&stage=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}`
    })}
    ${whatsNextPanel({ stage: currentStage, checklistItems: bundle.items, completions: bundle.completions, tasks: bundle.tasks, actor })}
    ${storyPanel({ ...bundle.story, case_id: caseId, selected_buyer_id: buyerId }, { mode: 'hbe', actor, csrfField })}
    ${compassPanel(bundle.compass, { editable: true, hiddenFields: ids, csrfField })}
    ${checklistPanel({
      stageId: selectedStage,
      items: bundle.items,
      completions: bundle.completions,
      actor,
      action: '/api/hbe/checklist/toggle',
      hiddenFields: ids,
      csrfField,
      members: bundle.members
    })}
    ${hired ? compensationPostHireHtml(await compensationSummary(env, caseId)) : compensationPublicHtml()}
    ${ISSUE29_JS}`;

  text = text.replace('No tasks yet.', 'What’s Next is never empty — see the dedicated panel.');
  text = injectBeforeMainEnd(text, panel);
  return text;
}

async function enhanceBuyerPortal(request, env, url, text) {
  const auth = await getBuyerSession(request, env);
  if (!auth) return text;
  const mode = url.searchParams.get('view') === 'shared' ? 'shared' : 'mine';
  const sessionToken = getCookie(request, 'hbe_session');
  const csrfField = await csrfFieldFor(sessionToken);
  if (!env.BUYER_DB) {
    return injectBeforeMainEnd(text, buyerDashboardBody({
      buyer: auth.buyer,
      bundle: emptyBundle(auth.buyer),
      actor: { kind: 'buyer', id: auth.buyer.id },
      mode,
      currentStage: auth.buyer.stage || 'consultation',
      selectedStage: validStageId(url.searchParams.get('stage')) || auth.buyer.stage || 'consultation',
      checklistAction: '/api/portal/checklist/toggle',
      hiddenFields: `<input type="hidden" name="view" value="${esc(mode)}">`,
      csrfField,
      compensationHtml: compensationPublicHtml(),
      others: [],
      mineHref: '/portal?view=mine',
      sharedHref: '/portal?view=shared',
      stageHrefFor: id => `/portal?view=${mode}&stage=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}`
    }));
  }
  const caseId = await caseIdForBuyer(env, auth.buyer.id);
  if (caseId) await ensureHouseholdState(env, caseId, { actorId: auth.buyer.id });
  const bundle = caseId ? await loadHouseholdBundle(env, caseId, { kind: 'buyer', id: auth.buyer.id }) : emptyBundle(auth.buyer);
  const others = bundle.members.filter(m => m.id !== auth.buyer.id);
  const actor = { kind: 'buyer', id: auth.buyer.id, private_context: mode === 'mine' ? privateFor(bundle, auth.buyer.id) : '' };
  const currentStage = auth.buyer.stage || 'consultation';
  const selectedStage = validStageId(url.searchParams.get('stage')) || currentStage;
  const hired = await isHired(env, caseId);
  const compensationHtml = hired ? compensationPostHireHtml(await compensationSummary(env, caseId)) : compensationPublicHtml();

  const map = stageMapHtml({
    currentStage,
    selectedStage,
    completed: STAGES.slice(0, Math.max(0, STAGES.findIndex(s => s[0] === currentStage))).map(s => s[0]),
    actor,
    hrefFor: id => `/portal?view=${mode}&stage=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}`
  });
  const panel = buyerDashboardBody({
    buyer: auth.buyer,
    bundle,
    actor,
    mode,
    currentStage,
    selectedStage,
    checklistAction: '/api/portal/checklist/toggle',
    hiddenFields: `<input type="hidden" name="view" value="${esc(mode)}">`,
    csrfField,
    compensationHtml,
    others,
    mineHref: '/portal?view=mine',
    sharedHref: '/portal?view=shared',
    stageHrefFor: id => `/portal?view=${mode}&stage=${encodeURIComponent(id)}#stage-${encodeURIComponent(id)}`
  }) + ISSUE29_JS;

  text = text.replace(/<div class="map"[\s\S]*?<\/div>/, map);
  if (text.includes('class="buyer-view-tabs"')) {
    text = text.replace(/<div class="buyer-view-tabs">[\s\S]*?<\/div>/, '');
  }
  text = injectBeforeMainEnd(text, panel);
  return text;
}

function enhancePublic(text, pathname) {
  if (pathname === '/') {
    const map = stageMapHtml({ currentStage: 'buyerExperience', completed: [], actor: { kind: 'buyer' }, hrefFor: id => `/#stage-${id}` });
    if (text.includes('class="map"')) text = text.replace(/<div class="map"[\s\S]*?<\/div>/, map);
    text = injectBeforeMainEnd(text, compensationPublicHtml() + ISSUE29_JS);
  }
  if (pathname === '/questionnaire' || pathname === '/login') {
    text = injectBeforeMainEnd(text, compensationPublicHtml());
  }
  return text;
}

function isThankYouPage(text) {
  return /Buyer Experience submitted|Thanks, |Your cross-device access code/i.test(text) && /Submitted to HBE/i.test(text);
}

function rewriteThankYou(text) {
  const name = (text.match(/Thanks, ([^.<]+)/) || [])[1];
  const code = (text.match(/<strong>([A-Z0-9-]{7,})<\/strong>/) || [])[1];
  if (!name || !code) return null;
  const remembered = /remembered for up to 30 days/i.test(text);
  return thankYouHtml({ first: name.trim(), accessCode: code, remembered });
}

function groupHouseholds(rows) {
  const byCase = new Map();
  const singles = [];
  for (const row of rows) {
    if (!row.case_id) {
      singles.push({ name: `${row.first_name} ${row.last_name}`, members: [row], stage: row.stage, primaryId: row.id });
      continue;
    }
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(row);
  }
  const grouped = [...byCase.values()].map(members => ({
    name: members.map(m => `${m.first_name} ${m.last_name}`).join(' & '),
    members,
    stage: members[0].stage,
    primaryId: members[0].id
  }));
  return [...grouped, ...singles];
}

function privateFor(bundle, buyerId) {
  const row = (bundle.privateContexts || []).find(p => p.buyer_id === buyerId);
  if (!row) return '';
  try {
    const parsed = JSON.parse(row.context_json || '{}');
    return parsed.voice || parsed.note || '';
  } catch {
    return '';
  }
}

async function isHired(env, caseId) {
  if (!caseId) return false;
  const row = await env.BUYER_DB.prepare('SELECT agreement_status FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first();
  return row?.agreement_status === 'signed';
}

async function compensationSummary(env, caseId) {
  if (!caseId) return '';
  const row = await env.BUYER_DB.prepare('SELECT compensation_summary FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first();
  return row?.compensation_summary || '';
}

function emptyBundle(buyer) {
  const items = [];
  let order = 0;
  for (const [stageId] of STAGES) {
    for (const spec of STAGE_CHECKLISTS[stageId] || []) {
      order += 1;
      items.push({ id: spec.key, case_id: '', stage_id: stageId, item_key: spec.key, title: spec.title, visibility: spec.visibility, sort_order: order, creates_action_title: spec.creates?.title || null });
    }
  }
  return { items, completions: [], tasks: [], story: {}, compass: {}, audit: [], members: buyer ? [buyer] : [], permissions: [], privateContexts: [] };
}

async function getBuyerSession(request, env) {
  if (!env?.BUYER_DB) return null;
  const token = getCookie(request, 'hbe_session');
  if (!token) return null;
  const now = new Date().toISOString();
  const row = await env.BUYER_DB.prepare(`SELECT s.id AS session_id,s.buyer_id,s.expires_at,b.*
    FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token), now).first();
  if (!row) return null;
  return { session: { id: row.session_id, buyer_id: row.buyer_id }, buyer: row };
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? `${text.slice(0, i)}${panel}${text.slice(i)}` : text.replace('</body>', `${panel}</body>`);
}

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function clean(v) { return String(v ?? '').trim().slice(0, 10000); }
async function sha256(value) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
function forbidden(message = 'HBE access required.') {
  return new Response(message, { status: 403, headers: securityHeaders('text/plain; charset=utf-8') });
}
function unavailable() {
  return new Response('Buyer database is not bound in this environment.', { status: 503, headers: securityHeaders('text/plain; charset=utf-8') });
}
function redirect(location) {
  const headers = securityHeaders('text/plain; charset=utf-8');
  headers.set('location', location);
  return new Response(null, { status: 303, headers });
}
function html(body, status = 200) {
  return new Response(body, { status, headers: securityHeaders('text/html; charset=utf-8') });
}
function json(v) {
  return new Response(JSON.stringify(v), { status: 200, headers: securityHeaders('application/json') });
}
function securityHeaders(type) {
  return new Headers({
    'content-type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
}
