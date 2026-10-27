// Durable email alerts for completed buyer actions in the Buyer UI.
// Separate from notifications so the HBEUI "new submission" list is unchanged.
const LEASE_MS = 2 * 60 * 1000;
const OVERDUE_MS = 10 * 60 * 1000;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;
const PORTAL_URL = 'https://buyer.hbexperts.com/hbe';

// Completed buyer actions only. Not page views, drafts, logins, or HBE-staff routes.
// /api/intake is alerted by submission-alerts.js (buyers@ + cwhitehead@).
export const BUYER_ACTIONS = {
  '/api/representation/choice': 'Made a buyer-representation choice',
  '/api/household/invite': 'Invited a co-buyer',
  '/api/household/invite/revoke': 'Revoked a co-buyer invitation',
  '/api/portal/checklist/toggle': 'Updated a journey checklist item',
  '/api/portal/bimatrix-refresh': 'Requested a Possible Assistance update',
  '/api/search/profile': 'Saved their home-search profile',
  '/api/search/confirm': 'Confirmed their home-search profile'
};

export function isBuyerAction(request, url) {
  return request.method === 'POST' && Object.prototype.hasOwnProperty.call(BUYER_ACTIONS, url.pathname);
}

export function activityRecipients(env) {
  const to = String(env.HBE_ACTIVITY_ALERT_TO || env.HBE_ALERT_TO || env.HBE_ADMIN_EMAIL || 'cwhitehead@hbexperts.com')
    .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  return [...new Set(to)];
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function cookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

// Must be called BEFORE the request body is consumed by the app worker.
export async function captureBuyerAction(request, env, url) {
  try {
    const token = cookie(request, 'hbe_session');
    if (!token || !env.BUYER_DB) return null;
    const row = await env.BUYER_DB.prepare('SELECT s.buyer_id FROM buyer_sessions s WHERE s.token_hash=? AND s.expires_at>? LIMIT 1')
      .bind(await sha256(token), new Date().toISOString()).first();
    if (!row?.buyer_id) return null;
    const body = await request.clone().text().catch(() => '');
    return { buyerId: row.buyer_id, path: url.pathname, bodyHash: await sha256(body) };
  } catch (error) {
    console.error(JSON.stringify({ event: 'buyer_activity_capture_failed', error_code: 'CAPTURE_FAILED' }));
    return null;
  }
}

export function completedStatus(status) {
  return status >= 200 && status < 400;
}

export async function enqueueBuyerActivity(env, captured, now = new Date()) {
  if (!captured) return null;
  const bucket = Math.floor(now.getTime() / DEDUPE_WINDOW_MS);
  const id = await sha256(`${captured.buyerId}|${captured.path}|${captured.bodyHash}|${bucket}`);
  const res = await env.BUYER_DB.prepare(`INSERT OR IGNORE INTO buyer_activity_alerts (id,buyer_id,action,status,attempts,created_at) VALUES (?,?,?,'pending',0,?)`)
    .bind(id, captured.buyerId, captured.path, now.toISOString()).run();
  return res?.meta?.changes ? id : null;
}

export async function deliverBuyerActivityAlert(env, id) {
  const now = new Date();
  const nowIso = now.toISOString();
  const claim = await env.BUYER_DB.prepare(`UPDATE buyer_activity_alerts
    SET status='sending', attempts=attempts+1, last_attempt_at=?, lease_until=?, error_code=NULL
    WHERE id=? AND (status IN ('pending','failed') OR (status='sending' AND lease_until<?))`)
    .bind(nowIso, new Date(now.getTime() + LEASE_MS).toISOString(), id, nowIso).run();
  if (!claim?.meta?.changes) return { status: 'skipped' };
  const row = await env.BUYER_DB.prepare(`SELECT a.id,a.action,a.created_at,a.buyer_id,b.first_name,b.last_name
    FROM buyer_activity_alerts a JOIN buyers b ON b.id=a.buyer_id WHERE a.id=? LIMIT 1`).bind(id).first();
  if (!row) return fail(env, id, 'ACTIVITY_NOT_FOUND');
  if (!env.HBE_ALERT) return fail(env, id, 'EMAIL_BINDING_MISSING');
  const label = BUYER_ACTIONS[row.action] || 'Completed an action';
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'A buyer';
  try {
    const result = await env.HBE_ALERT.send({
      to: activityRecipients(env),
      from: env.HBE_ALERT_FROM || 'buyer-alerts@hbexperts.com',
      subject: `HBE buyer activity: ${name} - ${label}`,
      text: `${name} completed an action in the HBE Buyer UI.\n\nAction: ${label}\nWhen: ${row.created_at}\n\nReview in the protected HBEUI: ${PORTAL_URL}\nDetails are intentionally not copied into this email.`,
      headers: { 'X-HBE-Activity-ID': String(row.id) }
    });
    await env.BUYER_DB.prepare(`UPDATE buyer_activity_alerts SET status='sent', sent_at=?, lease_until=NULL, error_code=NULL, provider_message_id=? WHERE id=?`)
      .bind(new Date().toISOString(), String(result?.messageId || '').slice(0, 200), id).run();
    console.log(JSON.stringify({ event: 'buyer_activity_alert_sent', activity_id: id }));
    return { status: 'sent' };
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    return fail(env, id, /^E_[A-Z0-9_]{1,60}$/.test(code) ? code : 'EMAIL_SEND_FAILED');
  }
}

export async function processBuyerActivityBacklog(env) {
  const nowIso = new Date().toISOString();
  const rows = await env.BUYER_DB.prepare(`SELECT id FROM buyer_activity_alerts
    WHERE status IN ('pending','failed') OR (status='sending' AND lease_until<?) ORDER BY created_at ASC LIMIT ?`).bind(nowIso, LIMIT).all();
  let sent = 0;
  for (const r of rows.results || []) if ((await deliverBuyerActivityAlert(env, r.id)).status === 'sent') sent++;
  return { attempted: (rows.results || []).length, sent };
}

export async function buyerActivityOverdue(env) {
  const row = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS count FROM buyer_activity_alerts WHERE status!='sent' AND created_at<?`)
    .bind(new Date(Date.now() - OVERDUE_MS).toISOString()).first();
  return Number(row?.count || 0);
}

async function fail(env, id, code) {
  await env.BUYER_DB.prepare(`UPDATE buyer_activity_alerts SET status='failed', lease_until=NULL, error_code=? WHERE id=?`).bind(code, id).run();
  console.error(JSON.stringify({ event: 'buyer_activity_alert_failed', activity_id: id, error_code: code }));
  return { status: 'failed', code };
}