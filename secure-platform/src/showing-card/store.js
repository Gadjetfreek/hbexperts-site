import { answerableFields, BRIGHAM_SEED, DOSSIER_VERSION } from './dossier-schema.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Ensure synthetic Steinberger case + Brigham property exist (IDs only).
 * Safe to call repeatedly. Does not write answers/notes/photos.
 */
export async function ensureSteinbergerSeed(env) {
  if (!env?.BUYER_DB) return null;
  const db = env.BUYER_DB;
  const t = nowIso();
  const s = BRIGHAM_SEED;

  await db.prepare(
    `INSERT OR IGNORE INTO buyer_cases (id, created_at, updated_at, stage, completed_stages, status)
     VALUES (?, ?, ?, 'possibilities', '[]', 'active')`
  ).bind(s.caseId, t, t).run();

  await db.prepare(
    `INSERT OR IGNORE INTO buyers
      (id, created_at, submitted_at, updated_at, first_name, last_name, email, phone, stage, completed_stages, answers_json, access_code_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', 'possibilities', '["buyerExperience","consultation","representation","search","market"]', '{}', 'seed-not-for-login')`
  ).bind(s.buyerId, t, t, t, s.firstName, s.lastName, s.buyerEmail).run();

  await db.prepare(
    `INSERT OR IGNORE INTO buyer_case_members (case_id, buyer_id, role, created_at)
     VALUES (?, ?, 'buyer', ?)`
  ).bind(s.caseId, s.buyerId, t).run();

  await db.prepare(
    `INSERT OR IGNORE INTO showing_properties
      (id, case_id, address, city, state, zip, mls, ask_price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(s.propertyId, s.caseId, s.address, s.city, s.state, s.zip, s.mls, s.askPrice, 'active', t, t).run();

  return s;
}

export async function listPropertiesForCase(env, caseId) {
  if (!env?.BUYER_DB || !caseId) return [];
  const { results } = await env.BUYER_DB.prepare(
    `SELECT * FROM showing_properties WHERE case_id=? AND status='active' ORDER BY updated_at DESC`
  ).bind(caseId).all();
  return results || [];
}

export async function getProperty(env, propertyId) {
  if (!env?.BUYER_DB || !propertyId) return null;
  return env.BUYER_DB.prepare(`SELECT * FROM showing_properties WHERE id=?`).bind(propertyId).first();
}

export async function caseIdForProperty(env, propertyId) {
  const row = await getProperty(env, propertyId);
  return row?.case_id || '';
}

export async function assertPropertyInCase(env, propertyId, caseId) {
  const row = await getProperty(env, propertyId);
  if (!row) return false;
  return row.case_id === caseId;
}

export async function loadAnswers(env, propertyId) {
  if (!env?.BUYER_DB || !propertyId) return {};
  const { results } = await env.BUYER_DB.prepare(
    `SELECT field_id, value_json, updated_at, updated_by FROM showing_answers WHERE property_id=?`
  ).bind(propertyId).all();
  const map = {};
  for (const row of results || []) {
    try {
      map[row.field_id] = { value: JSON.parse(row.value_json), updated_at: row.updated_at, updated_by: row.updated_by };
    } catch {
      map[row.field_id] = { value: null, updated_at: row.updated_at, updated_by: row.updated_by };
    }
  }
  return map;
}

export async function saveAnswer(env, { propertyId, fieldId, value, actorEmail, visitId = null }) {
  if (!env?.BUYER_DB) throw new Error('BUYER_DB missing');
  const answerable = answerableFields().some(f => f.id === fieldId);
  if (!answerable) throw new Error('Unknown or read-only field');
  const t = nowIso();
  const id = randomId('ans');
  const valueJson = JSON.stringify(value === undefined ? null : value);
  await env.BUYER_DB.prepare(
    `INSERT INTO showing_answers (id, property_id, visit_id, field_id, value_json, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(property_id, field_id) DO UPDATE SET
       value_json=excluded.value_json,
       visit_id=COALESCE(excluded.visit_id, showing_answers.visit_id),
       updated_at=excluded.updated_at,
       updated_by=excluded.updated_by`
  ).bind(id, propertyId, visitId, fieldId, valueJson, t, actorEmail || '').run();
  await env.BUYER_DB.prepare(
    `UPDATE showing_properties SET updated_at=? WHERE id=?`
  ).bind(t, propertyId).run();
  return { fieldId, updated_at: t };
}

export async function loadObservations(env, propertyId) {
  if (!env?.BUYER_DB || !propertyId) return [];
  const { results } = await env.BUYER_DB.prepare(
    `SELECT id, section_id, body, created_at, created_by FROM showing_observations
     WHERE property_id=? ORDER BY created_at DESC`
  ).bind(propertyId).all();
  return results || [];
}

export async function addObservation(env, { propertyId, sectionId, body, actorEmail }) {
  if (!env?.BUYER_DB) throw new Error('BUYER_DB missing');
  const text = String(body || '').trim().slice(0, 8000);
  if (!text) throw new Error('Empty observation');
  const id = randomId('obs');
  const t = nowIso();
  await env.BUYER_DB.prepare(
    `INSERT INTO showing_observations (id, property_id, section_id, body, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, propertyId, sectionId, text, t, actorEmail || '').run();
  return { id, section_id: sectionId, body: text, created_at: t };
}

export async function loadPhotos(env, propertyId) {
  if (!env?.BUYER_DB || !propertyId) return [];
  const { results } = await env.BUYER_DB.prepare(
    `SELECT id, field_id, r2_key, content_type, bytes, created_at, created_by
     FROM showing_photos WHERE property_id=? ORDER BY created_at DESC`
  ).bind(propertyId).all();
  return results || [];
}

export async function getPhotoMeta(env, photoId) {
  if (!env?.BUYER_DB || !photoId) return null;
  return env.BUYER_DB.prepare(`SELECT * FROM showing_photos WHERE id=?`).bind(photoId).first();
}

export function r2Available(env) {
  return Boolean(env?.SHOWING_PHOTOS);
}

export function validatePhotoUpload({ contentType, bytes }) {
  if (!ALLOWED_MIME.has(String(contentType || '').toLowerCase())) {
    return { ok: false, error: 'Unsupported image type. Use JPEG, PNG, WebP, or HEIC.' };
  }
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_PHOTO_BYTES) {
    return { ok: false, error: `Image must be between 1 byte and ${MAX_PHOTO_BYTES} bytes.` };
  }
  return { ok: true };
}

/**
 * Store photo in private R2 + D1 metadata. Fails closed if R2 unbound.
 */
export async function storePhoto(env, { propertyId, fieldId, contentType, bytes, body, actorEmail }) {
  if (!r2Available(env)) {
    const err = new Error('R2 binding SHOWING_PHOTOS is not configured');
    err.code = 'R2_UNAVAILABLE';
    throw err;
  }
  const check = validatePhotoUpload({ contentType, bytes });
  if (!check.ok) {
    const err = new Error(check.error);
    err.code = 'INVALID_PHOTO';
    throw err;
  }
  const id = randomId('photo');
  const t = nowIso();
  const key = `showing/${propertyId}/${id}`;
  await env.SHOWING_PHOTOS.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { propertyId, fieldId: fieldId || '', createdBy: actorEmail || '' }
  });
  await env.BUYER_DB.prepare(
    `INSERT INTO showing_photos (id, property_id, field_id, r2_key, content_type, bytes, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, propertyId, fieldId || null, key, contentType, bytes, t, actorEmail || '').run();
  return { id, r2_key: key, content_type: contentType, bytes, created_at: t };
}

export async function readPhotoObject(env, photoMeta) {
  if (!r2Available(env)) {
    const err = new Error('R2 binding SHOWING_PHOTOS is not configured');
    err.code = 'R2_UNAVAILABLE';
    throw err;
  }
  const obj = await env.SHOWING_PHOTOS.get(photoMeta.r2_key);
  if (!obj) return null;
  return obj;
}

export function computeProgress(answers) {
  const fields = answerableFields();
  let filled = 0;
  for (const field of fields) {
    const entry = answers[field.id];
    if (!entry) continue;
    const v = entry.value;
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    filled += 1;
  }
  const total = fields.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  let status = 'not_started';
  if (filled > 0 && pct < 100) status = 'in_progress';
  if (pct === 100) status = 'complete';
  return { filled, total, pct, status, dossierVersion: DOSSIER_VERSION };
}

export { MAX_PHOTO_BYTES, ALLOWED_MIME };
