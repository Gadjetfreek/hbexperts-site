// "Open the next chapter": buyer agency agreement + native e-sign (SAMPLE flow).
// - Staff (HBEUI, Cloudflare Access) prepares and sends; broker countersigns.
// - Buyers (BuyerUI, hbe_session) consent to e-records, scroll the full text, initial, sign (typed or drawn)
//   and MUST complete a passkey assertion (user verification required) bound to the document SHA-256.
// - One signing session: e-records consent, then the Ohio Consumer Guide to Agency Relationships (a separate
//   document, shown first) and the agreement on one page. ONE passkey assertion covers both: its challenge is bound
//   to a bundle hash of the guide PDF SHA-256 and the agreement SHA-256. Guide receipt (checkbox) and the agreement
//   signature arrive in the same submission; the audit trail still records consumer_guide_* events separately.
// - No non-passkey buyer signing path. Devices without passkeys are told to contact HBE for paper signing.
// - Until agreement_templates.approved = 1 (set manually by the owner; NO code path sets it), every document is
//   watermarked "SAMPLE — NOT FOR SIGNATURE" and flagged is_sample = 1.
import { authenticateHbeProfessional, requireVerifiedProfessional } from './hbe-access-worker.js';
import { ownerEmail, vapidConfig, validateSubscription } from './hbe-push.js';
import { sendWebPush } from './web-push.js';
import { assertMutationCsrf, mutationCsrfToken, sameOriginRequest } from './household-state.js';
import { V6_PARAGRAPHS } from './agreement-template-v6.js';
import { GUIDE_ID, GUIDE_VERSION, GUIDE_PDF_PATH, GUIDE_PDF_SHA256, GUIDE_PDF_B64, GUIDE_PARAGRAPHS, GUIDE_ACK_TEXT } from './consumer-guide.js';
import { buildPdf } from './agreement-pdf.js';
import {
  b64uEncode, sha256Hex, randomChallenge, registrationOptions, assertionOptions,
  verifyRegistration, verifyAssertion, boundChallenge, WEBAUTHN_BROWSER_JS
} from './webauthn.js';

export const TEMPLATE_ID = 'hbe-buyer-agency-v6';
export const TEMPLATE_VERSION = 'v6-draft-2026-10-30';
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
// One passkey assertion covers both documents: challenge bound to this bundle of both SHA-256 hashes.
export async function bundleSha(guideSha, docSha) { return sha256Hex(`hbe-bundle-v1|consumer_guide:${guideSha}|agreement:${docSha}`); }
export async function templateBodySha() { return sha256Hex(V6_PARAGRAPHS.join('\n')); }
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
  return V6_PARAGRAPHS.map(p => p
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
  const blocks = renderParagraphs(fields).map((t, i) => t.startsWith('[[BOX]]') ? { text: t.slice(7), bold: true, box: true, size: 9.5 } : t.startsWith('[[EHO]]') ? { text: t.slice(7), eho: true, bold: true, size: 10 } : ({ text: t, bold: i < 2, size: i < 2 ? 12 : 9.5 }));
  const g = signers.filter(s => s.role === 'buyer' && s.guide_ack_at);
  if (g.length) blocks.push({ text: `Ohio Consumer Guide to Agency Relationships (${GUIDE_VERSION}, PDF SHA-256 ${GUIDE_PDF_SHA256.slice(0, 16)}...) receipt acknowledged (recorded separately; same signing session, one passkey assertion bound to the guide and agreement SHA-256) by: ${g.map(s => `${signerName(s)} ${s.guide_ack_at} (UTC)`).join('; ')}.`, size: 8, gap: 8 });
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
    blocks.push({ text: 'Each signer consented to electronic records, buyers separately acknowledged receipt of the Ohio Consumer Guide to Agency Relationships with a passkey, each signer scrolled the full agreement, and (buyers) completed a device passkey check bound to this document hash. Events are hash-chained.', size: 8 });
  }
  const sample = Number(inst.is_sample) === 1;
  return buildPdf(blocks, { watermark: sample ? SAMPLE_WATERMARK : '', footer: `${sample ? 'SAMPLE \u2014 ' : ''}HBE agreement ${inst.id.slice(0, 8)}` });
}

// ---------------- page shell ----------------
const CSS = `body{font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f7faf8;color:#1a1a2e}main{max-width:46rem;margin:0 auto;padding:1.2rem}h1{font:600 1.7rem Georgia,serif}.card{background:#fff;border:1px solid #dfe8e2;border-radius:14px;padding:1rem 1.2rem;margin:1rem 0}.btn{display:inline-block;background:#2d5a3d;color:#fff;border:0;border-radius:10px;padding:.75rem 1.1rem;font-weight:700;text-decoration:none;cursor:pointer}.btn[disabled]{opacity:.45;cursor:not-allowed}.sample{background:#fff4f4;border:2px dashed #b42318;color:#b42318;font-weight:800;padding:.6rem;border-radius:10px;text-align:center}.doc{max-height:55vh;overflow:auto;border:1px solid #ccc;border-radius:10px;padding:1rem;background:#fff;position:relative}.doc p{margin:.5rem 0}.wm{position:sticky;top:40%;text-align:center;color:rgba(180,35,24,.25);font:800 2rem system-ui;transform:rotate(-20deg);pointer-events:none;height:0}label{display:block;margin:.7rem 0 .2rem;font-weight:650}input,select,textarea{width:100%;padding:.6rem;border:1px solid #bbb;border-radius:8px;font:inherit;box-sizing:border-box}canvas{border:1px solid #888;border-radius:8px;touch-action:none;background:#fff;width:100%;max-width:520px;height:160px}.muted{color:#555;font-size:.92rem}.err{color:#b42318;font-weight:700}.bad{border:2px solid #b42318;background:#fff4f4}label.badl{color:#b42318}`;
const page = (title, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="manifest" href="/portal/app.webmanifest"><style>${CSS}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
export const EHO_SVG = '<svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true"><path d="M17 1 1 12h4v17h24V12h4z" fill="#000"/><rect x="10" y="15" width="14" height="3" fill="#fff"/><rect x="10" y="21" width="14" height="3" fill="#fff"/></svg>';
export function paraHtml(p) {
  if (p.startsWith('[[BOX]]')) return `<p class="fees" style="border:2px solid #000;padding:.5rem;font-weight:800">${esc(p.slice(7))}</p>`;
  if (p.startsWith('[[EHO]]')) return `<p class="eho" style="display:flex;gap:.5rem;align-items:center;font-weight:800">${EHO_SVG}${esc(p.slice(7))}</p>`;
  return `<p>${esc(p)}</p>`;
}
const docHtml = (fields, sample) => `<div class="doc" id="doc">${sample ? `<div class="wm">${esc(SAMPLE_WATERMARK)}</div>` : ''}${renderParagraphs(fields).map(paraHtml).join('')}<p id="doc-end" class="muted">\u2014 End of agreement \u2014</p></div>`;

// ---------------- staff (HBEUI) ----------------
async function staffAuth(request, env, opts) {
  const a = await requireVerifiedProfessional(request, env, opts.authenticate || authenticateHbeProfessional);
  return a.ok ? a.professional : { response: a.response };
}
function staffMutationOk(request) { return request.method === 'POST' && sameOriginRequest(request) && (request.headers.get('content-type') || '').includes('application/json'); }

async function staffNewForm(env, url) {
  const buyerId = url.searchParams.get('buyer') || url.searchParams.get('buyer_id') || '';
  const b = await db(env).prepare(`SELECT id, first_name, last_name, stage FROM buyers WHERE id=?`).bind(buyerId).first();
  if (!b) return html(page('Not found', '<h1>Buyer not found</h1>'), 404);
  if (b.stage !== 'consultation') return html(page('Not available', `<h1>Not at Consultation</h1><p>The agreement is opened from the Consultation stage.</p>`), 409);
  const approved = await templateApproved(env);
  const f = FIELD_DEFS.map(d => `<label for="${d.key}" data-k="${d.key}">${esc(d.label)}</label>` + (d.type === 'select' ? `<select id="${d.key}" name="${d.key}">${d.options.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select>` : d.type === 'textarea' ? `<textarea id="${d.key}" name="${d.key}" rows="3"></textarea>` : `<input id="${d.key}" name="${d.key}" type="${d.type}" ${d.required ? 'required' : ''}>`)).join('');
  const body = `<p><a href="/hbe">\u2190 Back to HBE dashboard</a></p><h1>Open the next chapter</h1><p>Exclusive Buyer\u2019s Agency Agreement for <strong>${esc(b.first_name)} ${esc(b.last_name)}</strong>.</p>${approved ? '' : `<div class="sample">${esc(SAMPLE_WATERMARK)} \u2014 template pending counsel approval</div>`}<form id="f" class="card">${f}<p><button class="btn" type="submit">Preview</button></p><p class="err" id="e"></p></form><p class="muted">The buyer signs in one session: e-records consent, then the Ohio Consumer Guide (receipt) and this agreement, confirmed with one Face ID / passkey check covering both documents.</p>`;
  const js = `const LBL=${JSON.stringify(Object.fromEntries(FIELD_DEFS.map(d => [d.key, d.label])))},MSG={buyer_not_found:'This buyer was not found.',not_consultation_stage:'This buyer is not at the Consultation stage.',bad_origin:'The request was blocked as not coming from this page. Reload the page and try again.',auth_required:'Your HBE sign-in expired. Reload the page to sign in again.'},FIX={term_end:'pick a date after today',price_max:'enter a whole dollar amount, e.g. 500000',retainer_option:'choose an option'};
const F=document.getElementById('f'),E=document.getElementById('e');
const say=(t,keys)=>{E.textContent=t;F.querySelectorAll('.bad').forEach(x=>x.classList.remove('bad'));F.querySelectorAll('label[data-k]').forEach(l=>l.textContent=LBL[l.dataset.k]);(keys||[]).forEach(k=>{const i=document.getElementById(k),l=F.querySelector('label[data-k="'+k+'"]');if(i){i.classList.add('bad');i.setAttribute('aria-invalid','true')}if(l)l.textContent=LBL[k]+' \u2014 please check: '+(FIX[k]||'required')});const first=(keys||[]).map(k=>document.getElementById(k)).find(Boolean);(first||E).scrollIntoView({behavior:'smooth',block:'center'});if(first)first.focus({preventScroll:true})};
const STATUS={401:'not signed in (401)',403:'not allowed (403)',404:'not found (404)',409:'conflict (409)',429:'too many tries, wait a minute (429)',500:'server error (500)',502:'server unavailable (502)',503:'service unavailable (503)'};
F.onsubmit=async e=>{e.preventDefault();const btn=F.querySelector('button[type=submit]');btn.disabled=true;say('',[]);E.textContent='Saving\u2026';
try{const d=Object.fromEntries(new FormData(F));const r=await fetch('/api/hbe/agreements',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({buyer_id:${JSON.stringify(b.id)},fields:d})});
let j=null;try{if((r.headers.get('content-type')||'').includes('application/json'))j=await r.json()}catch(_){}
if(r.ok&&j&&j.ok&&j.id){location='/hbe/agreements/'+j.id;return}
if(!j){say('Could not save: the server answered '+(STATUS[r.status]||('HTTP '+r.status))+(r.redirected||r.status===401||r.status===403?'. Your HBE sign-in may have expired \u2014 reload the page.':'.'));btn.disabled=false;return}
if(Array.isArray(j.errors)&&j.errors.length){say('Please fix: '+j.errors.map(k=>LBL[k]||k).join('; ')+'.',j.errors)}else{say(MSG[j.error]||('Could not save: '+(j.error||'unknown error')+' ('+(STATUS[r.status]||('HTTP '+r.status))+').'))}}
catch(x){say('Could not reach the server. Check your connection and try again.')}btn.disabled=false};`;
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
  return { status: 200, ok: true, id, sample: !approved };
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

const STAFF_NEXT = { draft: 'Next: review the preview above, then Send for signature.', sent: 'Sent. Next: the buyer(s) review and sign in their portal; this page updates when they do.', buyers_signed: 'All buyers signed. Next: Countersign as broker.', executed: 'Fully executed. The signed PDF and certificate are final.' };
async function staffView(env, id) {
  const b = await loadInstance(env, id); if (!b) return html(page('Not found', '<h1>Not found</h1>'), 404);
  const sample = Number(b.inst.is_sample) === 1;
  const rows = b.signers.map(s => `<li>${esc(signerName(s))}: ${s.signed_at ? 'signed ' + esc(s.signed_at) : s.ersd_consent_at ? 'reviewing' : 'waiting'}</li>`).join('');
  const canCounter = b.inst.status === 'buyers_signed';
  const body = `<h1>Agreement ${esc(b.inst.status)}</h1>${sample ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}<div class="card"><ul>${rows}</ul><p class="muted">Doc SHA-256: ${esc(b.inst.doc_sha256 || '(set on send)')}</p></div>${docHtml(b.fields, sample)}<p>${b.inst.status === 'draft' ? `<button class="btn" id="send">${sample ? 'Send SAMPLE for signature' : 'Send for signature'}</button>` : ''} ${canCounter ? '<button class="btn" id="cs">Countersign as broker</button>' : ''} <a class="btn" href="/hbe/agreements/${esc(id)}/document.pdf">PDF</a> <a href="${esc(passkeyLink('staff', '/hbe/agreements/' + id))}">Set up my passkey</a></p><p class="err" id="e"></p><p class="muted">${esc(STAFF_NEXT[b.inst.status] || '')}</p><p><a class="btn" href="/hbe">Back to HBE dashboard</a> <a href="/hbe/agreements/new?buyer=${esc(b.inst.primary_buyer_id || '')}">New agreement for this buyer</a></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}const id=${JSON.stringify(id)};const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json());const E=t=>document.getElementById('e').textContent=t;
const s=document.getElementById('send');if(s)s.onclick=async()=>{const j=await post('/api/hbe/agreements/'+id+'/send');j.ok?location.reload():E(j.error)};
const c=document.getElementById('cs');if(c)c.onclick=async()=>{const o=await post('/api/hbe/agreements/'+id+'/countersign/options');if(!o.ok)return E((o.error==='no_passkey'?'Set up your passkey first (link above), then come back here.':o.error));let cred=null;if(o.publicKey){try{cred=await hbePasskeyGet(o.publicKey)}catch(x){return E('Passkey cancelled')}}const sig=prompt('Type your full name to countersign');if(!sig)return;const j=await post('/api/hbe/agreements/'+id+'/countersign',{challenge_id:o.challenge_id,credential:cred,signature_text:sig,consent:true});j.ok?location.reload():E(j.error)};`;
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

// Only same-origin relative paths inside the caller's own area; absolute, protocol-relative,
// backslash and control-character values are rejected and replaced by the default.
export function safeReturn(raw, kind) {
  const def = kind === 'staff' ? '/hbe' : '/portal/agreements';
  const v = String(raw || '');
  if (!v || v.length > 300 || !v.startsWith('/') || v.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(v)) return def;
  let u; try { u = new URL(v, 'https://x.invalid'); } catch { return def; }
  if (u.origin !== 'https://x.invalid') return def;
  const area = kind === 'staff' ? /^\/hbe(\/|$)/ : /^\/portal(\/|$)/;
  if (!area.test(u.pathname) || /passkey/.test(u.pathname)) return def;
  return u.pathname + u.search;
}
export function passkeyLink(kind, ret) { return `/${kind === 'staff' ? 'hbe' : 'portal'}/passkey?return=${encodeURIComponent(ret)}`; }

async function passkeyPage(env, kind, ownerId, url) {
  const ret = safeReturn(url.searchParams.get('return'), kind);
  const label = kind === 'staff' ? (ret === '/hbe' ? 'Return to HBE dashboard' : 'Return to the agreement') : (ret.startsWith('/portal/agreements') ? 'Return to my agreement' : 'Return to my portal');
  const has = (await credentialsFor(env, kind, ownerId)).length > 0;
  const base = kind === 'staff' ? '/api/hbe/passkey' : '/api/portal/passkey';
  const back = `<a class="btn" id="ret" href="${esc(ret)}">${esc(label)}</a>`;
  const body = `<p><a href="${esc(ret)}">\u2190 Back</a></p><h1>Set up Face ID / passkey</h1>`
    + `<div id="done" class="card"${has ? '' : ' hidden'}><p><strong>${has ? 'Face ID / passkey is already set up on your account.' : 'Face ID is set up.'}</strong></p><p>${back}</p>${has ? '<p class="muted">Setting one up on another device? Use the button below.</p>' : ''}</div>`
    + `<div id="setup"><p>Use Face ID, Touch ID or your device PIN to sign in and to sign agreements.</p><p><button class="btn" id="go">${has ? 'Add a passkey on this device' : 'Set up passkey'}</button></p></div><p id="m" class="muted"></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}document.getElementById('go').onclick=async()=>{const M=t=>document.getElementById('m').textContent=t;if(!await hbePasskeySupported())return M(${JSON.stringify(NO_PASSKEY_MESSAGE)});const t=window.__csrf||'';const o=await fetch('${base}/register/options',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({csrf:t})}).then(r=>r.json()).catch(()=>({error:'Could not reach the server. Please reload.'}));if(!o.ok)return M(o.error);try{const c=await hbePasskeyCreate(o.publicKey);const j=await fetch('${base}/register/verify',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({csrf:t,challenge_id:o.challenge_id,credential:c,label:navigator.platform||''})}).then(r=>r.json()).catch(()=>({error:'Could not reach the server. Please reload.'}));if(j.ok){const d=document.getElementById('done');d.innerHTML='<p><strong>Face ID is set up.</strong></p><p>'+${JSON.stringify(back)}+'</p>';d.hidden=false;document.getElementById('setup').hidden=true;M('');document.getElementById('ret').focus();d.scrollIntoView()}else M(j.error)}catch(e){M('Cancelled.')}}`;
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
  if (request.method === 'GET' && p === '/hbe/passkey') { const { body, js } = await passkeyPage(env, 'staff', pro.email, url); return html(page('Passkey', body, js)); }
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
    return html(page('Agreements', `<h1>Your agreements</h1>${list.map(a => `<div class="card">${Number(a.is_sample) ? '<strong>SAMPLE</strong> ' : ''}Status: ${esc(a.status)} ${a.status === 'executed' ? `<a href="/portal/agreements/${esc(a.id)}/certificate">Certificate</a> \u00b7 <a href="/portal/agreements/${esc(a.id)}/agreement.pdf">PDF</a>` : a.signed_at ? 'You signed.' : `<a class="btn" href="/portal/agreements?id=${esc(a.id)}">Review and sign</a>`}</div>`).join('') || '<p>Nothing to sign right now.</p>'}<p><a class="btn" href="/portal">Back to my portal</a> <a href="${esc(passkeyLink('buyer', '/portal/agreements'))}">Set up Face ID / passkey</a></p>`));
  }
  const b = await buyerSigner(env, session, id); if (!b) return html(page('Not found', '<h1>Not found</h1>'), 404);
  const sample = Number(b.inst.is_sample) === 1;
  if (b.signer.signed_at) return html(page('Signed', `<h1>You signed this agreement</h1><p>${b.inst.status === 'executed' ? `<a href="/portal/agreements/${esc(id)}/certificate">View certificate</a>` : 'We\u2019ll let you know when the broker countersigns.'}</p><p><a class="btn" href="/portal/agreements">Back to my agreements</a> <a href="/portal">My portal</a></p>`));
  if (!['sent', 'partially_signed'].includes(b.inst.status)) return html(page('Not available', '<h1>Not available for signing</h1>'), 409);
  const body = `<h1>Something to review and sign</h1>${sample ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}
<p><a href="/portal/agreements">\u2190 Back to my agreements</a></p><section class="card" id="s1"><h2>1. Electronic records</h2><p>${esc(ERSD_TEXT)}</p><label><input type="checkbox" id="ersd" style="width:auto"> I agree</label><p><button class="btn" id="c1">Continue</button> <a href="/portal/agreements/${esc(id)}/agreement.pdf">Download PDF</a></p></section>
<div id="s2" hidden>
<section class="card" id="sg"><h2>2. Ohio Consumer Guide to Agency Relationships</h2><p class="muted">A separate state guide, not your agreement. Scroll to the end.</p><div class="doc" id="guide">${GUIDE_PARAGRAPHS.map(p => `<p>${esc(p)}</p>`).join('')}<p class="muted">\u2014 End of guide \u2014</p></div><p><a href="${GUIDE_PDF_PATH}" target="_blank" rel="noopener" id="gpdf">Open the official guide (PDF)</a></p><label><input type="checkbox" id="gack" style="width:auto" disabled> ${esc(GUIDE_ACK_TEXT)}</label></section>
<section class="card" id="sa"><h2>3. Read the whole agreement</h2><p class="muted">Scroll to the end to continue.</p>${docHtml(b.fields, sample)}
<label for="initials">Your initials</label><input id="initials" maxlength="4" autocomplete="off">
<h2>4. Your signature</h2><label><input type="radio" name="kind" value="typed" checked style="width:auto"> Type</label><label><input type="radio" name="kind" value="drawn" style="width:auto"> Draw</label>
<input id="typed" placeholder="Type your full name" autocomplete="off"><canvas id="pad" width="520" height="160" hidden></canvas><p><button type="button" id="clear" hidden>Clear</button></p>
<p><button class="btn" id="sign" disabled>Confirm guide receipt and sign with Face ID / passkey</button></p><p class="muted">One Face ID, Touch ID or PIN check confirms both: your receipt of the Consumer Guide and your signature, linked to these exact two documents.</p></section></div><p class="err" id="e"></p>`;
  const js = `${WEBAUTHN_BROWSER_JS}const id=${JSON.stringify(id)},csrf=${JSON.stringify(csrf)},NOPK=${JSON.stringify(NO_PASSKEY_MESSAGE)};const $=x=>document.getElementById(x),E=t=>$('e').textContent=t;
const post=(u,b)=>fetch(u,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({csrf,...b})}).then(async r=>{try{return await r.json()}catch(_){return{ok:false,error:'HTTP '+r.status}}});
let gseen=false,scrolled=false,strokes=[],cur=null;
$('c1').onclick=async()=>{if(!$('ersd').checked)return E('Please agree to electronic records, or contact HBE to sign on paper.');if(!await hbePasskeySupported())return E(NOPK);const j=await post('/api/portal/agreements/'+id+'/consent',{ersd:true});if(!j.ok)return E(j.error);$('s1').hidden=true;$('s2').hidden=false;E('')};
const gd=$('guide');gd.addEventListener('scroll',async()=>{if(!gseen&&gd.scrollTop+gd.clientHeight>=gd.scrollHeight-8){gseen=true;await post('/api/portal/agreements/'+id+'/guide/viewed',{viewed:true});$('gack').disabled=false;ready()}});
const d=$('doc');d.addEventListener('scroll',async()=>{if(!scrolled&&gseen&&d.scrollTop+d.clientHeight>=d.scrollHeight-8){scrolled=true;await post('/api/portal/agreements/'+id+'/viewed',{scrolled:true});ready()}});
const kind=()=>document.querySelector('input[name=kind]:checked').value;
const ready=()=>{$('sign').disabled=!(gseen&&$('gack').checked&&scrolled&&$('initials').value.trim().length>=2&&(kind()==='typed'?$('typed').value.trim().length>=2:strokes.length>0));if(!gseen)E('Read the Consumer Guide first (scroll to its end).');else if(!$('gack').checked)E('Check the box confirming you received the Consumer Guide.');else if(!scrolled)E('Scroll to the end of the agreement.');else E('')};
$('gack').onchange=ready;document.querySelectorAll('input[name=kind]').forEach(r=>r.onchange=()=>{const t=kind()==='typed';$('typed').hidden=!t;$('pad').hidden=t;$('clear').hidden=t;ready()});
['initials','typed'].forEach(k=>$(k).oninput=ready);
const pad=$('pad'),ctx=pad.getContext('2d');const pt=e=>{const r=pad.getBoundingClientRect();return[Math.round((e.clientX-r.left)*pad.width/r.width),Math.round((e.clientY-r.top)*pad.height/r.height)]};
pad.onpointerdown=e=>{cur=[pt(e)];pad.setPointerCapture(e.pointerId)};pad.onpointermove=e=>{if(!cur)return;const p=pt(e),l=cur[cur.length-1];cur.push(p);ctx.beginPath();ctx.moveTo(l[0],l[1]);ctx.lineTo(p[0],p[1]);ctx.stroke()};pad.onpointerup=()=>{if(cur&&cur.length>1)strokes.push(cur);cur=null;ready()};
$('clear').onclick=()=>{strokes=[];ctx.clearRect(0,0,pad.width,pad.height);ready()};
$('sign').onclick=async()=>{$('sign').disabled=true;const o=await post('/api/portal/agreements/'+id+'/sign/options',{});if(!o.ok){E(o.error==='no_passkey'?'Set up Face ID / passkey first \u2014 use the link that just appeared below; it brings you back here.':o.error);if(o.error==='no_passkey'){const a=document.createElement('a');a.className='btn';a.href='/portal/passkey?return='+encodeURIComponent('/portal/agreements?id='+id);a.textContent='Set up Face ID / passkey';$('e').after(a)}return ready()}
let cred;try{cred=await hbePasskeyGet(o.publicKey)}catch(x){E('Face ID / passkey check was cancelled. Nothing was signed.');return ready()}
const j=await post('/api/portal/agreements/'+id+'/sign',{challenge_id:o.challenge_id,credential:cred,guide_acknowledge:$('gack').checked,initials:$('initials').value,signature_kind:kind(),signature_text:$('typed').value,signature_strokes:strokes});if(j.ok)location='/portal/agreements';else{E(j.error);ready()}};`;
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
  if (!b.signer.guide_viewed_at) return { status: 409, error: 'consumer_guide_first' };
  if (body.scrolled !== true) return { status: 400, error: 'scroll_required' };
  await db(env).prepare(`UPDATE agreement_signers SET scrolled_at=COALESCE(scrolled_at,?) WHERE id=?`).bind(nowIso(), b.signer.id).run();
  await addEvent(env, id, 'scrolled_to_end', { signerId: b.signer.id, actor: 'buyer', request, docSha: b.inst.doc_sha256 });
  return { status: 200, ok: true };
}
export async function buyerSignOptions(env, session, id, url) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { status: 409, error: 'not_signable' };
  if (!b.signer.ersd_consent_at || !b.signer.guide_viewed_at || !b.signer.scrolled_at) return { status: 409, error: 'review_incomplete' };
  const creds = await credentialsFor(env, 'buyer', session.buyer_id);
  if (!creds.length) return { status: 409, error: 'no_passkey', message: NO_PASSKEY_MESSAGE };
  const bundle = await bundleSha(GUIDE_PDF_SHA256, b.inst.doc_sha256);
  const nonce = randomChallenge(); const challenge = await boundChallenge(bundle, b.signer.id, nonce);
  const ch = await newChallenge(env, 'sign', 'buyer', session.buyer_id, bundle, challenge);
  return { status: 200, ok: true, challenge_id: ch.id, doc_sha256: b.inst.doc_sha256, guide_sha256: GUIDE_PDF_SHA256, bundle_sha256: bundle, publicKey: assertionOptions({ rpId: rp(env, url).rpId, challenge, allowIds: creds.map(c => c.credential_id) }) };
}
// ---------------- Ohio Consumer Guide (shown first in the same signing session) ----------------
export function guidePdfBytes() { return Uint8Array.from(atob(GUIDE_PDF_B64), c => c.charCodeAt(0)); }
async function guideSigner(env, session, id) {
  const b = await buyerSigner(env, session, id); if (!b) return { error: { status: 404, error: 'not_found' } };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { error: { status: 409, error: 'not_signable' } };
  if (!b.signer.ersd_consent_at) return { error: { status: 409, error: 'consent_first' } };
  return { b };
}
export async function guideViewed(env, session, id, body, request) {
  const { b, error } = await guideSigner(env, session, id); if (error) return error;
  if (body.viewed !== true) return { status: 400, error: 'view_required' };
  await db(env).prepare(`UPDATE agreement_signers SET guide_viewed_at=COALESCE(guide_viewed_at,?) WHERE id=?`).bind(nowIso(), b.signer.id).run();
  await addEvent(env, id, 'consumer_guide_viewed', { signerId: b.signer.id, actor: 'buyer', request, docSha: GUIDE_PDF_SHA256, detail: { guide: GUIDE_ID, version: GUIDE_VERSION } });
  return { status: 200, ok: true };
}
function cleanStrokes(v) {
  if (!Array.isArray(v)) return null;
  const s = v.slice(0, 60).map(st => Array.isArray(st) ? st.slice(0, 400).map(p => [Math.max(0, Math.min(520, Math.round(Number(p?.[0]) || 0))), Math.max(0, Math.min(160, Math.round(Number(p?.[1]) || 0)))]) : []).filter(st => st.length > 1);
  return s.length ? s : null;
}
export async function buyerSign(env, session, id, body, request, url, send = sendWebPush) {
  const b = await buyerSigner(env, session, id); if (!b) return { status: 404, error: 'not_found' };
  if (!['sent', 'partially_signed'].includes(b.inst.status) || b.signer.signed_at) return { status: 409, error: 'not_signable' };
  if (!b.signer.ersd_consent_at || !b.signer.guide_viewed_at || !b.signer.scrolled_at) return { status: 409, error: 'review_incomplete' };
  if (body.guide_acknowledge !== true) return { status: 400, error: 'guide_receipt_required' };
  const initials = String(body.initials || '').trim().slice(0, 4);
  const kind = body.signature_kind === 'drawn' ? 'drawn' : body.signature_kind === 'typed' ? 'typed' : null;
  const text = String(body.signature_text || '').trim().slice(0, 80);
  const strokes = kind === 'drawn' ? cleanStrokes(body.signature_strokes) : null;
  if (initials.length < 2 || !kind || (kind === 'typed' && text.length < 2) || (kind === 'drawn' && !strokes)) return { status: 400, error: 'signature_incomplete' };
  // Passkey with user verification is mandatory; there is no other path.
  const ch = await takeChallenge(env, String(body.challenge_id || ''), 'sign', 'buyer', session.buyer_id);
  if (!ch) return { status: 400, error: 'challenge_invalid' };
  const bundle = await bundleSha(GUIDE_PDF_SHA256, b.inst.doc_sha256);
  if (ch.bound_sha256 !== bundle) return { status: 409, error: 'document_changed' };
  const creds = await credentialsFor(env, 'buyer', session.buyer_id);
  const cred = creds.find(c => c.credential_id === body.credential?.rawId || c.credential_id === body.credential?.id);
  if (!cred || !body.credential?.response) return { status: 400, error: 'passkey_required' };
  try { await useCredential(env, cred, body.credential.response, ch.challenge, rp(env, url)); }
  catch (e) { await addEvent(env, id, 'passkey_failed', { signerId: b.signer.id, actor: 'buyer', request, detail: { reason: e.message } }); return { status: 400, error: 'passkey_failed' }; }
  const at = nowIso();
  // Guide receipt and agreement signature are recorded together from the single assertion.
  const upd = await db(env).prepare(`UPDATE agreement_signers SET guide_version=?, guide_sha256=?, guide_ack_at=COALESCE(guide_ack_at,?), guide_passkey_credential_id=?, signed_at=?, signature_kind=?, signature_text=?, signature_strokes=?, initials=?, passkey_credential_id=? WHERE id=? AND signed_at IS NULL`)
    .bind(GUIDE_VERSION, GUIDE_PDF_SHA256, at, cred.credential_id, at, kind, kind === 'typed' ? text : null, strokes ? JSON.stringify(strokes) : null, initials, cred.credential_id, b.signer.id).run();
  if (!upd?.meta?.changes) return { status: 409, error: 'already_signed' };
  const shared = { passkey: cred.credential_id.slice(0, 12), uv: true, bundle_sha256: bundle, single_assertion: true };
  await addEvent(env, id, 'consumer_guide_acknowledged', { signerId: b.signer.id, actor: 'buyer', request, docSha: GUIDE_PDF_SHA256, detail: { guide: GUIDE_ID, version: GUIDE_VERSION, ...shared } });
  await addEvent(env, id, 'buyer_signed', { signerId: b.signer.id, actor: 'buyer', request, docSha: b.inst.doc_sha256, detail: { kind, guide_sha256: GUIDE_PDF_SHA256, ...shared } });
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
  return html(page('Certificate', `<h1>Certificate of completion</h1>${Number(b.inst.is_sample) ? `<div class="sample">${esc(SAMPLE_WATERMARK)}</div>` : ''}<div class="card"><p>Agreement ${esc(id)}</p><p class="muted">Document SHA-256 ${esc(b.inst.doc_sha256)}<br>Consumer Guide PDF SHA-256 ${esc(GUIDE_PDF_SHA256)}<br>${b.signers.filter(s => s.role === 'buyer').map(s => `Consumer Guide receipt: ${esc(signerName(s))} ${s.guide_ack_at ? esc(s.guide_ack_at) + ' (UTC)' : 'not recorded'}`).join('<br>')}<br>Signed PDF SHA-256 ${esc(b.inst.final_sha256)}<br>Audit chain ${chain ? 'intact' : 'BROKEN'}</p><ul>${ev.map(e => `<li>${esc(e.at)} \u2014 ${esc(e.event)}${e.signer_label ? ' \u2014 ' + esc(e.signer_label) : ''}</li>`).join('')}</ul><a class="btn" href="/portal/agreements/${esc(id)}/agreement.pdf">Download signed PDF</a></div><p><a class="btn" href="/portal/agreements">Back to my agreements</a></p>`));
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
  if (request.method === 'GET' && p === GUIDE_PDF_PATH) return new Response(guidePdfBytes(), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="Ohio-Consumer-Guide-to-Agency-Relationships.pdf"', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
  const session = await buyerSession(request, env);
  if (!session) return request.method === 'GET' ? Response.redirect(new URL('/login', url).toString(), 302) : json({ ok: false, error: 'auth_required' }, 401);
  let m;
  if (request.method === 'GET') {
    if (p === '/portal/agreements') return buyerSignPage(env, session, url);
    if (p === '/portal/passkey') { const csrf = await mutationCsrfToken(session.token); const { body, js } = await passkeyPage(env, 'buyer', session.buyer_id, url); return html(page('Passkey', body, `window.__csrf=${JSON.stringify(csrf)};${js}`)); }
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
  if ((m = p.match(/^\/api\/portal\/agreements\/([0-9a-f-]{36})\/(consent|viewed|guide\/viewed|sign\/options|sign)$/))) {
    const [, id, action] = m;
    if (action === 'consent') return out(await buyerConsent(env, session, id, body, request));
    if (action === 'guide/viewed') return out(await guideViewed(env, session, id, body, request));
    if (action === 'viewed') return out(await buyerViewed(env, session, id, body, request));
    if (action === 'sign/options') return out(await buyerSignOptions(env, session, id, url));
    return out(await buyerSign(env, session, id, body, request, url, opts.send));
  }
  return null;
}

export function isAgreementPath(pathname) {
  return pathname.startsWith('/hbe/agreements') || pathname === '/hbe/passkey' || pathname.startsWith('/api/hbe/agreements') || pathname.startsWith('/api/hbe/passkey/')
    || pathname.startsWith('/portal/agreements') || pathname === '/portal/passkey' || pathname === GUIDE_PDF_PATH || pathname === '/portal/app.webmanifest' || pathname === '/portal/app-sw.js'
    || pathname.startsWith('/api/portal/agreements/') || pathname.startsWith('/api/portal/passkey/') || pathname === '/api/portal/push/subscribe';
}

export async function handleAgreements(request, env, url, opts = {}) {
  if (!env.BUYER_DB) return json({ ok: false, error: 'db_unavailable' }, 503);
  const isStaff = url.pathname.startsWith('/hbe/') || url.pathname.startsWith('/api/hbe/');
  const res = isStaff ? await handleStaff(request, env, url, opts) : await handleBuyer(request, env, url, opts);
  return res || json({ ok: false, error: 'not_found' }, 404);
}
