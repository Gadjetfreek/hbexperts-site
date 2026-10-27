// HBE Home Screen app (owner-only) + Web Push for buyer activity and intake alerts.
// Push is primary; the existing email queues stay untouched as fallback/record.
import { authenticateHbeProfessional } from './hbe-access-worker.js';
import { sendWebPush } from './web-push.js';
import { BUYER_ACTIONS } from './buyer-activity-alerts.js';
import { HBE_APP_ICONS } from './hbe-app-icons.js';

const ORIGIN = 'https://buyer.hbexperts.com';
const LEASE_MS = 2 * 60 * 1000;
const OVERDUE_MS = 10 * 60 * 1000;
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const LIMIT = 20;
const SW_PATH = '/hbe/app-sw.js';
const MANIFEST_PATH = '/hbe/app.webmanifest';
export const PUSH_ACTIONS = { ...BUYER_ACTIONS, '/api/intake': 'Submitted the buyer questionnaire', test: 'Test notification' };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export function ownerEmail(env) {
  return String(env.HBE_OWNER_EMAIL || env.HBE_ADMIN_EMAIL || 'cwhitehead@hbexperts.com').trim().toLowerCase();
}

export function vapidConfig(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) return null;
  return { publicKey, privateKey, subject: `mailto:${ownerEmail(env)}` };
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function validateSubscription(sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  let u;
  try { u = new URL(endpoint); } catch { return null; }
  const allowedHost = /(^|\.)push\.apple\.com$/.test(u.hostname) || u.hostname === 'fcm.googleapis.com' || /(^|\.)push\.services\.mozilla\.com$/.test(u.hostname) || /\.notify\.windows\.com$/.test(u.hostname);
  if (u.protocol !== 'https:' || !allowedHost || u.username || u.password || endpoint.length > 4096) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,64}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// ---------- auth ----------
export async function requireOwner(request, env, { authenticate = authenticateHbeProfessional } = {}) {
  const auth = await authenticate(request, env);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (auth.professional.email !== ownerEmail(env)) return { ok: false, response: json({ ok: false, error: 'owner_required' }, 403) };
  return { ok: true, email: auth.professional.email };
}

function trustedOrigin(request) {
  return request.headers.get('origin') === ORIGIN;
}

// ---------- queue ----------
export async function enqueuePushAlert(env, kind, refId, buyerId, action, createdAt = new Date().toISOString()) {
  const id = `${kind}:${refId}`;
  const res = await env.BUYER_DB.prepare(`INSERT OR IGNORE INTO hbe_push_alerts (id,kind,ref_id,buyer_id,action,status,attempts,created_at) VALUES (?,?,?,?,?,'pending',0,?)`)
    .bind(id, kind, refId, buyerId, action, createdAt).run();
  return res?.meta?.changes ? id : null;
}

// Catch-up: every intake notification and buyer activity alert gets exactly one push alert.
export async function syncPushAlerts(env, now = Date.now()) {
  const since = new Date(now - SYNC_WINDOW_MS).toISOString();
  await env.BUYER_DB.prepare(`INSERT OR IGNORE INTO hbe_push_alerts (id,kind,ref_id,buyer_id,action,status,attempts,created_at)
    SELECT 'intake:'||d.notification_id,'intake',d.notification_id,n.buyer_id,'/api/intake','pending',0,d.created_at
    FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE d.created_at>?`).bind(since).run();
  await env.BUYER_DB.prepare(`INSERT OR IGNORE INTO hbe_push_alerts (id,kind,ref_id,buyer_id,action,status,attempts,created_at)
    SELECT 'activity:'||a.id,'activity',a.id,a.buyer_id,a.action,'pending',0,a.created_at
    FROM buyer_activity_alerts a WHERE a.created_at>?`).bind(since).run();
}

export function pushPayload(row) {
  const label = PUSH_ACTIONS[row.action] || 'Completed an action';
  if (row.kind === 'test') return { title: 'HBE', body: 'Test notification: push is working.', url: '/hbe/app', tag: row.id };
  const first = String(row.first_name || '').trim().split(/\s+/)[0].slice(0, 40) || 'A buyer';
  return { title: 'HBE', body: `${first}: ${label}`, url: row.buyer_id ? `/hbe?buyer=${encodeURIComponent(row.buyer_id)}` : '/hbe', tag: row.id };
}

export async function deliverPushAlert(env, id, { send = sendWebPush } = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const claim = await env.BUYER_DB.prepare(`UPDATE hbe_push_alerts SET status='sending', attempts=attempts+1, last_attempt_at=?, lease_until=?, error_code=NULL
    WHERE id=? AND attempts<? AND (status IN ('pending','failed') OR (status='sending' AND lease_until<?))`)
    .bind(nowIso, new Date(now.getTime() + LEASE_MS).toISOString(), id, MAX_ATTEMPTS, nowIso).run();
  if (!claim?.meta?.changes) return { status: 'skipped' };
  const row = await env.BUYER_DB.prepare(`SELECT p.id,p.kind,p.buyer_id,p.action,b.first_name FROM hbe_push_alerts p LEFT JOIN buyers b ON b.id=p.buyer_id WHERE p.id=? LIMIT 1`).bind(id).first();
  if (!row) return finish(env, id, 'failed', 'ALERT_NOT_FOUND');
  const vapid = vapidConfig(env);
  if (!vapid) return finish(env, id, 'failed', 'VAPID_NOT_CONFIGURED');
  const subs = (await env.BUYER_DB.prepare(`SELECT id,endpoint,p256dh,auth FROM hbe_push_subscriptions WHERE staff_email=?`).bind(ownerEmail(env)).all()).results || [];
  if (!subs.length) return finish(env, id, 'no_subscribers', null);
  const payload = pushPayload(row);
  const results = [];
  for (const s of subs) {
    let r;
    try { r = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid); }
    catch { r = { status: 0, ok: false, reason: 'TransportError' }; }
    const outcome = r.ok ? 'accepted' : (r.status === 404 || r.status === 410) ? 'pruned' : 'failed';
    results.push({ subscription: s.id.slice(0, 12), outcome, http_status: r.status, reason: r.reason || null });
    await env.BUYER_DB.prepare(`INSERT INTO hbe_push_dispatch_log (alert_id,subscription_id,http_status,outcome,provider_reason,created_at) VALUES (?,?,?,?,?,?)`)
      .bind(id, s.id, r.status, outcome, r.reason || null, new Date().toISOString()).run();
    if (outcome === 'pruned') await env.BUYER_DB.prepare(`DELETE FROM hbe_push_subscriptions WHERE id=?`).bind(s.id).run();
    else await env.BUYER_DB.prepare(`UPDATE hbe_push_subscriptions SET last_status=?, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END, failures=CASE WHEN ? THEN 0 ELSE failures+1 END WHERE id=?`)
      .bind(r.status, r.ok ? 1 : 0, nowIso, r.ok ? 1 : 0, s.id).run();
  }
  console.log(JSON.stringify({ event: 'push_dispatch', alert_id: id, results }));
  const status = results.some(r => r.outcome === 'accepted') ? 'sent' : results.every(r => r.outcome === 'pruned') ? 'no_subscribers' : 'failed';
  const out = await finish(env, id, status, status === 'failed' ? 'PUSH_SEND_FAILED' : null);
  return { ...out, results };
}

async function finish(env, id, status, code) {
  await env.BUYER_DB.prepare(`UPDATE hbe_push_alerts SET status=?, lease_until=NULL, error_code=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE id=?`)
    .bind(status, code, status, new Date().toISOString(), id).run();
  if (status === 'failed') console.error(JSON.stringify({ event: 'push_alert_failed', alert_id: id, error_code: code }));
  return { status, code: code || undefined };
}

export async function processPushBacklog(env, opts) {
  await syncPushAlerts(env);
  const nowIso = new Date().toISOString();
  const rows = (await env.BUYER_DB.prepare(`SELECT id FROM hbe_push_alerts WHERE attempts<? AND (status IN ('pending','failed') OR (status='sending' AND lease_until<?)) ORDER BY created_at ASC LIMIT ?`)
    .bind(MAX_ATTEMPTS, nowIso, LIMIT).all()).results || [];
  let sent = 0;
  for (const r of rows) if ((await deliverPushAlert(env, r.id, opts)).status === 'sent') sent++;
  return { attempted: rows.length, sent };
}

export async function pushHealth(env) {
  try {
    const subs = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM hbe_push_subscriptions`).first();
    const backlog = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM hbe_push_alerts WHERE status IN ('pending','sending','failed') AND attempts<?`).bind(MAX_ATTEMPTS).first();
    const overdue = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM hbe_push_alerts WHERE status IN ('pending','sending','failed') AND attempts<? AND created_at<?`).bind(MAX_ATTEMPTS, new Date(Date.now() - OVERDUE_MS).toISOString()).first();
    const last = await env.BUYER_DB.prepare(`SELECT outcome,http_status,created_at FROM hbe_push_dispatch_log ORDER BY id DESC LIMIT 1`).first();
    return {
      configured: !!vapidConfig(env),
      subscriptions: Number(subs?.c || 0),
      backlog: Number(backlog?.c || 0),
      overdue: Number(overdue?.c || 0),
      last_result: last ? { outcome: last.outcome, http_status: last.http_status, at: last.created_at } : null
    };
  } catch {
    return { configured: !!vapidConfig(env), error: 'unavailable' };
  }
}

// ---------- routes ----------
export function isHbeAppPath(pathname) {
  return pathname === '/hbe/app' || pathname === SW_PATH || pathname === MANIFEST_PATH || /^\/hbe\/app-icon-(180|192|512)\.png$/.test(pathname) || pathname.startsWith('/api/hbe/push/');
}

export async function handleHbeApp(request, env, url, opts = {}) {
  const p = url.pathname;
  // Static, data-free assets (still behind Cloudflare Access at the edge).
  if (request.method === 'GET' && p === MANIFEST_PATH) return new Response(JSON.stringify(MANIFEST), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
  if (request.method === 'GET' && p === SW_PATH) return new Response(SERVICE_WORKER, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/hbe' } });
  const icon = p.match(/^\/hbe\/app-icon-(180|192|512)\.png$/);
  if (request.method === 'GET' && icon) {
    const bin = atob(HBE_APP_ICONS[icon[1]]); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
  }

  const owner = await requireOwner(request, env, opts);
  if (!owner.ok) return owner.response;

  if (request.method === 'GET' && p === '/hbe/app') return new Response(await appPage(env), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
  if (request.method === 'GET' && p === '/api/hbe/push/config') {
    const v = vapidConfig(env);
    return v ? json({ ok: true, publicKey: v.publicKey }) : json({ ok: false, error: 'vapid_not_configured' }, 503);
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!trustedOrigin(request)) return json({ ok: false, error: 'bad_origin' }, 403);
  let body = {};
  try { body = await request.json(); } catch {}

  if (p === '/api/hbe/push/subscribe') {
    const sub = validateSubscription(body.subscription);
    if (!sub) return json({ ok: false, error: 'invalid_subscription' }, 400);
    const id = await sha256(sub.endpoint);
    const now = new Date().toISOString();
    await env.BUYER_DB.prepare(`INSERT INTO hbe_push_subscriptions (id,staff_email,endpoint,p256dh,auth,created_at,updated_at,failures) VALUES (?,?,?,?,?,?,?,0)
      ON CONFLICT(id) DO UPDATE SET staff_email=excluded.staff_email,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at,failures=0`)
      .bind(id, owner.email, sub.endpoint, sub.keys.p256dh, sub.keys.auth, now, now).run();
    const count = await env.BUYER_DB.prepare(`SELECT COUNT(*) AS c FROM hbe_push_subscriptions WHERE staff_email=?`).bind(owner.email).first();
    return json({ ok: true, registered_at: now, devices: Number(count?.c || 0) });
  }
  if (p === '/api/hbe/push/unsubscribe') {
    const endpoint = String(body.endpoint || '');
    if (!endpoint) return json({ ok: false, error: 'endpoint_required' }, 400);
    await env.BUYER_DB.prepare(`DELETE FROM hbe_push_subscriptions WHERE id=? AND staff_email=?`).bind(await sha256(endpoint), owner.email).run();
    return json({ ok: true });
  }
  if (p === '/api/hbe/push/test') {
    const id = await enqueuePushAlert(env, 'test', crypto.randomUUID(), null, 'test');
    const r = await deliverPushAlert(env, id, opts);
    return json({ ok: r.status === 'sent', status: r.status, results: r.results || [] });
  }
  return json({ ok: false, error: 'not_found' }, 404);
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function appPage(env) {
  let items = [];
  try {
    await syncPushAlerts(env);
    items = (await env.BUYER_DB.prepare(`SELECT p.kind,p.action,p.buyer_id,p.created_at,p.status,b.first_name,b.last_name FROM hbe_push_alerts p
      LEFT JOIN buyers b ON b.id=p.buyer_id WHERE p.kind!='test' ORDER BY p.created_at DESC LIMIT 40`).all()).results || [];
  } catch {}
  const health = await pushHealth(env);
  const feed = items.length ? items.map(i => `<li><a href="/hbe?buyer=${encodeURIComponent(i.buyer_id || '')}"><strong>${esc(`${i.first_name || ''} ${i.last_name || ''}`.trim() || 'Buyer')}</strong><span>${esc(PUSH_ACTIONS[i.action] || 'Completed an action')}</span><time datetime="${esc(i.created_at)}">${esc(i.created_at)}</time></a></li>`).join('') : '<li class="empty">No buyer activity yet.</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2d5a3d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="HBE">
<link rel="manifest" href="${MANIFEST_PATH}" crossorigin="use-credentials"><link rel="apple-touch-icon" sizes="180x180" href="/hbe/app-icon-180.png"><link rel="icon" href="/hbe/app-icon-192.png">
<title>HBE</title><style>body{font:16px -apple-system,system-ui,sans-serif;margin:0;background:#f7faf8;color:#1a1a2e}header{background:#2d5a3d;color:#fff;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px}h1{margin:0;font-size:1.3rem}main{padding:16px;max-width:640px;margin:auto}
.card{background:#fff;border:1px solid #dfe8e2;border-radius:12px;padding:14px;margin-bottom:14px}button{font:inherit;font-weight:700;border-radius:10px;padding:.7rem 1rem;border:1px solid #2d5a3d;background:#2d5a3d;color:#fff;margin:4px 6px 4px 0}button.secondary{background:#fff;color:#2d5a3d}button:disabled{opacity:.5}
#status{margin:.6rem 0 0;padding:.6rem .7rem;border-radius:8px;background:#eef3f0}#status.good{background:#e4f4e8;color:#1d5a2e}#status.bad{background:#fbe9e7;color:#8a1c12}ul{list-style:none;padding:0;margin:0}li a{display:grid;gap:2px;padding:10px 4px;border-bottom:1px solid #eee;color:inherit;text-decoration:none}li span{color:#2d5a3d}li time{color:#777;font-size:.8rem}.empty{color:#777;padding:10px 4px}small{color:#666}a.dash{display:block;text-align:center;font-weight:700;border-radius:10px;padding:.8rem 1rem;background:#2d5a3d;color:#fff;text-decoration:none;margin-bottom:6px}</style></head>
<body><header><h1>HBE buyer activity</h1></header><main>
<section class="card"><a class="dash" href="/hbe">Open HBEUI dashboard</a><br><small>Opens inside this app. Use the HBEUI back control or reopen HBE to return to alerts.</small></section>
<section class="card" id="install" hidden><strong>Add to Home Screen first.</strong> In Safari tap Share, then Add to Home Screen, then open HBE from the new icon.</section>
<section class="card"><strong>Notifications</strong><br><small>This device: <span id="perm">checking</span> · registered devices: <span id="devices">${esc(health.subscriptions ?? 0)}</span></small><br>
<button id="enable">Enable notifications</button><button id="rereg" class="secondary">Re-register</button><button id="test" class="secondary">Send test notification</button>
<p id="status" role="status" aria-live="polite">Ready.</p></section>
<section class="card"><strong>Recent buyer activity</strong><ul>${feed}</ul></section></main>
<script>
(()=>{const $=id=>document.getElementById(id);const st=(t,c)=>{const e=$('status');e.textContent=t;e.className=c||'';};
const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
if(!standalone&&/iPhone|iPad/.test(navigator.userAgent))$('install').hidden=false;
const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
$('perm').textContent=supported?Notification.permission:'not supported here';
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok&&!('status' in j))throw new Error(j.error||('HTTP '+r.status));return j;}
function key(b){const s=atob((b+'='.repeat((4-b.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
async function register(force){if(!supported)throw new Error(standalone?'Push is not supported on this device':'Open HBE from the Home Screen icon first');
const cfg=await api('/api/hbe/push/config');const reg=await navigator.serviceWorker.register('${SW_PATH}',{scope:'/hbe'});await navigator.serviceWorker.ready;
let sub=await reg.pushManager.getSubscription();if(sub&&force){await api('/api/hbe/push/unsubscribe',{endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe().catch(()=>{});sub=null;}
if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(cfg.publicKey)});
const r=await api('/api/hbe/push/subscribe',{subscription:sub.toJSON()});$('devices').textContent=r.devices;return r;}
async function run(btn,fn){btn.disabled=true;try{await fn();}catch(e){st('Problem: '+e.message,'bad');}finally{btn.disabled=false;$('perm').textContent=supported?Notification.permission:'not supported here';}}
$('enable').onclick=()=>run($('enable'),async()=>{st('Asking for permission…');const p=await Notification.requestPermission();if(p!=='granted')throw new Error('Notifications were not allowed ('+p+'). Allow them in Settings > Notifications > HBE.');
const r=await register(false);st('Notifications enabled on this device at '+new Date(r.registered_at).toLocaleTimeString()+'. Registered devices: '+r.devices+'.','good');});
$('rereg').onclick=()=>run($('rereg'),async()=>{st('Re-registering…');const r=await register(true);st('Re-registered successfully at '+new Date(r.registered_at).toLocaleTimeString()+'. Registered devices: '+r.devices+'.','good');});
$('test').onclick=()=>run($('test'),async()=>{st('Sending test…');const r=await api('/api/hbe/push/test',{});
if(r.status==='sent')st('Test accepted by Apple for '+r.results.filter(x=>x.outcome==='accepted').length+' device(s). It should appear within a few seconds. If it does not, tap Re-register.','good');
else if(r.status==='no_subscribers')st('No registered devices. Tap Enable notifications first.','bad');
else st('Test failed: '+(r.results||[]).map(x=>x.outcome+' '+x.http_status+(x.reason?' '+x.reason:'')).join(', '),'bad');});
if(supported&&standalone&&Notification.permission==='granted')register(false).then(r=>st('Notifications active. Registered devices: '+r.devices+'.','good')).catch(e=>st('Notifications need attention: '+e.message+'. Tap Re-register.','bad'));
})();
</script></body></html>`;
}

export const MANIFEST = {
  name: 'HBE', short_name: 'HBE', id: '/hbe/app', start_url: '/hbe/app', scope: '/hbe', display: 'standalone',
  background_color: '#f7faf8', theme_color: '#2d5a3d', description: 'HBE buyer activity alerts',
  icons: [
    { src: '/hbe/app-icon-180.png', sizes: '180x180', type: 'image/png' },
    { src: '/hbe/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/hbe/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
  ]
};

export const SERVICE_WORKER = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// No fetch handler on purpose: every HBEUI request goes to the network, nothing authenticated is cached.
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(_){}
const url=typeof d.url==='string'&&d.url.startsWith('/hbe')?d.url:'/hbe/app';
e.waitUntil(self.registration.showNotification(d.title||'HBE',{body:d.body||'New buyer activity',tag:d.tag||undefined,icon:'/hbe/app-icon-192.png',badge:'/hbe/app-icon-192.png',data:{url}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'/hbe/app';
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('navigate' in c&&'focus' in c)return c.navigate(url).then(w=>(w||c).focus()).catch(()=>self.clients.openWindow(url));}return self.clients.openWindow(url);}));});
`;
