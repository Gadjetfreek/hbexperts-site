// Intake spam protection (Oct 27 2026 audit fix 4).
// - Per-IP rate limit on POST /api/intake using the existing SUBMIT_RATE_LIMITER binding
//   (key "ip:<sha256>", so it never collides with the inner per-email key).
// - Optional Cloudflare Turnstile, OFF unless TURNSTILE_ENABLED="true" AND a site key AND
//   the TURNSTILE_SECRET secret all exist. A failed/missing token never drops the lead:
//   it is saved and flagged as suspected spam for review.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'buyer_intake';

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function turnstileConfig(env) {
  const enabled = String(env.TURNSTILE_ENABLED || '').trim().toLowerCase() === 'true';
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secret = String(env.TURNSTILE_SECRET || '').trim();
  if (!enabled || !siteKey || !secret) return null;
  const hostnames = String(env.TURNSTILE_HOSTNAMES || 'buyer.hbexperts.com').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return { siteKey, secret, hostnames };
}

export async function verifyTurnstile(token, ip, cfg, { fetchImpl = fetch } = {}) {
  if (!token || typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'turnstile_missing' };
  try {
    const body = new FormData();
    body.append('secret', cfg.secret);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    body.append('idempotency_key', crypto.randomUUID());
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return { ok: false, reason: 'turnstile_unavailable' };
    const out = await res.json();
    if (out.success !== true) return { ok: false, reason: 'turnstile_failed' };
    if (out.action !== TURNSTILE_ACTION) return { ok: false, reason: 'turnstile_action_mismatch' };
    if (!cfg.hostnames.includes(String(out.hostname || '').toLowerCase())) return { ok: false, reason: 'turnstile_hostname_mismatch' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'turnstile_unavailable' };
  }
}

export function rateLimitedResponse() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Please try again in a minute</title>
<style>body{font:17px/1.55 -apple-system,system-ui,sans-serif;background:#f7faf8;color:#1a1a2e;margin:0}main{max-width:36rem;margin:12vh auto;padding:1.4rem;background:#fff;border:1px solid #dfe8e2;border-radius:14px}a.btn{display:inline-block;margin-top:.8rem;padding:.7rem 1.1rem;border-radius:10px;background:#2d5a3d;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><main><h1>Please try again in a minute</h1><p>We received several submissions from this connection in a short time, so we paused this one. Nothing was lost: your answers are still saved in this browser.</p><p>Wait about a minute, then go back and press Send again.</p><a class="btn" href="/questionnaire">Back to my answers</a></main></body></html>`;
  return new Response(html, { status: 429, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60', 'x-robots-tag': 'noindex, nofollow' } });
}

// Returns { action:'rate_limited', response } or { action:'allow', spamReason, email }.
export async function guardIntake(request, env, opts = {}) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip && env.SUBMIT_RATE_LIMITER?.limit) {
    try {
      const { success } = await env.SUBMIT_RATE_LIMITER.limit({ key: 'ip:' + await sha256('intake-ip:' + ip) });
      if (!success) {
        console.warn(JSON.stringify({ event: 'intake_ip_rate_limited' }));
        return { action: 'rate_limited', response: rateLimitedResponse() };
      }
    } catch { /* limiter outage must not block real leads */ }
  }
  let form = null;
  try { form = await request.clone().formData(); } catch {}
  const email = String(form?.get('email') || '').trim().toLowerCase();
  let spamReason = null;
  const honeypot = String(form?.get('website') || '').trim();
  if (honeypot) spamReason = 'honeypot';
  const cfg = turnstileConfig(env);
  if (cfg && !spamReason) {
    const r = await verifyTurnstile(String(form?.get('cf-turnstile-response') || ''), ip, cfg, opts);
    if (!r.ok) spamReason = r.reason;
  }
  return { action: 'allow', spamReason, email };
}

export async function findNewLeadBuyerId(env, email, sinceIso) {
  if (!email) return null;
  const row = await env.BUYER_DB.prepare(`SELECT id FROM buyers WHERE lower(email)=? AND submitted_at>=? ORDER BY submitted_at DESC LIMIT 1`).bind(email, sinceIso).first();
  return row?.id || null;
}

// Adds the Turnstile widget to the questionnaire form when (and only when) it is configured.
export function addTurnstileWidget(html, cfg) {
  if (!cfg || html.includes('id="hbe-turnstile"')) return html;
  const formStart = html.indexOf('id="buyerExperienceForm"');
  if (formStart < 0) return html;
  const end = html.indexOf('</form>', formStart);
  if (end < 0) return html;
  const widget = `<div id="hbe-turnstile" class="cf-turnstile" data-sitekey="${String(cfg.siteKey).replace(/[^A-Za-z0-9_-]/g, '')}" data-action="${TURNSTILE_ACTION}" data-appearance="interaction-only" style="margin:.8rem 0"></div>`;
  let out = html.slice(0, end) + widget + html.slice(end);
  const script = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
  out = out.includes('</head>') ? out.replace('</head>', `${script}</head>`) : out + script;
  return out;
}

export function allowTurnstileCsp(headers) {
  const csp = headers.get('content-security-policy');
  if (!csp) return;
  const add = (policy, dir, src) => {
    const re = new RegExp(`(^|;)\\s*${dir}\\s+([^;]*)`);
    return re.test(policy) ? policy.replace(re, (m, a, v) => v.includes(src) ? m : `${a} ${dir} ${v} ${src}`) : `${policy}; ${dir} 'self' ${src}`;
  };
  let p = add(csp, 'script-src', 'https://challenges.cloudflare.com');
  p = add(p, 'frame-src', 'https://challenges.cloudflare.com');
  p = add(p, 'connect-src', 'https://challenges.cloudflare.com');
  headers.set('content-security-policy', p);
}
