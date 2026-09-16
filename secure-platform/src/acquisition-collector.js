/**
 * Privacy-safe first-party acquisition collector (Issue #74).
 *
 * Persists AGGREGATE counters only (day + event + channel + campaign + entry_page).
 * Rejects unknown events/fields, PII-like values, oversized bodies, and unapproved origins.
 * Never stores names, emails, phones, free text, household/buyer IDs, IP, UA, or full referrers.
 */

export const ALLOWED_EVENTS = Object.freeze([
  'discovery_view',
  'journey_entry_click',
  'consultation_cta_click',
  'journey_start',
  'experience_complete'
]);

export const PUBLIC_EVENTS = Object.freeze([
  'discovery_view',
  'journey_entry_click',
  'consultation_cta_click'
]);

export const MILESTONE_EVENTS = Object.freeze([
  'journey_start',
  'experience_complete'
]);

export const PAYLOAD_KEYS = Object.freeze([
  'event', 'page_path', 'channel', 'utm_source', 'utm_medium',
  'utm_campaign', 'referrer_host', 'ts', 'dest_path'
]);

export const CHANNELS = Object.freeze([
  'paid', 'referral', 'local', 'relocation', 'organic', 'direct', 'unknown'
]);

export const ALLOWED_ORIGINS = Object.freeze([
  'https://hbexperts.com',
  'https://www.hbexperts.com',
  'https://buyer.hbexperts.com'
]);

export const MAX_BODY_BYTES = 2048;
export const MAX_UTM_LEN = 64;
export const MAX_PATH_LEN = 128;
export const MAX_HOST_LEN = 253;
export const ACQ_COOKIE = 'hbe_acq';
export const COLLECT_PATH = '/api/acquisition/collect';
export const REPORT_PATH = '/hbe/acquisition';
export const REPORT_JSON_PATH = '/api/hbe/acquisition';

const SENSITIVE_KEY_RE = /^(email|phone|name|first_name|last_name|full_name|household|household_id|questionnaire|answers|ssn|address|buyer_id|ip|ua|user_agent|user-agent|cookie|authorization|cf-connecting-ip)$/i;

function looksLikeEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(value || ''));
}

function looksLikePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function sanitizeUtm(value) {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s) return '';
  if (/@/.test(s) || looksLikeEmail(s)) return '';
  if (looksLikePhone(s)) return '';
  if (/^https?:\/\//i.test(s)) return '';
  if (/[\u0000-\u001f]/.test(s)) return '';
  if (s.length > MAX_UTM_LEN) s = s.slice(0, MAX_UTM_LEN);
  return s;
}

export function sanitizePath(value) {
  if (value == null) return '';
  let s = String(value).split('?')[0].split('#')[0].trim();
  if (!s) return '';
  if (s.charAt(0) !== '/') s = '/' + s;
  if (s.length > MAX_PATH_LEN) s = s.slice(0, MAX_PATH_LEN);
  if (s.indexOf('..') !== -1) return '';
  if (!/^\/[A-Za-z0-9/_\-.~]*$/.test(s)) return '';
  return s;
}

export function normalizeChannel(value) {
  const c = String(value || '').toLowerCase();
  return CHANNELS.includes(c) ? c : 'unknown';
}

export function sanitizeReferrerHost(value) {
  if (!value) return '';
  let host = String(value).toLowerCase().trim();
  if (!host || host.indexOf('..') !== -1) return '';
  if (/[:/@\s]/.test(host)) return '';
  if (host.length > MAX_HOST_LEN) host = host.slice(0, MAX_HOST_LEN);
  if (!/^[a-z0-9.-]+$/.test(host)) return '';
  return host;
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const o = new URL(origin).origin;
    return ALLOWED_ORIGINS.includes(o);
  } catch {
    return false;
  }
}

export function isBuyerOrigin(origin, requestUrl) {
  if (!origin || !requestUrl) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Validate and strip a public collector payload down to allowlisted fields.
 * Returns { ok:true, record } or { ok:false, status, error }.
 */
export function validateCollectorPayload(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'invalid_payload' };
  }

  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!PAYLOAD_KEYS.includes(key)) {
      return { ok: false, status: 400, error: 'unknown_field' };
    }
    if (SENSITIVE_KEY_RE.test(key)) {
      return { ok: false, status: 400, error: 'sensitive_field' };
    }
  }

  const event = String(raw.event || '');
  if (!PUBLIC_EVENTS.includes(event)) {
    return { ok: false, status: 400, error: 'unknown_event' };
  }

  const page_path = sanitizePath(raw.page_path) || '/';
  const channel = normalizeChannel(raw.channel);
  const record = { event, page_path, channel };

  const source = sanitizeUtm(raw.utm_source);
  const medium = sanitizeUtm(raw.utm_medium);
  const campaign = sanitizeUtm(raw.utm_campaign);
  const host = sanitizeReferrerHost(raw.referrer_host);
  const dest = raw.dest_path != null ? sanitizePath(raw.dest_path) : '';

  // Reject if original optional fields looked like PII (sanitize emptied them).
  if (raw.utm_source != null && String(raw.utm_source).trim() && !source) {
    return { ok: false, status: 400, error: 'sensitive_value' };
  }
  if (raw.utm_medium != null && String(raw.utm_medium).trim() && !medium) {
    return { ok: false, status: 400, error: 'sensitive_value' };
  }
  if (raw.utm_campaign != null && String(raw.utm_campaign).trim() && !campaign) {
    return { ok: false, status: 400, error: 'sensitive_value' };
  }
  if (raw.referrer_host != null && String(raw.referrer_host).trim() && !host) {
    return { ok: false, status: 400, error: 'sensitive_value' };
  }
  if (raw.page_path != null && String(raw.page_path).trim() && !sanitizePath(raw.page_path)) {
    return { ok: false, status: 400, error: 'sensitive_value' };
  }

  if (source) record.utm_source = source;
  if (medium) record.utm_medium = medium;
  if (campaign) record.utm_campaign = campaign;
  if (host) record.referrer_host = host;
  if (dest) record.dest_path = dest;

  if (raw.ts != null) {
    const ts = String(raw.ts).trim();
    if (ts && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(ts)) {
      return { ok: false, status: 400, error: 'invalid_ts' };
    }
    if (ts) record.ts = ts;
  }

  return { ok: true, record };
}

export function dayKey(isoOrDate = new Date()) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function aggregateDims(record) {
  return {
    day: dayKey(record.ts || new Date()),
    event: record.event,
    channel: normalizeChannel(record.channel),
    campaign: sanitizeUtm(record.utm_campaign || record.campaign || '') || '',
    entry_page: sanitizePath(record.page_path || record.entry_page || '') || '/'
  };
}

/** Increment aggregate counter. Never stores identity fields. */
export async function incrementAggregate(db, record) {
  if (!db) return { ok: false, error: 'no_db' };
  const dims = aggregateDims(record);
  // Ensure only aggregate columns touch the DB.
  const safe = {
    day: String(dims.day).slice(0, 10),
    event: String(dims.event).slice(0, 64),
    channel: String(dims.channel).slice(0, 32),
    campaign: String(dims.campaign).slice(0, MAX_UTM_LEN),
    entry_page: String(dims.entry_page).slice(0, MAX_PATH_LEN)
  };
  await db.prepare(
    `INSERT INTO acquisition_daily_counts (day, event, channel, campaign, entry_page, count)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(day, event, channel, campaign, entry_page)
     DO UPDATE SET count = count + 1`
  ).bind(safe.day, safe.event, safe.channel, safe.campaign, safe.entry_page).run();
  return { ok: true, dims: safe };
}

export async function listAggregates(db, { days = 30 } = {}) {
  if (!db) return [];
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  const result = await db.prepare(
    `SELECT day, event, channel, campaign, entry_page, count
     FROM acquisition_daily_counts
     WHERE day >= ?
     ORDER BY day DESC, event ASC, channel ASC, campaign ASC, entry_page ASC`
  ).bind(since).all();
  return result?.results || [];
}

export function readAttributionParams(url) {
  const params = url instanceof URL ? url.searchParams : new URL(String(url)).searchParams;
  const rawCh = params.get('hbe_ch');
  const channel = rawCh != null && String(rawCh).trim() !== ''
    ? normalizeChannel(rawCh)
    : 'direct';
  const entry_page = sanitizePath(params.get('hbe_lp')) || '/';
  const campaign = sanitizeUtm(params.get('hbe_ft') || '');
  // Strip / ignore anything else — only return approved tokens.
  return { channel, entry_page, campaign };
}

export function parseAcqCookie(headerValue) {
  if (!headerValue) return null;
  const parts = String(headerValue).split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== ACQ_COOKIE) continue;
    const raw = decodeURIComponent(rest.join('=') || '');
    const sp = new URLSearchParams(raw);
    return {
      channel: normalizeChannel(sp.get('ch')),
      entry_page: sanitizePath(sp.get('lp')) || '/',
      campaign: sanitizeUtm(sp.get('ft') || '')
    };
  }
  return null;
}

export function buildAcqCookieValue(attrs) {
  const sp = new URLSearchParams();
  sp.set('ch', normalizeChannel(attrs.channel));
  sp.set('lp', sanitizePath(attrs.entry_page) || '/');
  const ft = sanitizeUtm(attrs.campaign || '');
  if (ft) sp.set('ft', ft);
  return sp.toString();
}

export function acqCookieHeader(attrs) {
  const value = encodeURIComponent(buildAcqCookieValue(attrs));
  return `${ACQ_COOKIE}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=86400; HttpOnly`;
}

export function isHbe(request, env) {
  const email = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '')
    .trim()
    .toLowerCase();
  const admin = String(env?.HBE_ADMIN_EMAIL || '').trim().toLowerCase();
  return !!email && !!admin && email === admin;
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate-limit the collector. Uses SUBMIT_RATE_LIMITER when bound.
 * Key is a hash — IP is never persisted to acquisition tables.
 * Fail closed when the limiter reports unsuccessful.
 */
export async function rateLimitCollect(request, env) {
  if (!env?.SUBMIT_RATE_LIMITER) return { ok: true, skipped: true };
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const key = await sha256Hex(`acq-collect:${ip.split(',')[0].trim()}`);
  try {
    const { success } = await env.SUBMIT_RATE_LIMITER.limit({ key });
    if (!success) return { ok: false, status: 429, error: 'rate_limited' };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: 'rate_limiter_unavailable' };
  }
}

export async function handleCollectOptions(request) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function handleCollectPost(request, env) {
  const origin = request.headers.get('Origin') || '';
  const buyerSame = isBuyerOrigin(origin, request.url);
  if (!isAllowedOrigin(origin) && !buyerSame) {
    return jsonResponse({ ok: false, error: 'origin_rejected' }, 403);
  }

  const limited = await rateLimitCollect(request, env);
  if (!limited.ok) {
    return jsonResponse({ ok: false, error: limited.error }, limited.status, corsHeaders(origin));
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: 'oversized' }, 413, corsHeaders(origin));
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: 'unreadable_body' }, 400, corsHeaders(origin));
  }
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: 'oversized' }, 413, corsHeaders(origin));
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400, corsHeaders(origin));
  }

  const validated = validateCollectorPayload(raw);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: validated.error }, validated.status, corsHeaders(origin));
  }

  if (!env?.BUYER_DB) {
    return jsonResponse({ ok: false, error: 'db_unavailable' }, 503, corsHeaders(origin));
  }

  try {
    await incrementAggregate(env.BUYER_DB, validated.record);
  } catch (err) {
    console.error('acquisition collect persist failed', err);
    return jsonResponse({ ok: false, error: 'persist_failed' }, 500, corsHeaders(origin));
  }

  return new Response(null, { status: 204, headers: { ...corsHeaders(origin), 'cache-control': 'no-store' } });
}

/**
 * Secure-side journey_start milestone: aggregate only from approved query tokens.
 * Returns Set-Cookie header value when attribution present.
 */
export async function recordJourneyStart(env, url) {
  if (!env?.BUYER_DB) return { cookie: null };
  const attrs = readAttributionParams(url);
  const record = {
    event: 'journey_start',
    channel: attrs.channel,
    page_path: attrs.entry_page || '/',
    utm_campaign: attrs.campaign || '',
    ts: new Date().toISOString()
  };
  try {
    await incrementAggregate(env.BUYER_DB, record);
  } catch (err) {
    console.error('acquisition journey_start failed', err);
  }
  return {
    cookie: acqCookieHeader({
      channel: attrs.channel,
      entry_page: attrs.entry_page,
      campaign: attrs.campaign
    })
  };
}

export async function recordExperienceComplete(env, request) {
  if (!env?.BUYER_DB) return;
  const fromCookie = parseAcqCookie(request.headers.get('Cookie') || '');
  const record = {
    event: 'experience_complete',
    channel: fromCookie?.channel || 'unknown',
    page_path: fromCookie?.entry_page || '/',
    utm_campaign: fromCookie?.campaign || '',
    ts: new Date().toISOString()
  };
  try {
    await incrementAggregate(env.BUYER_DB, record);
  } catch (err) {
    console.error('acquisition experience_complete failed', err);
  }
}

export function renderReportHtml(rows) {
  const funnel = { discovery_view: 0, journey_entry_click: 0, consultation_cta_click: 0, journey_start: 0, experience_complete: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(funnel, row.event)) {
      funnel[row.event] += Number(row.count) || 0;
    }
  }
  const bodyRows = rows.map(r => `<tr>
    <td>${esc(r.day)}</td>
    <td>${esc(r.event)}</td>
    <td>${esc(r.channel)}</td>
    <td>${esc(r.campaign || '—')}</td>
    <td>${esc(r.entry_page)}</td>
    <td>${esc(String(r.count))}</td>
  </tr>`).join('') || '<tr><td colspan="6">No aggregate counts yet.</td></tr>';

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Acquisition funnel (aggregate) | HBE</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:1.5rem;color:#1a1a2e;background:#faf9f6}
h1{font:600 1.6rem Georgia,serif;margin:0 0 .4rem}
.lede{color:#555;max-width:42rem}
.funnel{display:flex;flex-wrap:wrap;gap:.75rem;margin:1.2rem 0}
.funnel div{background:#fff;border:1px solid #e8e5e0;border-radius:10px;padding:.75rem 1rem;min-width:8rem}
.funnel small{display:block;color:#6b6b6b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.7rem}
.funnel strong{font-size:1.35rem}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e8e5e0;border-radius:10px;overflow:hidden}
th,td{padding:.55rem .7rem;border-bottom:1px solid #eee;text-align:left;font-size:.9rem}
th{background:#f0efe9;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
.note{margin-top:1rem;color:#666;font-size:.85rem;max-width:46rem}
a{color:#2d5a3d}
</style></head><body>
<p><a href="/hbe">← HBE</a></p>
<h1>Acquisition funnel (aggregate)</h1>
<p class="lede">Coarse public entry → Buyer Journey start → Buyer Experience completion. Counts only — no buyer or household identifiers.</p>
<div class="funnel">
  <div><small>Public discovery</small><strong>${funnel.discovery_view}</strong></div>
  <div><small>Journey click</small><strong>${funnel.journey_entry_click}</strong></div>
  <div><small>Consultation CTA</small><strong>${funnel.consultation_cta_click}</strong></div>
  <div><small>Journey start</small><strong>${funnel.journey_start}</strong></div>
  <div><small>Experience complete</small><strong>${funnel.experience_complete}</strong></div>
</div>
<table>
<thead><tr><th>Day (UTC)</th><th>Event</th><th>Channel</th><th>Campaign</th><th>Entry page</th><th>Count</th></tr></thead>
<tbody>${bodyRows}</tbody>
</table>
<p class="note">Collected: allowlisted event name, channel, sanitized campaign token, entry page path, day bucket, count.
Not collected: names, emails, phones, free text, questionnaire answers, household/buyer IDs, IP, user-agent, full referrers, or advertising IDs.</p>
</body></html>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export async function handleReport(request, env, { json = false } = {}) {
  if (!isHbe(request, env)) {
    return new Response('HBE access required', {
      status: 403,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow, noarchive'
      }
    });
  }
  if (!env?.BUYER_DB) {
    return json
      ? jsonResponse({ ok: false, error: 'db_unavailable' }, 503)
      : new Response('Database unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const rows = await listAggregates(env.BUYER_DB, { days: 30 });
  // Defense: never include unexpected columns from a misconfigured query.
  const safeRows = rows.map(r => ({
    day: r.day,
    event: r.event,
    channel: r.channel,
    campaign: r.campaign,
    entry_page: r.entry_page,
    count: r.count
  }));
  if (json) {
    return jsonResponse({ ok: true, rows: safeRows });
  }
  return new Response(renderReportHtml(safeRows), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive'
    }
  });
}

/**
 * Top-level route handler for acquisition collector / report / milestones.
 * Returns a Response when handled, or null to continue the chain.
 */
export async function handleAcquisitionRoutes(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' && url.pathname === COLLECT_PATH) {
    return handleCollectOptions(request);
  }
  if (request.method === 'POST' && url.pathname === COLLECT_PATH) {
    return handleCollectPost(request, env);
  }
  if (request.method === 'GET' && url.pathname === REPORT_PATH) {
    return handleReport(request, env, { json: false });
  }
  if (request.method === 'GET' && url.pathname === REPORT_JSON_PATH) {
    return handleReport(request, env, { json: true });
  }

  return null;
}

/**
 * After downstream fetch: attach journey_start cookie on public journey landing,
 * and record experience_complete on successful intake.
 */
export async function afterAcquisitionSideEffects(request, env, response, ctx) {
  const url = new URL(request.url);
  let out = response;

  if (request.method === 'GET' && url.pathname === '/' && response.status === 200) {
    const { cookie } = await recordJourneyStart(env, url);
    if (cookie) {
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', cookie);
      out = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/intake' && response.status >= 200 && response.status < 400) {
    // Fire-and-forget aggregate; do not block or alter buyer response body.
    const p = recordExperienceComplete(env, request);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    else await p;
  }

  return out;
}

export default {
  handleAcquisitionRoutes,
  afterAcquisitionSideEffects,
  validateCollectorPayload,
  incrementAggregate,
  isHbe,
  ALLOWED_EVENTS,
  PAYLOAD_KEYS
};
