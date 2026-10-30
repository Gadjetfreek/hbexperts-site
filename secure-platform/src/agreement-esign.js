// "Open the next chapter": buyer agency agreement + native e-sign (SAMPLE flow).
// - Staff (HBEUI, Cloudflare Access) prepares and sends; broker countersigns.
// - Buyers (BuyerUI, hbe_session) consent to e-records, scroll the full text, initial, sign (typed or drawn)
//   and MUST complete a passkey assertion (user verification required) bound to the document SHA-256.
// - No non-passkey buyer signing path. Devices without passkeys are told to contact HBE for paper signing.
// - Until agreement_templates.approved = 1 (set manually by the owner; NO code path sets it), every document is
//   watermarked "SAMPLE — NOT FOR SIGNATURE" and flagged is_sample = 1.
import { authenticateHbeProfessional, requireVerifiedProfessional } from './hbe-access-worker.js';
import { ownerEmail, vapidConfig, validateSubscription } from './hbe-push.js';
import { sendWebPush } from './web-push.js';
import { assertMutationCsrf, mutationCsrfToken, sameOriginRequest } from './household-state.js';
import { V5_PARAGRAPHS } from './agreement-template-v5.js';
import { buildPdf } from './agreement-pdf.js';
import {
  b64uEncode, sha256Hex, randomChallenge, registrationOptions, assertionOptions,
  verifyRegistration, verifyAssertion, boundChallenge, WEBAUTHN_BROWSER_JS
} from './webauthn.js';

export const TEMPLATE_ID = 'hbe-buyer-agency-v5';
export const TEMPLATE_VERSION = 'v5-draft-2026-10-30';
export const SAMPLE_WATERMARK = 'SAMPLE \u2014 NOT FOR SIGNATURE';
export const ERSD_VERSION = 'ersd-2026-10-30';
const CHALLENGE_MS = 5 * 60 * 1000;
const NO_PASSKEY_MESSAGE = 'This device can\u2019t use Face ID, Touch ID or a passkey. Please contact HomeBuyer Experts and we\u2019ll sign on paper with you in person.';
export const ERSD_TEXT = 'I agree to receive and sign this agreement electronically (Ohio R.C. 1306.06). I can download and keep a copy, ask HomeBuyer Experts for a paper copy at no charge, and withdraw this consent at any time before signing by contacting HomeBuyer Experts, in which case we will sign on paper. I have a device that can open PDF files.';

export const FIELD_DEFS = [
  { key: 'term_end', label: 'Agreement ends (midnight of)', type: 'date', required: true },
  { key: 'price_max', label: 'Purchase price up to ($)', type: 'number', required: true },
  { key: 'retainer_option', label: 'Retainer', type: 'select', required: true, options: [['standard', '$750 at signing'], ['returning_deferred', 'Returning client: $750 deferred to closing']] },
  { key: 'additional_provisions', label: 'Additional provisions (optional)', type: 'textarea', required: false }
];

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEC = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SEC } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...SEC } });
const db = env => env.BUYER_DB;

function getCookie(request, name) {
  for (const p of (request.headers.get('cookie') || '').split(';')) { const [k, ...v] = p.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}
function rp(env, url) { return { rpId: env.WEBAUTHN_RP_ID || url.hostname, origin: env.WEBAUTHN_ORIGIN || url.origin, rpName: 'HomeBuyer Experts' }; }

// ---------------- template + rendering ----------------
export async function templateBodySha() { return sha256Hex(V5_PARAGRAPHS.join('\n')); }
export async function ensureTemplate(env) {
  await db(env).prepare(`INSERT OR IGNORE INTO agreement_templates (id,name,version,body_sha256,approved,created_at) VALUES (?,?,?,?,0,?)`)
    .bind(TEMPLATE_ID, 'Exclusive Buyer\u2019s Agency Agreement', TEMPLATE_VERSION, await templateBodySha(), nowIso()).run();
  return db(env).prepare(`SELECT * FROM agreement_templates WHERE id=?`).bind(TEMPLATE_ID).first();
}
// Read-only. Approval is a manual owner action after counsel review; there is deliberately no setter.
export async function templateApproved(env) {
  const t = await db(env).prepare(`SELECT approved, body_sha256 FROM agreement_templates WHERE id=?`).bind(TEMPLATE_ID).first();
  return !!(t && Number(t.approved) === 1 && t.body_sha256 === await templateBodySha());
}

export function validateFields(input) {
  const out = {}; const errors = [];
  for (const f of FIELD_DEFS) {
    let v = String(input?.[f.key] ?? '').trim();
    if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(f.key);
    if (f.type === 'number' && v) { v = v.replace(/[$,\s]/g, ''); if (!/^\d{4,9}$/.test(v)) errors.push(f.key); }
    if (f.type === 'select' && v && !f.options.some(o => o[0] === v)) errors.push(f.key);
    if (f.type === 'textarea') v = v.slice(0, 2000);
    if (f.required && !v) errors.push(f.key);
    out[f.key] = v;
  }
  if (out.term_end && out.term_end <= new Date().toISOString().slice(0, 10)) errors.push('term_end');
  return { fields: out, errors: [...new Set(errors)] };
}

function fmtDate(d) { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch { return d; } }
export function renderParagraphs(fields) {
  const money = n => '$' + Number(n).toLocaleString('en-US');
  return V5_PARAGRAPHS.map(p => p
    .replace('{{term_end}}', fields.term_end ? fmtDate(fields.term_end) : '________')
    .replace('{{price_max}}', fields.price_max ? money(fields.price_max) : '________')
    .replace('{{additional_provisions}}', fields.additional_provisions || 'None.'))
    .concat([`Retainer selected: ${fields.retainer_option === 'returning_deferred' ? 'Returning client \u2014 $750 deferred to closing.' : '$750 due at signing.'}`]);
}
export async function documentSha(instance, fields, signerNames) {
  return sha256Hex(JSON.stringify({ t: instance.template_id, v: instance.template_version, sample: Number(instance.is_sample), id: instance.id, signers: signerNames, text: renderParagraphs(fields) }));
}

async function loadInstance(env, id) {
  const inst = await db(env).prepare(`SELECT * FROM agreement_instances WHERE id=?`).bind(id).first();
  if (!inst) return null;
  const fr = (await db(env).prepare(`SELECT field_key, field_value FROM agreement_fields WHERE instance_id=?`).bind(id).all()).results || [];
  const fields = Object.fromEntries(fr.map(r => [r.field_key, r.field_value]));
  const signers = (await db(env).prepare(`SELECT s.*, b.first_name, b.last_name FROM agreement_signers s LEFT JOIN buyers b ON b.id=s.buyer_id WHERE s.instance_id=? ORDER BY s.order_idx`).bind(id).all()).results || [];
  return { inst, fields, signers };
}
const signerName = s => s.role === 'broker' ? 'Broker, HomeBuyer Experts, LLC' : `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Buyer';

// ---------------- audit (hash-chained) ----------------
export async function addEvent(env, instanceId, event, { signerId = null, actor = null, request = null, docSha = null, detail = null } = {}) {
  const prev = await db(env).prepare(`SELECT event_hash FROM agreement_events WHERE instance_id=? ORDER BY at DESC, rowid DESC LIMIT 1`).bind(instanceId).first();
  const at = nowIso(); const id = uid();
  const ip = request?.headers.get('cf-connecting-ip') || null; const ua = (request?.headers.get('user-agent') || '').slice(0, 300) || null;
  const detailJson = detail ? JSON.stringify(detail) : null;
  const eventHash = await sha256Hex([prev?.event_hash || '', id, instanceId, signerId || '', event, at, actor || '', docSha || '', detailJson || ''].join('|'));
  await db(env).prepare(`INSERT INTO agreement_events (id,instance_id,signer_id,event,at,actor,ip,user_agent,doc_sha256,detail_json,prev_hash,event_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, instanceId, signerId, event, at, actor, ip, ua, docSha, detailJson, prev?.event_hash || null, eventHash).run();
  return eventHash;
}
export async function verifyEventChain(env, instanceId) {
  const rows = (await db(env).prepare(`SELECT * FROM agreement_events WHERE instance_id=? ORDER BY at, rowid`).bind(instanceId).all()).results || [];
  let prev = '';
  for (const r of rows) {
    const h = await sha256Hex([prev, r.id, r.instance_id, r.signer_id || '', r.event, r.at, r.actor || '', r.doc_sha256 || '', r.detail_json || ''].join('|'));
    if (h !== r.event_hash || (r.prev_hash || '') !== prev) return false;
    prev = r.event_hash;
  }
  return true;
}

// ---------------- WebAuthn challenges ----------------
async function newChallenge(env, purpose, ownerKind, ownerId, bound = null, challenge = randomChallenge()) {
  const id = uid();
  await db(env).prepare(`INSERT INTO webauthn_challenges (id,purpose,owner_kind,owner_id,bound_sha256,challenge,expires_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, purpose, ownerKind, ownerId, bound, challenge, new Date(Date.now() + CHALLENGE_MS).toISOString()).run();
  return { id, challenge };
}
async function takeChallenge(env, id, purpose, ownerKind, ownerId) {
  const res = await db(env).prepare(`UPDATE webauthn_challenges SET used_at=? WHERE id=? AND purpose=? AND used_at IS NULL AND expires_at>? AND (owner_kind IS ? ) AND (owner_id IS ?)`)
    .bind(nowIso(), id, purpose, nowIso(), ownerKind, ownerId).run();
  if (!res?.meta?.changes) return null;
  return db(env).prepare(`SELECT * FROM webauthn_challenges WHERE id=?`).bind(id).first();
}
async function credentialsFor(env, kind, ownerId) {
  return (await db(env).prepare(`SELECT * FROM passkey_credentials WHERE owner_kind=? AND owner_id=? AND revoked_at IS NULL`).bind(kind, ownerId).all()).results || [];
}
async function saveCredential(env, kind, ownerId, reg, userHandle, label) {
  await db(env).prepare(`INSERT INTO passkey_credentials (id,owner_kind,owner_id,credential_id,public_key_jwk,alg,sign_count,user_handle,device_label,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(uid(), kind, ownerId, reg.credentialId, JSON.stringify(reg.jwk), reg.alg, reg.signCount, userHandle, String(label || '').slice(0, 60) || null, nowIso()).run();
}
async function useCredential(env, cred, response, challenge, ctx) {
  const r = await verifyAssertion({ response, expectedChallenge: challenge, origin: ctx.origin, rpId: ctx.rpId, credential: cred });
  await db(env).prepare(`UPDATE passkey_credentials SET sign_count=?, last_used_at=? WHERE id=?`).bind(r.signCount, nowIso(), cred.id).run();
  return r;
}
async function userHandleFor(kind, ownerId, env) { return b64uEncode(new TextEncoder().encode((await sha256Hex(`hbe-uh|${kind}|${ownerId}|${env.WEBAUTHN_USER_SALT || 'hbe'}`)).slice(0, 32))); }

// ---------------- buyer session ----------------
export async function buyerSession(request, env) {
  const token = getCookie(request, 'hbe_session'); if (!token) return null;
  const row = await db(env).prepare(`SELECT s.id AS session_id, b.id AS buyer_id, b.first_name, b.last_name, b.email, b.stage FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`)
    .bind(await sha256Hex(token), nowIso()).first();
  return row ? { ...row, token } : null;
}
async function createSession(env, buyerId) {
  const raw = crypto.getRandomValues(new Uint8Array(32)); const token = b64uEncode(raw); const now = new Date();
  await db(env).prepare(`INSERT INTO buyer_sessions (id,buyer_id,token_hash,created_at,last_seen_at,expires_at,remembered) VALUES (?,?,?,?,?,?,0)`)
    .bind(uid(), buyerId, await sha256Hex(token), now.toISOString(), now.toISOString(), new Date(now.getTime() + 12 * 3600000).toISOString()).run();
  return `hbe_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
async function readJson(request) { try { return await request.json(); } catch { return {}; } }

// ---------------- push (no personal details in payloads) ----------------
export const BUYER_PUSH_PAYLOAD = { title: 'HomeBuyer Experts', body: 'Something to review and sign', url: '/portal/agreements', tag: 'hbe-agreement' };
export const STAFF_PUSH_PAYLOAD = { title: 'HBE', body: 'An agreement has a new signature', url: '/hbe/app', tag: 'hbe-agreement-signed' };
async function pushTo(env, subs, payload, send) {
  const vapid = vapidConfig(env); if (!vapid || !subs.length) return 0;
  let ok = 0;
  for (const s of subs) { try { const r = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid); if (r.ok) ok++; } catch { /* fallback is the banner */ } }
  return ok;
}
export async function notifyBuyers(env, buyerIds, send = sendWebPush) {
  if (!buyerIds.length) return 0;
  const subs = (await db(env).prepare(`SELECT * FROM buyer_push_subscriptions WHERE revoked_at IS NULL AND buyer_id IN (${buyerIds.map(() => '?').join(',')})`).bind(...buyerIds).all()).results || [];
  return pushTo(env, subs, BUYER_PUSH_PAYLOAD, send);
}
async function notifyOwner(env, send = sendWebPush) {
  const subs = (await db(env).prepare(`SELECT endpoint,p256dh,auth FROM hbe_push_subscriptions WHERE staff_email=?`).bind(ownerEmail(env)).all()).results || [];
  return pushTo(env, subs, STAFF_PUSH_PAYLOAD, send);
}

// ---------------- PDF ----------------
export function agreementPdf(bundle, { certificate = null } = {}) {
  const { inst, fields, signers } = bundle;
  const blocks = renderParagraphs(fields).map((t, i) => ({ text: t, bold: i < 2, size: i < 2 ? 12 : 9.5 }));
  for (const s of signers) {
    if (s.signed_at) {
      blocks.push({ signature: { kind: s.signature_kind, text: s.signature_text, strokes: s.signature_strokes ? JSON.parse(s.signature_strokes) : null }, label: `${s.role === 'broker' ? 'BROKER' : 'BUYER'}: ${signerName(s)}${s.initials ? '  (initials ' + s.initials + ')' : ''}` });
      blocks.push({ text: `Signed ${s.signed_at} (UTC)${s.passkey_credential_id ? ' with passkey, user verification required' : ' by Cloudflare Access identity'}`, size: 8 });
    } else blocks.push({ text: `${s.role === 'broker' ? 'BROKER' : 'BUYER'}: ${signerName(s)}  ________________________  Date ________`, gap: 10 });
  }
  if (certificate) {
    blocks.push({ text: 'CERTIFICATE OF COMPLETION', bold: true, size: 12, gap: 6 });
    blocks.push({ text: `Agreement ID ${inst.id}. Template ${inst.template_id} ${inst.template_version}. Document SHA-256 ${inst.doc_sha256}.`, size: 8.5 });
    for (const e of certificate) blocks.push({ text: `${e.at}  ${e.event}${e.signer_label ? '  ' + e.signer_label : ''}${e.doc_sha256 ? '  doc ' + e.doc_sha256.slice(0, 16) + '...' : ''}`, size: 8 });
    blocks.push({ text: 'Each signer consented to electronic records, scrolled the full agreement, and (buyers) completed a device passkey check bound to this document hash. Events are hash-chained.', size: 8 });
  }
  const sample = Number(inst.is_sample) === 1;
  return buildPdf(blocks, { watermark: sample ? SAMPLE_WATERMARK : '', footer: `${sample ? 'SAMPLE \u2014 ' : ''}HBE agreement ${inst.id.slice(0, 8)}` });
}

// ---------------- page shell ----------------
const CSS = `body{font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f7faf8;color:#1a1a2e}main{max-width:46rem;margin:0 auto;padding:1.2rem}h1{font:600 1.7rem Georgia,serif}.card{background:#fff;border:1px solid #dfe8e2;border-radius:14px;padding:1rem 1.2rem;margin:1rem 0}.btn{display:inline-block;background:#2d5a3d;color:#fff;border:0;border-radius:10px;padding:.75rem 1.1rem;font-weight:700;text-decoration:none;cursor:pointer}.btn[disabled]{opacity:.45;cursor:not-allowed}.sample{background:#fff4f4;border:2px dashed #b42318;color:#b42318;font-weight:800;padding:.6rem;border-radius:10px;text-align:center}.doc{max-height:55vh;overflow:auto;border:1px solid #ccc;border-radius:10px;padding:1rem;background:#fff;position:relative}.doc p{margin:.5rem 0}.wm{position:sticky;top:40%;text-align:center;color:rgba(180,35,24,.25);font:800 2rem system-ui;transform:rotate(-20deg);pointer-events:none;height:0}label{display:block;margin:.7rem 0 .2rem;font-weight:650}input,select,textarea{width:100%;padding:.6rem;border:1px solid #bbb;border-radius:8px;font:inherit;box-sizing:border-box}canvas{border:1px solid #888;border-radius:8px;touch-action:none;background:#fff;width:100%;max-width:520px;height:160px}.muted{color:#555;font-size:.92rem}.err{color:#b42318;font-weight:700}`;
const page = (title, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="manifest" href="/portal/app.webmanifest"><style>${CSS}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
const docHtml = (fields, sample) => `<div class="doc" id="doc">${sample ? `<div class="wm">${esc(SAMPLE_WATERMARK)}</div>` : ''}${renderParagraphs(fields).map(p => `<p>${esc(p)}</p>`).join('')}<p id="doc-end" class="muted">\u2014 End of agreement \u2014</p></div>`;

// ---------------- staff (HBEUI) ----------------
async function staffAuth(request, env, opts) {
  const a = await requireVerifiedProfessional(request, env, opts.authenticate || authenticateHbeProfessional);
  return a.ok ? a.professional : { response: a.response };
}
function staffMutationOk(request) { return request.method === 'POST' && sameOriginRequest(request) && (request.headers.get('content-type') || '').includes('application/json'); }

async function staffNewForm(env, url) {
  const buyerId = url.searchParams.get('buyer') || '';
  const b = await db(env).prepare(`SELECT id, first_name, last_name, stage FROM buyers WHERE id=?`).bind(buyerId).first();
  if (!b) return html(page('Not found', '<h1>Buyer not found</h1>'), 404);
  if (b.stage !== 'consultation') return html(page('Not available', `<h1>Not at Consultation</h1><p>The agreement is opened from the Consultation stage.</p>`), 409);
  const approved = await templateApproved(env);
  const f = FIELD_DEFS.map(d => `<label for="${d.key}">${esc(d.label)}</label>` + (d.type === 'select' ? `<select id="${d.key}" name="${d.key}">${d.options.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select>` : d.type === 'textarea' ? `<textarea id="${d.key}" name="${d.key}" rows="3"></textarea>` : `<input id="${d.key}" name="${d.key}" type="${d.type}" ${d.required ? 'required' : ''}>`)).join('');
  const body = `<h1>Open the next chapter</h1><p>Exclusive Buyer\u2019s Agency Agreement for <strong>${esc(b.first_name)} ${esc(b.last_name)}</strong>.</p>${approved ? '' : `<div class="sample">${esc(SAMPLE_WATERMARK)} \u2014 template pending counsel approval</div>`}<form id="f" class="card">${f}<p><button class="btn" type="submit">Preview</button></p><p class="err" id="e"></p></form><p class="muted">Before this agreement, give the buyer the Ohio Consumer Guide to Agency Relationships and get its acknowledgement as a separate step (OAC 1301:5-6-05(D)).</p>`;
  const js = `document.getElementById('f').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const r=await fetch('/api/hbe/agreements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({buyer_id:${JSON.stringify(b.id)},fields:d})});const j=await r.json();if(j.ok)location='/hbe/agreements/'+j.id;else document.getElementById('e').textContent='Please check: '+(j.errors||[j.error]).join(', ')}`;
  return html(page('Open the next chapter', body, js));
}

export async function createAgreement(env, professional, body) {
  const buyer = await db(env).prepare(`SELECT id, stage FROM buyers WHERE id=?`).bind(String(body.buyer_id || '')).first();
  if (!buyer) return { status: 404, error: 'buyer_not_found' };
  if (buyer.stage !== 'consultation') return { status: 409, error: 'not_consultation_stage' };
  const { fields, errors } = validateFields(body.fields || {});
  if (errors.length) return { status: 400, error: 'invalid_fields', errors };
  await ensureTemplate(env);
  const approved = await templateApproved(env);
  const member = await db(env).prepare(`SELECT case_id FROM buyer_case_members WHERE buyer_id=?`).bind(buyer.id).first();
  const caseId = member?.case_id || null;
  const buyers = caseId ? ((await db(env).prepare(`SELECT buyer_id FROM buyer_case_members WHERE case_id=? ORDER BY buyer_id=? DESC, rowid`).bind(caseId, buyer.id).all()).results || []).map(r => r.buyer_id) : [buyer.id];
  const id = uid(); const now = nowIso();
  await db(env).prepare(`INSERT INTO agreement_instances (id,case_id,primary_buyer_id,template_id,template_version,is_sample,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',?,?,?)`)
    .bind(id, caseId, buyer.id, TEMPLATE_ID, TEMPLATE_VERSION, approved ? 0 : 1, professional.email, now, now).run();
  for (const [k, v] of Object.entries(fields)) await db(env).prepare(`INSERT INTO agreement_fields (instance_id,field_key,field_value,set_by,set_at) VALUES (?,?,?,?,?)`).bind(id, k, v, professional.email, now).run();
  let i = 0;
  for (const bid of buyers) await db(env).prepare(`INSERT INTO agreement_signers (id,instance_id,role,buyer_id,order_idx) VALUES (?,?,'buyer',?,?)`).bind(uid(), id, bid, i++).run();
  await db(env).prepare(`INSERT INTO agreement_signers (id,instance_id,role,staff_email,order_idx) VALUES (?,?,'broker',?,?)`).bind(uid(), id, ownerEmail(env), 99).run();
  await addEvent(env, id, 'created', { actor: professional.email, detail: { sample: !approved } });
  return { status: 200, id, sample: !approved };
}

async function refreshDocSha(env, id) {
  const b = await loadInstance(env, id);
  const sha = await documentSha(b.inst, b.fields, b.signers.map(signerName));
  await db(env).prepare(`UPDATE agreement_instances SET doc_sha256=?, updated_at=? WHERE id=?`).bind(sha, nowIso(), id).run();
  return sha;
}

export async function sendAgreement(env, professional, id, request, send = sendWebPush) {
  const b = await loadInstance(env, id);
  if (!b) return { status: 404, error: 'not_found' };
  if (b.inst.status !== 'draft') return { status: 409, error: 'already_sent' };
  // Locked to SAMPLE until counsel-approved template: an instance created as a sample stays a sample.
  const approved = await templateApproved(env);
  if (Number(b.inst.is_sample) !== 1 && !approved) return { status: 409, error: 'template_not_approved' };
  const sha = await refreshDocSha(env, id);
  await db(env).prepare(`UPDATE agreement_instances SET status='sent', sent_at=?, updated_at=? WHERE id=? AND status='draft'`).bind(nowIso(), nowIso(), id).run();
  await addEvent(env, id, Number(b.inst.is_sample) === 1 ? 'sent_sample' : 'sent', { actor: professional.email, request, docSha: sha });
  const pushed = await notifyBuyers(env, b.signers.filter(s => s.role === 'buyer').map(s => s.buyer_id), send);
  return { status: 200, ok: true, sample: Number(b.inst.is_sample) === 1, doc_sha256: sha, pushed };
}

async function staffView(env, id) {
  const b = await loadInstance(env, id); if (!b) return html(page('Not found', '<h1>Not found</h1>'), 404);
  const sample = Number(b.inst.is_sample) === 1;
  const rows = b.signers.map(s => `<li>${esc(signerName(s))}: ${s.signed_at ? 'signed ' + esc(s.signed_at) : s.ersd_consent_at ? 'reviewing' : 'waiting'}</li>`).join('');
  const canCounter = b.inst.status === 'buyers_signed';
  const body = `<h1>Agreement ${esc(b.inst.status)}</h1>${sample ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}<div class="card"><ul>${rows}</ul><p class="muted">Doc SHA-256: ${esc(b.inst.doc_sha256 || '(set on send)')}</p></div>${docHtml(b.fields, sample)}<p>${b.inst.status === 'draft' ? `<button class="btn" id="send">${sample ? 'Send SAMPLE for signature' : 'Send for signature'}</button>` : ''} ${canCounter ? '<button class="btn" id="cs">Countersign as broker</button>' : ''} <a class="btn" href="/hbe/agreements/${esc(id)}/document.pdf">PDF</a> <a href="/hbe/passkey">Set up my passkey</a></p><p class="err" id="e"></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}const id=${JSON.stringify(id)};const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json());const E=t=>document.getElementById('e').textContent=t;
const s=document.getElementById('send');if(s)s.onclick=async()=>{const j=await post('/api/hbe/agreements/'+id+'/send');j.ok?location.reload():E(j.error)};
const c=document.getElementById('cs');if(c)c.onclick=async()=>{const o=await post('/api/hbe/agreements/'+id+'/countersign/options');if(!o.ok)return E(o.error);let cred=null;if(o.publicKey){try{cred=await hbePasskeyGet(o.publicKey)}catch(x){return E('Passkey cancelled')}}const sig=prompt('Type your full name to countersign');if(!sig)return;const j=await post('/api/hbe/agreements/'+id+'/countersign',{challenge_id:o.challenge_id,credential:cred,signature_text:sig,consent:true});j.ok?location.reload():E(j.error)};`;
  return html(page('Agreement', body, js));
}

export async function countersignOptions(env, professional, id, url) {
  if (professional.email !== ownerEmail(env)) return { status: 403, error: 'broker_only' };
  const b = await loadInstance(env, id); if (!b) return { status: 404, error: 'not_found' };
  if (b.inst.status !== 'buyers_signed') return { status: 409, error: 'buyers_not_signed' };
  const creds = await credentialsFor(env, 'staff', professional.email);
  const broker = b.signers.find(s => s.role === 'broker');
  if (!creds.length) return { status: 200, ok: true, method: 'access_identity', challenge_id: null };
  const nonce = randomChallenge(); const challenge = await boundChallenge(b.inst.doc_sha256, broker.id, nonce);
  const ch = await newChallenge(env, 'countersign', 'staff', professional.email, b.inst.doc_sha256, challenge);
  return { status: 200, ok: true, method: 'passkey', challenge_id: ch.id, publicKey: assertionOptions({ rpId: rp(env, url).rpId, challenge, allowIds: creds.map(c => c.credential_id) }) };
}

export async function countersign(env, professional, id, body, request, url) {
  if (professional.email !== ownerEmail(env)) return { status: 403, error: 'broker_only' };
  if (!env.AGREEMENTS || typeof env.AGREEMENTS.put !== 'function') return { status: 503, error: 'agreements_storage_not_configured' };
  const b = await loadInstance(env, id); if (!b) return { status: 404, error: 'not_found' };
  if (b.inst.status !== 'buyers_signed') return { status: 409, error: 'buyers_not_signed' };
  const sig = String(body.signature_text || '').trim().slice(0, 80);
  if (sig.length < 2 || body.consent !== true) return { status: 400, error: 'signature_required' };
  const broker = b.signers.find(s => s.role === 'broker');
  const creds = await credentialsFor(env, 'staff', professional.email);
  let credId = null;
  if (creds.length) {
    const ch = await takeChallenge(env, String(body.challenge_id || ''), 'countersign', 'staff', professional.email);
    if (!ch || ch.bound_sha256 !== b.inst.doc_sha256) return { status: 400, error: 'challenge_invalid' };
    const cred = creds.find(c => c.credential_id === body.credential?.rawId || c.credential_id === body.credential?.id);
    if (!cred) return { status: 400, error: 'unknown_credential' };
    try { await useCredential(env, cred, body.credential.response, ch.challenge, rp(env, url)); } catch (e) { await addEvent(env, id, 'countersign_passkey_failed', { signerId: broker.id, actor: professional.email, request, detail: { reason: e.message } }); return { status: 400, error: 'passkey_failed' }; }
    credId = cred.credential_id;
  }
  const at = nowIso();
  await db(env).prepare(`UPDATE agreement_signers SET ersd_version=?, ersd_consent_at=?, signed_at=?, signature_kind='typed', signature_text=?, passkey_credential_id=? WHERE id=? AND signed_at IS NULL`).bind(ERSD_VERSION, at, at, sig, credId, broker.id).run();
  await addEvent(env, id, 'broker_countersigned', { signerId: broker.id, actor: professional.email, request, docSha: b.inst.doc_sha256, detail: { method: credId ? 'passkey_uv' : 'access_identity' } });
  return finalize(env, id);
}

async function certificateEvents(env, bundle) {
  const rows = (await db(env).prepare(`SELECT event, at, signer_id, doc_sha256 FROM agreement_events WHERE instance_id=? ORDER BY at, rowid`).bind(bundle.inst.id).all()).results || [];
  const names = Object.fromEntries(bundle.signers.map(s => [s.id, signerName(s)]));
  return rows.map(r => ({ ...r, signer_label: r.signer_id ? names[r.signer_id] : '' }));
}
async function finalize(env, id) {
  const b = await loadInstance(env, id);
  await addEvent(env, id, 'executed', { docSha: b.inst.doc_sha256 });
  const pdf = agreementPdf(b, { certificate: await certificateEvents(env, b) });
  const finalSha = await sha256Hex(pdf); const key = `agreements/${id}/executed.pdf`;
  await env.AGREEMENTS.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { sha256: finalSha, sample: String(b.inst.is_sample) } });
  await db(env).prepare(`UPDATE agreement_instances SET status='executed', executed_at=?, final_sha256=?, final_r2_key=?, updated_at=? WHERE id=?`).bind(nowIso(), finalSha, key, nowIso(), id).run();
  await addEvent(env, id, 'stored', { docSha: finalSha, detail: { r2_key: key } });
  return { status: 200, ok: true, final_sha256: finalSha };
}

async function pdfResponse(env, b) {
  if (b.inst.status === 'executed' && b.inst.final_r2_key) {
    if (!env.AGREEMENTS) return json({ ok: false, error: 'agreements_storage_not_configured' }, 503);
    const obj = await env.AGREEMENTS.get(b.inst.final_r2_key); if (!obj) return json({ ok: false, error: 'missing' }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="hbe-agreement-${b.inst.id.slice(0, 8)}.pdf"`, ...SEC } });
  }
  return new Response(agreementPdf(b), { headers: { 'content-type': 'application/pdf', ...SEC } });
}

function passkeyPage(kind) {
  const base = kind === 'staff' ? '/api/hbe/passkey' : '/api/portal/passkey';
  const body = `<h1>Set up Face ID / passkey</h1><p>Use Face ID, Touch ID or your device PIN to sign in and to sign agreements.</p><p><button class="btn" id="go">Set up passkey</button></p><p id="m" class="muted"></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}const csrf=${kind === 'staff' ? "''" : "document.cookie&&''"};document.getElementById('go').onclick=async()=>{const M=t=>document.getElementById('m').textContent=t;if(!await hbePasskeySupported())return M(${JSON.stringify(NO_PASSKEY_MESSAGE)});const t=window.__csrf||'';const o=await fetch('${base}/register/options',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrf:t})}).then(r=>r.json());if(!o.ok)return M(o.error);try{const c=await hbePasskeyCreate(o.publicKey);const j=await fetch('${base}/register/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrf:t,challenge_id:o.challenge_id,credential:c,label:navigator.platform||''})}).then(r=>r.json());M(j.ok?'Passkey saved.':j.error)}catch(e){M('Cancelled.')}}`;
  return { body, js };
}

export async function registerOptions(env, kind, ownerId, displayName, url) {
  const creds = await credentialsFor(env, kind, ownerId);
  const ch = await newChallenge(env, 'register', kind, ownerId);
  const userHandle = await userHandleFor(kind, ownerId, env);
  return { status: 200, ok: true, challenge_id: ch.id, publicKey: registrationOptions({ rpId: rp(env, url).rpId, rpName: 'HomeBuyer Experts', userHandle, userName: kind === 'staff' ? ownerId : `buyer-${ownerId.slice(0, 8)}`, displayName, challenge: ch.challenge, excludeIds: creds.map(c => c.credential_id) }) };
}
export async function registerVerify(env, kind, ownerId, body, url) {
  const ch = await takeChallenge(env, String(body.challenge_id || ''), 'register', kind, ownerId);
  if (!ch) return { status: 400, error: 'challenge_invalid' };
  let reg; try { reg = await verifyRegistration({ response: body.credential?.response || {}, expectedChallenge: ch.challenge, ...rp(env, url) }); } catch (e) { return { status: 400, error: 'registration_failed', reason: e.message }; }
  await saveCredential(env, kind, ownerId, reg, await userHandleFor(kind, ownerId, env), body.label);
  return { status: 200, ok: true };
}

async function handleStaff(request, env, url, opts) {
  const p = url.pathname;
  const pro = await staffAuth(request, env, opts); if (pro.response) return pro.response;
  const out = r => json(r.status === 200 ? r : { ok: false, ...r }, r.status);
  if (request.method === 'GET' && p === '/hbe/agreements/new') return staffNewForm(env, url);
  if (request.method === 'GET' && p === '/hbe/passkey') { const { body, js } = passkeyPage('staff'); return html(page('Passkey', body, js)); }
  let m;
  if (request.method === 'GET' && (m = p.match(/^\/hbe\/agreements\/([0-9a-f-]{36})$/))) return staffView(env, m[1]);
  if (request.method === 'GET' && (m = p.match(/^\/hbe\/agreements\/([0-9a-f-]{36})\/document\.pdf$/))) { const b = await loadInstance(env, m[1]); return b ? pdfResponse(env, b) : json({ ok: false }, 404); }
  if (request.method !== 'POST') return null;
  if (!staffMutationOk(request)) return json({ ok: false, error: 'bad_origin' }, 403);
  const body = await readJson(request);
  if (p === '/api/hbe/agreements') return out(await createAgreement(env, pro, body));
  if (p === '/api/hbe/passkey/register/options') return pro.email === ownerEmail(env) ? out(await registerOptions(env, 'staff', pro.email, 'HBE broker', url)) : json({ ok: false, error: 'broker_only' }, 403);
  if (p === '/api/hbe/passkey/register/verify') return pro.email === ownerEmail(env) ? out(await registerVerify(env, 'staff', pro.email, body, url)) : json({ ok: false, error: 'broker_only' }, 403);
  if ((m = p.match(/^\/api\/hbe\/agreements\/([0-9a-f-]{36})\/send$/))) return out(await sendAgreement(env, pro, m[1], request, opts.send));
  if ((m = p.match(/^\/api\/hbe\/agreements\/([0-9a-f-]{36})\/countersign\/options$/))) return out(await countersignOptions(env, pro, m[1], url));
  if ((m = p.match(/^\/api\/hbe\/agreements\/([0-9a-f-]{36})\/countersign$/))) return out(await countersign(env, pro, m[1], body, request, url));
  return null;
}

// ---------------- buyer (BuyerUI) ----------------
async function buyerSigner(env, session, id) {
  const b = await loadInstance(env, id); if (!b) return null;
  const signer = b.signers.find(s => s.role === 'buyer' && s.buyer_id === session.buyer_id);
  return signer ? { ...b, signer } : null;
}
export async function pendingForBuyer(env, buyerId) {
  return (await db(env).prepare(`SELECT i.id, i.is_sample, i.status FROM agreement_signers s JOIN agreement_instances i ON i.id=s.instance_id WHERE s.buyer_id=? AND s.signed_at IS NULL AND i.status IN ('sent','partially_signed') ORDER BY i.sent_at DESC`).bind(buyerId).all()).results || [];
}
export async function agreementBanner(request, env) {
  try {
    const s = await buyerSession(request, env); if (!s) return '';
    const pending = await pendingForBuyer(env, s.buyer_id); if (!pending.length) return '';
    return `<section class="card" id="agreement-banner" style="border-color:#2d5a3d"><h2 style="margin:.2rem 0">Something to review and sign</h2><p>Your HomeBuyer Experts agreement is ready.${Number(pending[0].is_sample) === 1 ? ' <strong>(SAMPLE \u2014 not for signature)</strong>' : ''}</p><a class="btn" href="/portal/agreements?id=${esc(pending[0].id)}">Review and sign</a></section>`;
  } catch { return ''; }
}

async function buyerSignPage(env, session, url) {
  const csrf = await mutationCsrfToken(session.token);
  const id = url.searchParams.get('id');
  if (!id) {
    const list = (await db(env).prepare(`SELECT i.id, i.status, i.is_sample, s.signed_at FROM agreement_signers s JOIN agreement_instances i ON i.id=s.instance_id WHERE s.buyer_id=? AND i.status<>'draft' ORDER BY i.created_at DESC`).bind(session.buyer_id).all()).results || [];
    return html(page('Agreements', `<h1>Your agreements</h1>${list.map(a => `<div class="card">${Number(a.is_sample) ? '<strong>SAMPLE</strong> ' : ''}Status: ${esc(a.status)} ${a.status === 'executed' ? `<a href="/portal/agreements/${esc(a.id)}/certificate">Certificate</a> \u00b7 <a href="/portal/agreements/${esc(a.id)}/agreement.pdf">PDF</a>` : a.signed_at ? 'You signed.' : `<a class="btn" href="/portal/agreements?id=${esc(a.id)}">Review and sign</a>`}</div>`).join('') || '<p>Nothing to sign right now.</p>'}<p><a href="/portal/passkey">Set up Face ID / passkey</a></p>`));
  }
  const b = await buyerSigner(env, session, id); if (!b) return html(page('Not found', '<h1>Not found</h1>'), 404);
  const sample = Number(b.inst.is_sample) === 1;
  if (b.signer.signed_at) return html(page('Signed', `<h1>You signed this agreement</h1><p>${b.inst.status === 'executed' ? `<a href="/portal/agreements/${esc(id)}/certificate">View certificate</a>` : 'We\u2019ll let you know when the broker countersigns.'}</p>`));
  if (!['sent', 'partially_signed'].includes(b.inst.status)) return html(page('Not available', '<h1>Not available for signing</h1>'), 409);
  const body = `<h1>Something to review and sign</h1>${sample ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}
<section class="card" id="s1"><h2>1. Electronic records</h2><p>${esc(ERSD_TEXT)}</p><label><input type="checkbox" id="ersd" style="width:auto"> I agree</label><p><button class="btn" id="c1">Continue</button> <a href="/portal/agreements/${esc(id)}/agreement.pdf">Download PDF</a></p></section>
<section class="card" id="s2" hidden><h2>2. Read the whole agreement</h2><p class="muted">Scroll to the end to continue.</p>${docHtml(b.fields, sample)}
<label for="initials">Your initials</label><input id="initials" maxlength="4" autocomplete="off">
<h2>3. Your signature</h2><label><input type="radio" name="kind" value="typed" checked style="width:auto"> Type</label><label><input type="radio" name="kind" value="drawn" style="width:auto"> Draw</label>
<input id="typed" placeholder="Type your full name" autocomplete="off"><canvas id="pad" width="520" height="160" hidden></canvas><p><button type="button" id="clear" hidden>Clear</button></p>
<p><button class="btn" id="sign" disabled>Sign with Face ID / passkey</button></p><p class="muted">Your device will ask for Face ID, Touch ID or your PIN. This links your signature to this exact document.</p></section><p class="err" id="e"></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}const id=${JSON.stringify(id)},csrf=${JSON.stringify(csrf)},NOPK=${JSON.stringify(NO_PASSKEY_MESSAGE)};const $=x=>document.getElementById(x),E=t=>$('e').textContent=t;
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({csrf,...b})}).then(r=>r.json());
let scrolled=false,strokes=[],cur=null;
$('c1').onclick=async()=>{if(!$('ersd').checked)return E('Please agree to electronic records, or contact HBE to sign on paper.');if(!await hbePasskeySupported())return E(NOPK);const j=await post('/api/portal/agreements/'+id+'/consent',{ersd:true});if(!j.ok)return E(j.error);$('s1').hidden=true;$('s2').hidden=false;E('')};
const d=$('doc');d.addEventListener('scroll',async()=>{if(!scrolled&&d.scrollTop+d.clientHeight>=d.scrollHeight-8){scrolled=true;await post('/api/portal/agreements/'+id+'/viewed',{scrolled:true});ready()}});
const ready=()=>{$('sign').disabled=!(scrolled&&$('initials').value.trim().length>=2&&(kind()==='typed'?$('typed').value.trim().length>=2:strokes.length>0))};
const kind=()=>document.querySelector('input[name=kind]:checked').value;
document.querySelectorAll('input[name=kind]').forEach(r=>r.onchange=()=>{const t=kind()==='typed';$('typed').hidden=!t;$('pad').hidden=t;$('clear').hidden=t;ready()});
['initials','typed'].forEach(k=>$(k).oninput=ready);
const pad=$('pad'),ctx=pad.getContext('2d');const pt=e=>{const r=pad.getBoundingClientRect();return[Math.round((e.clientX-r.left)*pad.width/r.width),Math.round((e.clientY-r.top)*pad.height/r.height)]};
pad.onpointerdown=e=>{cur=[pt(e)];pad.setPointerCapture(e.pointerId)};pad.onpointermove=e=>{if(!cur)return;const p=pt(e),l=cur[cur.length-1];cur.push(p);ctx.beginPath();ctx.moveTo(l[0],l[1]);ctx.lineTo(p[0],p[1]);ctx.stroke()};pad.onpointerup=()=>{if(cur&&cur.length>1)strokes.push(cur);cur=null;ready()};
$('clear').onclick=()=>{strokes=[];ctx.clearRect(0,0,pad.width,pad.height);ready()};
$('sign').onclick=async()=>{$('sign').disabled=true;const o=await post('/api/portal/agreements/'+id+'/sign/options',{});if(!o.ok){E(o.error==='no_passkey'?'Set up Face ID / passkey first: /portal/passkey':o.error);return ready()}
let cred;try{cred=await hbePasskeyGet(o.publicKey)}catch(x){E('Face ID / passkey check was cancelled. Nothing was signed.');return ready()}
const j=await post('/api/portal/agreements/'+id+'/sign',{challenge_id:o.challenge_id,credential:cred,initials:$('initials').value,signature_kind:kind(),signature_text:$('typed').value,signature_strokes:strokes});if(j.ok)location='/portal/agreements';else{E(j.error);ready()}};`;
  return html(page('Review and sign', body, js));
}

export async function buyerConsent(env, session, id, body, request) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { status: 409, error: 'not_signable' };
  if (body.ersd !== true) return { status: 400, error: 'consent_required' };
  await db(env).prepare(`UPDATE agreement_signers SET ersd_version=?, ersd_consent_at=COALESCE(ersd_consent_at,?), viewed_at=COALESCE(viewed_at,?) WHERE id=?`).bind(ERSD_VERSION, nowIso(), nowIso(), b.signer.id).run();
  await addEvent(env, id, 'ersd_consented', { signerId: b.signer.id, actor: 'buyer', request, docSha: b.inst.doc_sha256, detail: { version: ERSD_VERSION } });
  return { status: 200, ok: true };
}
export async function buyerViewed(env, session, id, body, request) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!b.signer.ersd_consent_at) return { status: 409, error: 'consent_first' };
  if (body.scrolled !== true) return { status: 400, error: 'scroll_required' };
  await db(env).prepare(`UPDATE agreement_signers SET scrolled_at=COALESCE(scrolled_at,?) WHERE id=?`).bind(nowIso(), b.signer.id).run();
  await addEvent(env, id, 'scrolled_to_end', { signerId: b.signer.id, actor: 'buyer', request, docSha: b.inst.doc_sha256 });
  return { status: 200, ok: true };
}
export async function buyerSignOptions(env, session, id, url) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { status: 409, error: 'not_signable' };
  if (!b.signer.ersd_consent_at || !b.signer.scrolled_at) return { status: 409, error: 'review_incomplete' };
  const creds = await credentialsFor(env, 'buyer', session.buyer_id);
  if (!creds.length) return { status: 409, error: 'no_passkey', message: NO_PASSKEY_MESSAGE };
  const nonce = randomChallenge(); const challenge = await boundChallenge(b.inst.doc_sha256, b.signer.id, nonce);
  const ch = await newChallenge(env, 'sign', 'buyer', session.buyer_id, b.inst.doc_sha256, challenge);
  return { status: 200, ok: true, challenge_id: ch.id, doc_sha256: b.inst.doc_sha256, publicKey: assertionOptions({ rpId: rp(env, url).rpId, challenge, allowIds: creds.map(c => c.credential_id) }) };
}
function cleanStrokes(v) {
  if (!Array.isArray(v)) return null;
  const s = v.slice(0, 60).map(st => Array.isArray(st) ? st.slice(0, 400).map(p => [Math.max(0, Math.min(520, Math.round(Number(p?.[0]) || 0))), Math.max(0, Math.min(160, Math.round(Number(p?.[1]) || 0)))]) : []).filter(st => st.length > 1);
  return s.length ? s : null;
}
export async function buyerSign(env, session, id, body, request, url, send = sendWebPush) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { status: 409, error: 'not_signable' };
  if (!b.signer.ersd_consent_at || !b.signer.scrolled_at) return { status: 409, error: 'review_incomplete' };
  const initials = String(body.initials || '').trim().slice(0, 4);
  const kind = body.signature_kind === 'drawn' ? 'drawn' : body.signature_kind === 'typed' ? 'typed' : null;
  const text = String(body.signature_text || '').trim().slice(0, 80);
  const strokes = kind === 'drawn' ? cleanStrokes(body.signature_strokes) : null;
  if (initials.length < 2 || !kind || (kind === 'typed' && text.length < 2) || (kind === 'drawn' && !strokes)) return { status: 400, error: 'signature_incomplete' };
  // Passkey with user verification is mandatory; there is no other path.
  const ch = await takeChallenge(env, String(body.challenge_id || ''), 'sign', 'buyer', session.buyer_id);
  if (!ch) return { status: 400, error: 'challenge_invalid' };
  if (ch.bound_sha256 !== b.inst.doc_sha256) return { status: 409, error: 'document_changed' };
  const creds = await credentialsFor(env, 'buyer', session.buyer_id);
  const cred = creds.find(c => c.credential_id === body.credential?.rawId || c.credential_id === body.credential?.id);
  if (!cred || !body.credential?.response) return { status: 400, error: 'passkey_required' };
  try { await useCredential(env, cred, body.credential.response, ch.challenge, rp(env, url)); }
  catch (e) { await addEvent(env, id, 'passkey_failed', { signerId: b.signer.id, actor: 'buyer', request, detail: { reason: e.message } }); return { status: 400, error: 'passkey_failed' }; }
  const at = nowIso();
  const upd = await db(env).prepare(`UPDATE agreement_signers SET signed_at=?, signature_kind=?, signature_text=?, signature_strokes=?, initials=?, passkey_credential_id=? WHERE id=? AND signed_at IS NULL`)
    .bind(at, kind, kind === 'typed' ? text : null, strokes ? JSON.stringify(strokes) : null, initials, cred.credential_id, b.signer.id).run();
  if (!upd?.meta?.changes) return { status: 409, error: 'already_signed' };
  await addEvent(env, id, 'buyer_signed', { signerId: b.signer.id, actor: 'buyer', request, docSha: b.inst.doc_sha256, detail: { kind, passkey: cred.credential_id.slice(0, 12), uv: true } });
  const left = await db(env).prepare(`SELECT COUNT(*) AS n FROM agreement_signers WHERE instance_id=? AND role='buyer' AND signed_at IS NULL`).bind(id).first();
  const status = Number(left?.n) === 0 ? 'buyers_signed' : 'partially_signed';
  await db(env).prepare(`UPDATE agreement_instances SET status=?, updated_at=? WHERE id=?`).bind(status, nowIso(), id).run();
  await notifyOwner(env, send);
  return { status: 200, ok: true, agreement_status: status };
}

async function buyerCertificate(env, session, id) {
  const b = await buyerSigner(env, session, id); if (!b || b.inst.status !== 'executed') return html(page('Not found', '<h1>Not available</h1>'), 404);
  const ev = await certificateEvents(env, b);
  const chain = await verifyEventChain(env, id);
  return html(page('Certificate', `<h1>Certificate of completion</h1>${Number(b.inst.is_sample) ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}<div class="card"><p>Agreement ${esc(id)}</p><p class="muted">Document SHA-256 ${esc(b.inst.doc_sha256)}<br>Signed PDF SHA-256 ${esc(b.inst.final_sha256)}<br>Audit chain ${chain ? 'intact' : 'BROKEN'}</p><ul>${ev.map(e => `<li>${esc(e.at)} \u2014 ${esc(e.event)}${e.signer_label ? ' \u2014 ' + esc(e.signer_label) : ''}</li>`).join('')}</ul><a class="btn" href="/portal/agreements/${esc(id)}/agreement.pdf">Download signed PDF</a></div>`));
}

export async function passkeyLoginOptions(env, url) {
  const ch = await newChallenge(env, 'login', null, null);
  return { status: 200, ok: true, challenge_id: ch.id, publicKey: assertionOptions({ rpId: rp(env, url).rpId, challenge: ch.challenge }) };
}
export async function passkeyLoginVerify(env, body, url) {
  const ch = await takeChallenge(env, String(body.challenge_id || ''), 'login', null, null);
  if (!ch) return { status: 400, error: 'challenge_invalid' };
  const credId = String(body.credential?.rawId || body.credential?.id || '');
  const cred = await db(env).prepare(`SELECT * FROM passkey_credentials WHERE credential_id=? AND owner_kind='buyer' AND revoked_at IS NULL`).bind(credId).first();
  if (!cred) return { status: 400, error: 'unknown_credential' };
  try { await useCredential(env, cred, body.credential.response, ch.challenge, rp(env, url)); } catch { return { status: 400, error: 'passkey_failed' }; }
  return { status: 200, ok: true, cookie: await createSession(env, cred.owner_id) };
}

export const BUYER_MANIFEST = { name: 'HomeBuyer Experts', short_name: 'HBE', id: '/portal', start_url: '/portal', scope: '/portal', display: 'standalone', background_color: '#f7faf8', theme_color: '#2d5a3d', icons: [{ src: '/hbe/app-icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/hbe/app-icon-512.png', sizes: '512x512', type: 'image/png' }] };
export const BUYER_SW = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// No fetch handler: nothing private is cached.
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){}const url=typeof d.url==='string'&&d.url.startsWith('/portal')?d.url:'/portal';e.waitUntil(self.registration.showNotification(d.title||'HomeBuyer Experts',{body:d.body||'You have an update',tag:d.tag||undefined,icon:'/hbe/app-icon-192.png',data:{url}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.openWindow((e.notification.data&&e.notification.data.url)||'/portal'))});`;

async function handleBuyer(request, env, url, opts) {
  const p = url.pathname;
  if (request.method === 'GET' && p === '/portal/app.webmanifest') return new Response(JSON.stringify(BUYER_MANIFEST), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
  if (request.method === 'GET' && p === '/portal/app-sw.js') return new Response(BUYER_SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/portal' } });
  const out = r => json(r.status === 200 ? r : { ok: false, ...r }, r.status);
  if (request.method === 'POST' && p.startsWith('/api/portal/passkey/login/')) {
    if (!sameOriginRequest(request)) return json({ ok: false, error: 'bad_origin' }, 403);
    if (p.endsWith('/options')) return out(await passkeyLoginOptions(env, url));
    if (p.endsWith('/verify')) { const r = await passkeyLoginVerify(env, await readJson(request), url); if (r.status !== 200) return out(r); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': r.cookie, ...SEC } }); }
  }
  const session = await buyerSession(request, env);
  if (!session) return request.method === 'GET' ? Response.redirect(new URL('/login', url).toString(), 302) : json({ ok: false, error: 'auth_required' }, 401);
  let m;
  if (request.method === 'GET') {
    if (p === '/portal/agreements') return buyerSignPage(env, session, url);
    if (p === '/portal/passkey') { const csrf = await mutationCsrfToken(session.token); const { body, js } = passkeyPage('buyer'); return html(page('Passkey', body, `window.__csrf=${JSON.stringify(csrf)};${js}`)); }
    if ((m = p.match(/^\/portal\/agreements\/([0-9a-f-]{36})\/certificate$/))) return buyerCertificate(env, session, m[1]);
    if ((m = p.match(/^\/portal\/agreements\/([0-9a-f-]{36})\/agreement\.pdf$/))) { const b = await buyerSigner(env, session, m[1]); return b && b.inst.status !== 'draft' ? pdfResponse(env, b) : json({ ok: false }, 404); }
    return null;
  }
  if (request.method !== 'POST') return null;
  const body = await readJson(request);
  if (!await assertMutationCsrf(request, body.csrf, session.token)) return json({ ok: false, error: 'csrf' }, 403);
  if (p === '/api/portal/passkey/register/options') return out(await registerOptions(env, 'buyer', session.buyer_id, `${session.first_name || 'Buyer'}`, url));
  if (p === '/api/portal/passkey/register/verify') return out(await registerVerify(env, 'buyer', session.buyer_id, body, url));
  if (p === '/api/portal/push/subscribe') {
    const sub = validateSubscription(body.subscription); if (!sub) return json({ ok: false, error: 'bad_subscription' }, 400);
    await db(env).prepare(`INSERT INTO buyer_push_subscriptions (id,buyer_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET buyer_id=excluded.buyer_id, p256dh=excluded.p256dh, auth=excluded.auth, revoked_at=NULL`)
      .bind(uid(), session.buyer_id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, nowIso()).run();
    return json({ ok: true });
  }
  if ((m = p.match(/^\/api\/portal\/agreements\/([0-9a-f-]{36})\/(consent|viewed|sign\/options|sign)$/))) {
    const [, id, action] = m;
    if (action === 'consent') return out(await buyerConsent(env, session, id, body, request));
    if (action === 'viewed') return out(await buyerViewed(env, session, id, body, request));
    if (action === 'sign/options') return out(await buyerSignOptions(env, session, id, url));
    return out(await buyerSign(env, session, id, body, request, url, opts.send));
  }
  return null;
}

export function isAgreementPath(pathname) {
  return pathname.startsWith('/hbe/agreements') || pathname === '/hbe/passkey' || pathname.startsWith('/api/hbe/agreements') || pathname.startsWith('/api/hbe/passkey/')
    || pathname.startsWith('/portal/agreements') || pathname === '/portal/passkey' || pathname === '/portal/app.webmanifest' || pathname === '/portal/app-sw.js'
    || pathname.startsWith('/api/portal/agreements/') || pathname.startsWith('/api/portal/passkey/') || pathname === '/api/portal/push/subscribe';
}

export async function handleAgreements(request, env, url, opts = {}) {
  if (!env.BUYER_DB) return json({ ok: false, error: 'db_unavailable' }, 503);
  const isStaff = url.pathname.startsWith('/hbe/') || url.pathname.startsWith('/api/hbe/');
  const res = isStaff ? await handleStaff(request, env, url, opts) : await handleBuyer(request, env, url, opts);
  return res || json({ ok: false, error: 'not_found' }, 404);
}
