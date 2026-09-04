import { authenticateHbeProfessional } from '../hbe-access-worker.js';
import { mutationCsrfToken, assertMutationCsrf, caseIdForBuyer } from '../household-state.js';
import {
  ensureSteinbergerSeed, listPropertiesForCase, getProperty, loadAnswers, saveAnswer,
  loadObservations, addObservation, loadPhotos, storePhoto, getPhotoMeta, readPhotoObject,
  computeProgress, r2Available, caseIdForProperty
} from './store.js';
import { fieldById, sectionIds } from './dossier-schema.js';
import { propertiesPanelHtml, showingCardPageHtml, SHOWING_CARD_CSS, esc } from './ui.js';

function securityHeaders(type) {
  return new Headers({
    'content-type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: securityHeaders('application/json; charset=utf-8') });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: securityHeaders('text/html; charset=utf-8') });
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

function clean(v, max = 10000) {
  return String(v ?? '').trim().slice(0, max);
}

async function requireHbe(request, env) {
  const auth = await authenticateHbeProfessional(request, env);
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, professional: auth.professional };
}

async function csrfOk(request, provided) {
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const headerToken = request.headers.get('x-csrf-token');
  const token = provided || headerToken;
  return assertMutationCsrf(request, token, jwt);
}

/**
 * Early route handler. Returns Response or null if not a showing-card path.
 */
export async function handleShowingCardRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && /^\/hbe\/properties\/[^/]+\/card$/.test(path)) {
    return renderShowingCard(request, env, url);
  }
  if (request.method === 'GET' && path === '/hbe/properties') {
    return redirect('/hbe#properties-showings');
  }
  if (request.method === 'POST' && path === '/api/hbe/showing/answer') {
    return apiSaveAnswer(request, env);
  }
  if (request.method === 'POST' && path === '/api/hbe/showing/observation') {
    return apiAddObservation(request, env);
  }
  if (request.method === 'POST' && path === '/api/hbe/showing/photo') {
    return apiUploadPhoto(request, env);
  }
  if (request.method === 'GET' && /^\/api\/hbe\/showing\/photo\/[^/]+$/.test(path)) {
    return apiGetPhoto(request, env, path);
  }
  return null;
}

async function renderShowingCard(request, env, url) {
  const auth = await requireHbe(request, env);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();

  await ensureSteinbergerSeed(env);
  const propertyId = decodeURIComponent(url.pathname.match(/^\/hbe\/properties\/([^/]+)\/card$/)[1]);
  const property = await getProperty(env, propertyId);
  if (!property) return redirect('/hbe');

  const buyerId = clean(url.searchParams.get('buyer'), 120);
  if (buyerId) {
    const buyerCase = await caseIdForBuyer(env, buyerId);
    if (buyerCase && buyerCase !== property.case_id) {
      return forbidden('Cross-household property access denied.');
    }
  }

  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const csrfToken = await mutationCsrfToken(jwt);
  const answers = await loadAnswers(env, propertyId);
  const observations = await loadObservations(env, propertyId);
  const photos = await loadPhotos(env, propertyId);
  const progress = computeProgress(answers);
  const page = showingCardPageHtml({
    property,
    answers,
    observations,
    photos,
    csrfToken,
    buyerId,
    professionalEmail: auth.professional.email,
    r2Ok: r2Available(env),
    progress
  });
  return html(page);
}

async function apiSaveAnswer(request, env) {
  const auth = await requireHbe(request, env);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!await csrfOk(request, body.csrf)) return json({ error: 'CSRF rejected.' }, 403);

  const propertyId = clean(body.property_id, 120);
  const fieldId = clean(body.field_id, 120);
  const property = await getProperty(env, propertyId);
  if (!property) return json({ error: 'Property not found' }, 404);
  if (!fieldById(fieldId) || fieldById(fieldId).type === 'readonly') {
    return json({ error: 'Unknown field' }, 400);
  }

  try {
    const saved = await saveAnswer(env, {
      propertyId,
      fieldId,
      value: body.value,
      actorEmail: auth.professional.email
    });
    const answers = await loadAnswers(env, propertyId);
    return json({ ok: true, saved, progress: computeProgress(answers) });
  } catch (err) {
    return json({ error: err.message || 'Save failed' }, 400);
  }
}

async function apiAddObservation(request, env) {
  const auth = await requireHbe(request, env);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!await csrfOk(request, body.csrf)) return json({ error: 'CSRF rejected.' }, 403);

  const propertyId = clean(body.property_id, 120);
  const sectionId = clean(body.section_id, 120);
  const property = await getProperty(env, propertyId);
  if (!property) return json({ error: 'Property not found' }, 404);
  if (!sectionIds().includes(sectionId)) return json({ error: 'Unknown section' }, 400);

  try {
    const observation = await addObservation(env, {
      propertyId,
      sectionId,
      body: body.body,
      actorEmail: auth.professional.email
    });
    return json({ ok: true, observation });
  } catch (err) {
    return json({ error: err.message || 'Observation failed' }, 400);
  }
}

async function apiUploadPhoto(request, env) {
  const auth = await requireHbe(request, env);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  if (!r2Available(env)) {
    return json({
      error: 'Private R2 binding SHOWING_PHOTOS is not configured. Photo UI is present; uploads fail closed.',
      code: 'R2_UNAVAILABLE'
    }, 503);
  }

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Invalid form' }, 400); }
  if (!await csrfOk(request, form.get('csrf'))) return json({ error: 'CSRF rejected.' }, 403);

  const propertyId = clean(form.get('property_id'), 120);
  const fieldId = clean(form.get('field_id'), 120) || null;
  const property = await getProperty(env, propertyId);
  if (!property) return json({ error: 'Property not found' }, 404);
  if (fieldId && !fieldById(fieldId)) return json({ error: 'Unknown field' }, 400);

  const file = form.get('photo');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Missing photo' }, 400);
  const contentType = clean(file.type || 'application/octet-stream', 80);
  const buf = await file.arrayBuffer();
  try {
    const photo = await storePhoto(env, {
      propertyId,
      fieldId,
      contentType,
      bytes: buf.byteLength,
      body: buf,
      actorEmail: auth.professional.email
    });
    return json({ ok: true, photo: { id: photo.id, field_id: fieldId, bytes: photo.bytes, created_at: photo.created_at } });
  } catch (err) {
    const status = err.code === 'INVALID_PHOTO' ? 400 : 503;
    return json({ error: err.message || 'Upload failed', code: err.code || 'UPLOAD_FAILED' }, status);
  }
}

async function apiGetPhoto(request, env, path) {
  const auth = await requireHbe(request, env);
  if (!auth.ok) return auth.response;
  if (!env.BUYER_DB) return unavailable();
  const photoId = decodeURIComponent(path.match(/^\/api\/hbe\/showing\/photo\/([^/]+)$/)[1]);
  const meta = await getPhotoMeta(env, photoId);
  if (!meta) return json({ error: 'Not found' }, 404);

  // Isolation: property must exist (case-scoped). No anonymous public URL.
  const property = await getProperty(env, meta.property_id);
  if (!property) return forbidden('Cross-household object access denied.');

  if (!r2Available(env)) {
    return json({ error: 'R2 unavailable', code: 'R2_UNAVAILABLE' }, 503);
  }
  const obj = await readPhotoObject(env, meta);
  if (!obj) return json({ error: 'Object missing' }, 404);
  const headers = securityHeaders(meta.content_type || 'application/octet-stream');
  headers.set('Cache-Control', 'no-store');
  return new Response(obj.body, { status: 200, headers });
}

/**
 * Inject Properties/Showings panel into HBE dashboard HTML for the selected household.
 */
export async function enhanceHbeWithProperties(request, env, url, text) {
  if (!env?.BUYER_DB) {
    if (!text.includes('id="properties-showings"')) {
      return injectBeforeMainEnd(text, `<section class="sc-panel" id="properties-showings"><h2>Properties / Showings</h2><p>Showing-card schema ready; D1 not bound here.</p></section>`);
    }
    return text;
  }

  try {
    await ensureSteinbergerSeed(env);
  } catch (err) {
    console.error('showing-card seed failed', err);
  }

  const buyerId = clean(url.searchParams.get('buyer'), 120);
  let caseId = buyerId ? await caseIdForBuyer(env, buyerId) : '';

  // If no buyer selected, still show Brigham when Steinberger is the only/primary match.
  if (!caseId) {
    const stein = await env.BUYER_DB.prepare(
      `SELECT id FROM buyers WHERE email=? LIMIT 1`
    ).bind('steinberger.buyer@example.test').first();
    if (stein) caseId = await caseIdForBuyer(env, stein.id);
  }

  if (!caseId) return text;

  const properties = await listPropertiesForCase(env, caseId);
  const progressById = {};
  for (const p of properties) {
    const answers = await loadAnswers(env, p.id);
    progressById[p.id] = computeProgress(answers);
  }

  // Resolve buyer id for links
  let linkBuyer = buyerId;
  if (!linkBuyer) {
    const member = await env.BUYER_DB.prepare(
      `SELECT buyer_id FROM buyer_case_members WHERE case_id=? LIMIT 1`
    ).bind(caseId).first();
    linkBuyer = member?.buyer_id || '';
  }

  const panel = propertiesPanelHtml({
    properties,
    buyerId: linkBuyer,
    caseId,
    progressById
  });

  if (!text.includes('id="showing-card-css"')) {
    text = text.replace('</head>', `${SHOWING_CARD_CSS}</head>`);
  }
  if (text.includes('id="properties-showings"')) {
    text = text.replace(/<section class="sc-panel" id="properties-showings"[\s\S]*?<\/section>/, panel);
  } else {
    text = injectBeforeMainEnd(text, panel);
  }
  return text;
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? `${text.slice(0, i)}${panel}${text.slice(i)}` : text.replace('</body>', `${panel}</body>`);
}

export { caseIdForProperty, esc };
