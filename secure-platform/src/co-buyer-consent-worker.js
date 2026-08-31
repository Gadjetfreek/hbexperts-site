import appWorker from './pilot-worker.js';

const enc = new TextEncoder();
const INVITE_DAYS = 7;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/hbe/household/link') {
      return new Response('Direct household linking is disabled. Use buyer consent invitations.', {
        status: 410,
        headers: securityHeaders('text/plain; charset=utf-8')
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/household/invite') {
      return createInvitation(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/household/invite/revoke') {
      return revokeInvitation(request, env);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/invite/')) {
      return invitationLanding(request, env, url);
    }

    let invite = null;
    let intakeForm = null;
    if (request.method === 'POST' && url.pathname === '/api/intake') {
      intakeForm = await request.clone().formData();
      const token = clean(intakeForm.get('household_invite_token'));
      if (token) {
        if (clean(intakeForm.get('household_join_consent')) !== 'yes') {
          return page(invitationMessage('Consent required', 'Joining another buyer’s homebuying journey is optional. Check the consent box only if you choose to join, or remove the invitation and submit your Buyer Experience independently.'), 400);
        }
        if (clean(intakeForm.get('has_other_buyer')) !== 'yes') {
          return page(invitationMessage('Please confirm the shared decision', 'You selected that you are the only buyer while also accepting an invitation to join another buyer’s case. Return to the Buyer Experience and choose the answer that matches your situation before joining.'), 400);
        }
        invite = await validInvitationByToken(env, token);
        if (!invite) {
          return page(invitationMessage('Invitation unavailable', 'This invitation is invalid, expired, already used, or revoked. Ask the other buyer to create a new invitation if you still want to connect your journeys.'), 400);
        }
      }
    }

    const response = await appWorker.fetch(request, env, ctx);

    if (invite && intakeForm && response.status >= 200 && response.status < 300) {
      const email = clean(intakeForm.get('email')).toLowerCase();
      await acceptInvitation(env, invite, email);
    }

    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (!type.includes('text/html') || response.status !== 200) return response;

    let text = await response.text();

    if (request.method === 'GET' && url.pathname === '/hbe') {
      text = text.replace(
        /<form method="post" action="\/api\/hbe\/household\/link">[\s\S]*?<\/form>/,
        '<p class="pilot-muted"><strong>Consent-based linking only.</strong> Buyers join a shared case through a private invitation and their own Buyer Experience. Direct staff linking by email is disabled.</p>'
      );
    }

    if (request.method === 'GET' && url.pathname === '/portal') {
      const buyerId = await sessionBuyerId(request, env);
      if (buyerId) {
        const panel = await invitationPanel(env, buyerId);
        text = injectBeforeMainEnd(text, panel);
      }
    }

    if (request.method === 'GET' && url.pathname === '/questionnaire') {
      const token = clean(url.searchParams.get('invite'));
      if (token) {
        const valid = await validInvitationByToken(env, token);
        if (!valid) {
          return page(invitationMessage('Invitation unavailable', 'This invitation is invalid, expired, already used, or revoked. You can still complete a Buyer Experience independently, or ask the other buyer for a new invitation.'));
        }
        text = injectInvitationConsent(text, token);
      }
    }

    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }
};

async function createInvitation(request, env) {
  const buyerId = await sessionBuyerId(request, env);
  if (!buyerId) return redirect('/login');

  const caseId = await ensureCaseForBuyer(env, buyerId);
  const token = randomToken(32);
  const hash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_DAYS * 86400000);

  await env.BUYER_DB.prepare(`INSERT INTO buyer_case_invitations
    (id,case_id,created_by_buyer_id,token_hash,created_at,expires_at)
    VALUES (?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), caseId, buyerId, hash, now.toISOString(), expires.toISOString()).run();

  const base = new URL(request.url);
  const inviteUrl = `${base.origin}/invite/${encodeURIComponent(token)}`;
  return page(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Buyer invitation | HomeBuyer Experts</title>${INVITE_STYLE}</head><body><main class="invite-wrap"><div class="invite-card"><div class="eyebrow">PRIVATE BUYER INVITATION</div><h1>Share this invitation with the other buyer.</h1><p>This link expires in ${INVITE_DAYS} days and can be used once. The other buyer will enter their own identity, complete their own Buyer Experience, and choose whether to join your shared homebuying journey.</p><p><strong>You will not see their private reflective answers, and they will not see yours.</strong></p><label>Invitation link<input readonly value="${esc(inviteUrl)}"></label><p class="muted">HBE does not need the other buyer’s email or phone from you. Email delivery is not enabled: the Cloudflare Send Email binding (HBE_ALERT) and a verified sending domain are not configured. The safe path is this copyable link; the other buyer identifies themselves. HBE will not collect their address from you and will not fake a send.</p><a class="btn" href="/portal">Back to Buyer Portal</a></div></main></body></html>`);
}

async function revokeInvitation(request, env) {
  const buyerId = await sessionBuyerId(request, env);
  if (!buyerId) return redirect('/login');
  const form = await request.formData();
  const id = clean(form.get('invite_id'));
  if (id) {
    await env.BUYER_DB.prepare(`UPDATE buyer_case_invitations SET revoked_at=?
      WHERE id=? AND created_by_buyer_id=? AND accepted_at IS NULL AND revoked_at IS NULL`)
      .bind(new Date().toISOString(), id, buyerId).run();
  }
  return redirect('/portal');
}

async function invitationLanding(request, env, url) {
  const token = decodeURIComponent(url.pathname.slice('/invite/'.length));
  const invite = await validInvitationByToken(env, token);
  if (!invite) {
    return page(invitationMessage('Invitation unavailable', 'This invitation is invalid, expired, already used, or revoked. Ask the buyer who invited you to create a new invitation if you still want to connect your journeys.'), 404);
  }

  return page(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Join a buyer journey | HomeBuyer Experts</title>${INVITE_STYLE}</head><body><main class="invite-wrap"><div class="invite-card"><div class="eyebrow">HOME BUYER EXPERTS</div><h1>You’ve been invited to a shared homebuying journey.</h1><p>The invitation does <strong>not</strong> add you automatically. You will identify yourself and complete your own Buyer Experience first. At the end, you can explicitly choose whether to connect your account to the other buyer’s case.</p><p>Your reflective answers stay private to you and authorized HBE professionals. The other buyer does not automatically receive them.</p><a class="btn" href="/questionnaire?invite=${encodeURIComponent(token)}">Continue to my Buyer Experience</a><p class="muted">You may also close this page and do nothing.</p></div></main></body></html>`);
}

function injectInvitationConsent(text, token) {
  const hidden = `<input type="hidden" name="household_invite_token" value="${esc(token)}">`;
  text = text.replace('<form id="buyerExperienceForm" method="post" action="/api/intake" novalidate>', `<form id="buyerExperienceForm" method="post" action="/api/intake" novalidate>${hidden}`);
  const consent = `<div class="privacy"><strong>Invitation choice</strong><br>This Buyer Experience is yours. Your reflective answers remain private from the other buyer by default.</div><label class="choice group"><input type="checkbox" name="household_join_consent" value="yes" required><span><strong>Join this homebuying decision with the other buyer.</strong><br><span class="hint">I understand that accepting connects my HBE account to the same buyer case. I can choose not to accept and submit independently instead by opening the Buyer Experience without this invitation.</span></span></label>`;
  return text.replace('<div class="submitbox"><strong>This is the moment HBE receives your information.</strong>', `${consent}<div class="submitbox"><strong>This is the moment HBE receives your information.</strong>`);
}

async function validInvitationByToken(env, token) {
  const hash = await sha256(token);
  return env.BUYER_DB.prepare(`SELECT id,case_id,created_by_buyer_id,created_at,expires_at,accepted_at,revoked_at
    FROM buyer_case_invitations
    WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? LIMIT 1`)
    .bind(hash, new Date().toISOString()).first();
}

async function acceptInvitation(env, invite, email) {
  if (!email) throw new Error('Invitation acceptance requires buyer email');
  const buyer = await env.BUYER_DB.prepare('SELECT id FROM buyers WHERE lower(email)=? ORDER BY submitted_at DESC LIMIT 1')
    .bind(email).first();
  if (!buyer?.id) throw new Error('Submitted buyer not found for invitation');

  const now = new Date().toISOString();
  const claim = await env.BUYER_DB.prepare(`UPDATE buyer_case_invitations
    SET accepted_at=?, accepted_by_buyer_id=?
    WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?`)
    .bind(now, buyer.id, invite.id, now).run();

  if (Number(claim.meta?.changes || 0) !== 1) {
    throw new Error('Invitation was already used, revoked, or expired');
  }

  try {
    await env.BUYER_DB.batch([
      env.BUYER_DB.prepare('INSERT INTO buyer_case_members (case_id,buyer_id,role,created_at) VALUES (?,?,?,?)')
        .bind(invite.case_id, buyer.id, 'buyer', now),
      env.BUYER_DB.prepare('INSERT INTO buyer_person_profiles (buyer_id,case_id,created_at,updated_at,profile_json) VALUES (?,?,?,?,?)')
        .bind(buyer.id, invite.case_id, now, now, '{}')
    ]);
  } catch (err) {
    await env.BUYER_DB.prepare(`UPDATE buyer_case_invitations SET accepted_at=NULL,accepted_by_buyer_id=NULL
      WHERE id=? AND accepted_by_buyer_id=? AND accepted_at=?`)
      .bind(invite.id, buyer.id, now).run();
    throw err;
  }
}

async function invitationPanel(env, buyerId) {
  const rows = await env.BUYER_DB.prepare(`SELECT id,created_at,expires_at,accepted_at,revoked_at
    FROM buyer_case_invitations WHERE created_by_buyer_id=? ORDER BY created_at DESC LIMIT 10`)
    .bind(buyerId).all();
  const items = (rows.results || []).map(row => {
    const status = row.accepted_at ? 'Accepted' : row.revoked_at ? 'Revoked' : row.expires_at <= new Date().toISOString() ? 'Expired' : 'Pending';
    const revoke = status === 'Pending' ? `<form method="post" action="/api/household/invite/revoke"><input type="hidden" name="invite_id" value="${esc(row.id)}"><button class="invite-small" type="submit">Revoke</button></form>` : '';
    return `<div class="invite-row"><span><strong>${status}</strong><small>Created ${esc(row.created_at.slice(0,10))} · expires ${esc(row.expires_at.slice(0,10))}</small></span>${revoke}</div>`;
  }).join('');

  return `<section class="buyer-household invite-panel"><div class="pilot-eyebrow">INVITE ANOTHER BUYER</div><h2>They choose whether to join.</h2><p>Create a private, single-use invitation. You do not enter their name, email, phone, or answers. They identify themselves, complete their own Buyer Experience, and explicitly consent before their account joins your case.</p><p>Email delivery of this invitation is an architecture blocker until a verified sending domain and the HBE_ALERT Send Email binding are enabled. Until then, share the copyable link. Do not enter the other buyer’s email here.</p><form method="post" action="/api/household/invite"><button class="invite-primary" type="submit">Create private invitation</button></form>${items ? `<div class="invite-list">${items}</div>` : ''}</section>${INVITE_PANEL_STYLE}`;
}

async function ensureCaseForBuyer(env, buyerId) {
  const existing = await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=?').bind(buyerId).first();
  if (existing?.case_id) return existing.case_id;
  const buyer = await env.BUYER_DB.prepare('SELECT stage,completed_stages FROM buyers WHERE id=?').bind(buyerId).first();
  if (!buyer) throw new Error('Buyer not found');
  const caseId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.BUYER_DB.batch([
    env.BUYER_DB.prepare('INSERT INTO buyer_cases (id,created_at,updated_at,stage,completed_stages,status) VALUES (?,?,?,?,?,?)').bind(caseId,now,now,buyer.stage || 'consultation',buyer.completed_stages || '["buyerExperience"]','active'),
    env.BUYER_DB.prepare('INSERT INTO buyer_case_members (case_id,buyer_id,role,created_at) VALUES (?,?,?,?)').bind(caseId,buyerId,'buyer',now),
    env.BUYER_DB.prepare('INSERT INTO buyer_person_profiles (buyer_id,case_id,created_at,updated_at,profile_json) VALUES (?,?,?,?,?)').bind(buyerId,caseId,now,now,'{}'),
    env.BUYER_DB.prepare('INSERT INTO buyer_case_financials (case_id,updated_at,pilot_rate) VALUES (?,?,0.0275)').bind(caseId,now)
  ]);
  return caseId;
}

async function sessionBuyerId(request, env) {
  const token = getCookie(request, 'hbe_session');
  if (!token) return null;
  const row = await env.BUYER_DB.prepare('SELECT buyer_id FROM buyer_sessions WHERE token_hash=? AND expires_at>? LIMIT 1')
    .bind(await sha256(token), new Date().toISOString()).first();
  return row?.buyer_id || null;
}

function randomToken(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function invitationMessage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(title)} | HomeBuyer Experts</title>${INVITE_STYLE}</head><body><main class="invite-wrap"><div class="invite-card"><div class="eyebrow">HOME BUYER EXPERTS</div><h1>${esc(title)}</h1><p>${esc(body)}</p><a class="btn" href="/questionnaire">Open an independent Buyer Experience</a></div></main></body></html>`;
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? text.slice(0, i) + panel + text.slice(i) : text.replace('</body>', panel + '</body>');
}

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function clean(value) { return String(value || '').trim().slice(0, 5000); }
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
async function sha256(value) { const digest = await crypto.subtle.digest('SHA-256', enc.encode(value)); return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''); }
function redirect(location) { return new Response(null, { status: 303, headers: { ...securityHeaders(), location } }); }
function page(body, status = 200) { return new Response(body, { status, headers: securityHeaders() }); }
function securityHeaders(type = 'text/html; charset=utf-8') { return { 'content-type': type, 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }; }

const INVITE_STYLE = `<style>:root{--navy:#1a1a2e;--green:#2d5a3d;--text:#2c2c2c;--muted:#6b6b6b;--warm:#faf9f6;--border:#e8e5e0}*{box-sizing:border-box}body{margin:0;background:var(--warm);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}.invite-wrap{max-width:760px;margin:0 auto;padding:5rem 1.25rem}.invite-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:clamp(1.4rem,5vw,3rem);box-shadow:0 12px 36px rgba(26,26,46,.06)}.eyebrow{font-size:.76rem;font-weight:800;letter-spacing:.13em;color:var(--green)}h1{font-family:Georgia,serif;color:var(--navy);font-size:clamp(2rem,6vw,3rem);line-height:1.08}.muted{color:var(--muted);font-size:.9rem}.btn{display:inline-block;background:var(--green);color:#fff;text-decoration:none;font-weight:700;border-radius:7px;padding:.8rem 1.1rem;margin-top:1rem}label{display:block;font-weight:700;margin:1rem 0}input{width:100%;padding:.8rem;border:1px solid var(--border);border-radius:7px;margin-top:.35rem}</style>`;
const INVITE_PANEL_STYLE = `<style id="co-buyer-consent-style">.invite-panel{margin-top:1rem}.invite-primary,.invite-small{border:0;border-radius:7px;background:#2d5a3d;color:#fff;font-weight:700;cursor:pointer;padding:.7rem 1rem}.invite-small{font-size:.78rem;padding:.45rem .65rem}.invite-list{margin-top:1rem}.invite-row{display:flex;justify-content:space-between;align-items:center;gap:1rem;border-top:1px solid #e8e5e0;padding:.65rem 0}.invite-row span strong,.invite-row span small{display:block}.invite-row span small{color:#6b6b6b}</style>`;
