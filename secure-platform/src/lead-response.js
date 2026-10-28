// Lead response tracking (Oct 27 2026 audit fixes 2 + 3).
// - Escalates a push to the owner when an intake alert email is still unsent 15 minutes
//   after the lead was saved (recorded once per lead in hbe_lead_status.escalated_at).
// - Owner-only, CSRF-protected Acknowledge / Assign / Mark responded actions for HBEUI.
// - "Unacknowledged leads" and "alert delayed" markers for HBEUI and /hbe/app.
import { requireOwner, enqueuePushAlert, deliverPushAlert } from './hbe-push.js';
import { assertMutationCsrf, mutationCsrfToken } from './household-state.js';

export const ESCALATE_MS = 15 * 60 * 1000;
export const LEAD_TYPE = 'buyer_experience_submitted';
export const LEAD_ACTION_PREFIX = '/api/hbe/lead/';
const ACTIONS = new Set(['acknowledge', 'assign', 'responded']);
const ROBOTS = 'noindex, nofollow';

export function defaultAssignee(env) {
  return String(env.HBE_LEAD_DEFAULT_ASSIGNEE || 'cwhitehead@hbexperts.com').trim().toLowerCase();
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': ROBOTS } });

// ---------- alert-delay marker ----------
export function alertDelay(row, now = Date.now()) {
  if (!row || !row.alert_status) return null;
  const created = Date.parse(row.alert_created_at || row.submitted_at || '');
  if (!Number.isFinite(created)) return null;
  if (row.alert_status !== 'sent') {
    const age = now - created;
    return age > ESCALATE_MS ? { kind: 'delayed', minutes: Math.floor(age / 60000) } : null;
  }
  const sent = Date.parse(row.sent_at || '');
  if (Number.isFinite(sent) && sent - created > ESCALATE_MS) return { kind: 'late', minutes: Math.floor((sent - created) / 60000) };
  return null;
}

// ---------- escalation (runs in the 5-minute cron) ----------
export async function processAlertEscalations(env, { now = Date.now(), deliver = deliverPushAlert, pushOpts } = {}) {
  const cutoff = new Date(now - ESCALATE_MS).toISOString();
  const rows = (await env.BUYER_DB.prepare(`SELECT n.id AS notification_id, n.buyer_id, d.created_at
    FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
    LEFT JOIN hbe_lead_status s ON s.buyer_id=n.buyer_id
    WHERE n.type=? AND d.status!='sent' AND d.created_at<? AND s.escalated_at IS NULL AND s.acknowledged_at IS NULL AND COALESCE(s.spam_flag,0)=0
    ORDER BY d.created_at ASC LIMIT 20`).bind(LEAD_TYPE, cutoff).all()).results || [];
  let escalated = 0;
  for (const r of rows) {
    const nowIso = new Date(now).toISOString();
    const claim = await env.BUYER_DB.prepare(`INSERT INTO hbe_lead_status (buyer_id,notification_id,assigned_to,escalated_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(buyer_id) DO UPDATE SET escalated_at=excluded.escalated_at, updated_at=excluded.updated_at
      WHERE hbe_lead_status.escalated_at IS NULL`).bind(r.buyer_id, r.notification_id, defaultAssignee(env), nowIso, nowIso, nowIso).run();
    if (!claim?.meta?.changes) continue;
    escalated++;
    await logEvent(env, r.buyer_id, 'escalated', 'system', 'alert_email_unsent_15m', nowIso);
    console.error(JSON.stringify({ event: 'lead_alert_escalated', notification_id: r.notification_id }));
    try {
      const id = await enqueuePushAlert(env, 'intake', `delayed:${r.notification_id}`, r.buyer_id, 'alert_delayed', nowIso);
      if (id) await deliver(env, id, pushOpts);
    } catch {
      console.error(JSON.stringify({ event: 'lead_escalation_push_failed', notification_id: r.notification_id }));
    }
  }
  return { checked: rows.length, escalated };
}

async function logEvent(env, buyerId, kind, actor, detail, at = new Date().toISOString()) {
  await env.BUYER_DB.prepare(`INSERT INTO hbe_lead_events (buyer_id,kind,actor,detail,created_at) VALUES (?,?,?,?,?)`)
    .bind(buyerId, kind, actor || null, detail || null, at).run();
}

// ---------- spam flag (fix 4) ----------
export async function flagSuspectedSpam(env, buyerId, reason) {
  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO hbe_lead_status (buyer_id,assigned_to,spam_flag,spam_reason,created_at,updated_at) VALUES (?,?,1,?,?,?)
    ON CONFLICT(buyer_id) DO UPDATE SET spam_flag=1, spam_reason=excluded.spam_reason, updated_at=excluded.updated_at`)
    .bind(buyerId, defaultAssignee(env), String(reason || 'suspected').slice(0, 60), now, now).run();
  await logEvent(env, buyerId, 'spam_flagged', 'system', String(reason || '').slice(0, 60), now);
}

// ---------- counts / list ----------
export async function leadCounts(env, now = Date.now()) {
  const cutoff = new Date(now - ESCALATE_MS).toISOString();
  const unack = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM notifications n LEFT JOIN hbe_lead_status s ON s.buyer_id=n.buyer_id
    WHERE n.type=? AND s.acknowledged_at IS NULL AND COALESCE(s.spam_flag,0)=0`).bind(LEAD_TYPE).first();
  const delayed = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
    WHERE n.type=? AND d.status!='sent' AND d.created_at<?`).bind(LEAD_TYPE, cutoff).first();
  return { unacknowledged: Number(unack?.c || 0), alertDelayed: Number(delayed?.c || 0) };
}

export async function listLeads(env, limit = 25) {
  return (await env.BUYER_DB.prepare(`SELECT n.buyer_id, b.first_name, b.last_name, b.submitted_at,
      d.status AS alert_status, d.created_at AS alert_created_at, d.sent_at, d.attempts, d.last_error,
      s.assigned_to, s.acknowledged_at, s.acknowledged_by, s.first_response_at, s.escalated_at, s.spam_flag, s.spam_reason
    FROM notifications n JOIN buyers b ON b.id=n.buyer_id
    LEFT JOIN notification_deliveries d ON d.notification_id=n.id
    LEFT JOIN hbe_lead_status s ON s.buyer_id=n.buyer_id
    WHERE n.type=? ORDER BY n.created_at DESC LIMIT ?`).bind(LEAD_TYPE, limit).all()).results || [];
}

const fmt = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''; };

export const LEAD_PANEL_CSS = `<style id="hbe-lead-response-css">
.hbe-leads{max-width:1100px;margin:1rem auto;padding:1rem 1.1rem;border:1px solid #dfe8e2;border-left:5px solid #2d5a3d;border-radius:12px;background:#fff;color:#1a1a2e;font:15px/1.45 -apple-system,system-ui,sans-serif}
.hbe-leads h2{margin:0 0 .4rem;font-size:1.15rem}.hbe-leads .counts{display:flex;gap:.6rem;flex-wrap:wrap;margin:.2rem 0 .8rem}
.hbe-leads .pill{display:inline-block;padding:.25rem .65rem;border-radius:999px;background:#eef3f0;font-weight:700}.hbe-leads .pill.warn{background:#fbe9e7;color:#8a1c12}
.hbe-leads table{width:100%;border-collapse:collapse}.hbe-leads td,.hbe-leads th{padding:.45rem .35rem;border-top:1px solid #eef1ef;text-align:left;vertical-align:top;font-size:.9rem}
.hbe-leads .lead-msg{min-height:1.2em;margin:.3rem 0;font-weight:600;color:#2d5a3d}.hbe-leads .lead-msg.bad{color:#8a1c12}.hbe-leads form{display:inline-flex;gap:.25rem;margin:.1rem .2rem .1rem 0}.hbe-leads button{font:inherit;font-size:.82rem;font-weight:700;border-radius:8px;padding:.3rem .6rem;border:1px solid #2d5a3d;background:#2d5a3d;color:#fff;cursor:pointer}
.hbe-leads button.secondary{background:#fff;color:#2d5a3d}.hbe-leads input[type=email]{font:inherit;font-size:.82rem;width:13rem;max-width:100%}
.hbe-leads .tag{display:inline-block;font-size:.75rem;font-weight:700;padding:.1rem .45rem;border-radius:6px;margin:.1rem .2rem 0 0}.hbe-leads .tag.delayed{background:#fbe9e7;color:#8a1c12}.hbe-leads .tag.ok{background:#e4f4e8;color:#1d5a2e}.hbe-leads .tag.spam{background:#fff4d6;color:#7a5600}
@media(max-width:700px){.hbe-leads thead{display:none}.hbe-leads tr{display:block;border-top:1px solid #eef1ef;padding:.4rem 0}.hbe-leads td{display:block;border:0;padding:.15rem 0}}
</style>`;

export function unacknowledgedBanner(counts) {
  const u = Number(counts?.unacknowledged || 0), d = Number(counts?.alertDelayed || 0);
  return `<div class="counts" id="hbe-unack-count"><a class="pill${u ? ' warn' : ''}" href="/hbe#lead-response">Unacknowledged leads: ${u}</a>${d ? `<span class="pill warn">Alert delayed: ${d}</span>` : ''}</div>`;
}

export function leadPanelHtml(leads, counts, csrf, env, now = Date.now()) {
  const rows = leads.map(l => {
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Buyer';
    const delay = alertDelay(l, now);
    const tags = [
      delay ? `<span class="tag delayed">${delay.kind === 'delayed' ? `Alert delayed ${delay.minutes}m` : `Alert was ${delay.minutes}m late`}</span>` : (l.alert_status === 'sent' ? '<span class="tag ok">Alert sent</span>' : ''),
      l.last_error ? `<span class="tag delayed">Last error: ${esc(String(l.last_error).slice(0, 40))}</span>` : '',
      l.escalated_at ? `<span class="tag delayed">Escalated ${esc(fmt(l.escalated_at))}</span>` : '',
      Number(l.spam_flag) ? `<span class="tag spam">Suspected spam${l.spam_reason ? ': ' + esc(l.spam_reason) : ''}</span>` : ''
    ].join('');
    const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="buyer_id" value="${esc(l.buyer_id)}">`;
    const ack = l.acknowledged_at
      ? `<span class="tag ok">Acknowledged ${esc(fmt(l.acknowledged_at))}</span>`
      : `<form method="post" action="${LEAD_ACTION_PREFIX}acknowledge" data-lead-action="acknowledge">${hidden}<button type="submit">Acknowledge</button></form>`;
    const responded = l.first_response_at
      ? `<span class="tag ok">Responded ${esc(fmt(l.first_response_at))}</span>`
      : `<form method="post" action="${LEAD_ACTION_PREFIX}responded" data-lead-action="responded">${hidden}<button type="submit" class="secondary">Mark responded</button></form>`;
    const assign = `<form method="post" action="${LEAD_ACTION_PREFIX}assign" data-lead-action="assign">${hidden}<input type="email" name="assigned_to" aria-label="Assignee for ${esc(name)}" value="${esc(l.assigned_to || defaultAssignee(env))}" required><button type="submit" class="secondary">Assign</button></form>`;
    return `<tr><td><a href="/hbe?buyer=${encodeURIComponent(l.buyer_id)}"><strong>${esc(name)}</strong></a><br><small>${esc(fmt(l.submitted_at))}</small></td><td>${tags}</td><td>${ack} ${responded}</td><td>${assign}</td></tr>`;
  }).join('');
  return `<section class="hbe-leads" id="lead-response" aria-label="Lead response"><h2>Lead response</h2>${unacknowledgedBanner(counts)}
<p class="lead-msg" id="lead-msg" role="status" aria-live="polite"></p>
<table><thead><tr><th>Lead</th><th>Alert</th><th>Status</th><th>Assignee</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No leads yet.</td></tr>'}</tbody></table></section>`;
}

// Lead actions submit in-page with fetch. A plain form POST to /api/hbe/* leaves the
// Home Screen app's /hbe scope, so iOS opens it in a Safari sheet that has its own
// Access session. Its JWT differs from the one that minted the token, so CSRF fails.
export const LEAD_PANEL_SCRIPT = `<script>(()=>{if(window.__hbeLeadPanel)return;window.__hbeLeadPanel=1;
const MSG={csrf:'Your session refreshed. Tap the button again.',lead_not_found:'That lead no longer exists.',bad_assignee:'Enter a valid email address.',assignee_not_active_professional:'That person is not an active HBE professional.',forbidden:'Only the owner can do this.'};
const say=(t,bad)=>{const m=document.getElementById('lead-msg');if(m){m.textContent=t;m.className='lead-msg'+(bad?' bad':'')}};
const refresh=async()=>{const r=await fetch('${LEAD_ACTION_PREFIX}panel',{credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'refresh');const cur=document.getElementById('lead-response');if(cur)cur.outerHTML=d.html;return d;};
document.addEventListener('submit',async e=>{const f=e.target;if(!f||!f.matches||!f.matches('form[data-lead-action]'))return;e.preventDefault();const btn=f.querySelector('button');if(btn)btn.disabled=true;say('Saving…');
try{const r=await fetch(f.action,{method:'POST',body:new FormData(f),credentials:'same-origin',headers:{accept:'application/json'}});const d=await r.json().catch(()=>({}));
if(r.ok&&d.ok){await refresh();say('Saved.');return}
if(d.error==='csrf'){try{await refresh()}catch{}say(MSG.csrf,true);return}
say(MSG[d.error]||('Could not save ('+(d.error||'HTTP '+r.status)+'). Pull down to refresh and try again.'),true)}
catch{say('Network problem. Check your connection and try again.',true)}finally{if(btn&&btn.isConnected)btn.disabled=false}});})();</script>`;

async function panelFor(request, env) {
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  const [leads, counts] = await Promise.all([listLeads(env), leadCounts(env)]);
  return { html: leadPanelHtml(leads, counts, await mutationCsrfToken(jwt), env), counts };
}

export async function leadPanelForRequest(request, env) {
  return (await panelFor(request, env)).html + LEAD_PANEL_SCRIPT;
}

// ---------- actions ----------
export function isLeadActionPath(pathname) {
  if (!pathname.startsWith(LEAD_ACTION_PREFIX)) return false;
  const a = pathname.slice(LEAD_ACTION_PREFIX.length);
  return a === 'panel' || ACTIONS.has(a);
}

export async function handleLeadAction(request, env, url, opts = {}) {
  const action = url.pathname.slice(LEAD_ACTION_PREFIX.length);
  if (action === 'panel') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const owner = await requireOwner(request, env, opts);
    if (owner.ok !== true) return owner.response;
    const { html, counts } = await panelFor(request, env);
    return json({ ok: true, html, counts });
  }
  if (!ACTIONS.has(action)) return json({ ok: false, error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const owner = await requireOwner(request, env, opts);
  if (owner.ok !== true) return owner.response;
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'bad_form' }, 400); }
  const jwt = String(request.headers.get('Cf-Access-Jwt-Assertion') || '');
  if (!(await assertMutationCsrf(request, form.get('csrf'), jwt))) return json({ ok: false, error: 'csrf' }, 403);
  const buyerId = String(form.get('buyer_id') || '').trim();
  if (!buyerId || buyerId.length > 80) return json({ ok: false, error: 'buyer_required' }, 400);
  const lead = await env.BUYER_DB.prepare(`SELECT id FROM notifications WHERE buyer_id=? AND type=? LIMIT 1`).bind(buyerId, LEAD_TYPE).first();
  if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404);
  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO hbe_lead_status (buyer_id,notification_id,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(buyer_id) DO NOTHING`)
    .bind(buyerId, lead.id, defaultAssignee(env), now, now).run();
  if (action === 'acknowledge') {
    await env.BUYER_DB.prepare(`UPDATE hbe_lead_status SET acknowledged_at=COALESCE(acknowledged_at,?), acknowledged_by=COALESCE(acknowledged_by,?), updated_at=? WHERE buyer_id=?`)
      .bind(now, owner.email, now, buyerId).run();
    await logEvent(env, buyerId, 'acknowledged', owner.email, null, now);
  } else if (action === 'responded') {
    await env.BUYER_DB.prepare(`UPDATE hbe_lead_status SET first_response_at=COALESCE(first_response_at,?), responded_by=COALESCE(responded_by,?),
      acknowledged_at=COALESCE(acknowledged_at,?), acknowledged_by=COALESCE(acknowledged_by,?), updated_at=? WHERE buyer_id=?`)
      .bind(now, owner.email, now, owner.email, now, buyerId).run();
    await logEvent(env, buyerId, 'responded', owner.email, null, now);
  } else {
    const assignee = String(form.get('assigned_to') || '').trim().toLowerCase();
    if (!/^[^@\s<>"']{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$/.test(assignee)) return json({ ok: false, error: 'bad_assignee' }, 400);
    const pro = await env.BUYER_DB.prepare(`SELECT email FROM hbe_professionals WHERE lower(email)=? AND status='active' LIMIT 1`).bind(assignee).first();
    if (!pro) return json({ ok: false, error: 'assignee_not_active_professional' }, 400);
    await env.BUYER_DB.prepare(`UPDATE hbe_lead_status SET assigned_to=?, updated_at=? WHERE buyer_id=?`).bind(assignee, now, buyerId).run();
    await logEvent(env, buyerId, 'assigned', owner.email, assignee, now);
  }
  if ((request.headers.get('accept') || '').includes('application/json')) return json({ ok: true, action });
  return new Response(null, { status: 303, headers: { location: '/hbe#lead-response', 'cache-control': 'no-store', 'x-robots-tag': ROBOTS } });
}
