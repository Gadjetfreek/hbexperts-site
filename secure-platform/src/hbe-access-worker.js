import appWorker from './co-buyer-consent-worker.js';

const enc = new TextEncoder();
const te = new TextDecoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const professionalPath = url.pathname === '/hbe' || url.pathname.startsWith('/hbe/') || url.pathname.startsWith('/api/hbe/');

    if (!professionalPath) {
      return appWorker.fetch(stripInternalProfessionalHeaders(request), env, ctx);
    }

    const auth = await authenticateHbeProfessional(request, env);
    if (!auth.ok) return auth.response;

    if ((url.pathname === '/hbe/admin' || url.pathname.startsWith('/api/hbe/admin/')) && auth.professional.role !== 'broker_admin') {
      return forbidden('Broker-admin access required.');
    }

    if (request.method === 'GET' && url.pathname === '/hbe/admin') {
      return adminPortal(env, auth.professional);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/admin/professional') {
      return createProfessional(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/admin/professional/status') {
      return updateProfessionalStatus(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/admin/workspace/status') {
      return updateWorkspaceStatus(request, env);
    }

    const verified = withVerifiedProfessional(request, auth.professional);
    const downstreamEnv = { ...env, HBE_ADMIN_EMAIL: auth.professional.email };
    const response = await appWorker.fetch(verified, downstreamEnv, ctx);
    return decorateHbeResponse(response, url, auth.professional);
  }
};

async function authenticateHbeProfessional(request, env) {
  const teamDomain = normalizedTeamDomain(env.CF_ACCESS_TEAM_DOMAIN || env.TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || env.POLICY_AUD || '').trim();
  if (!teamDomain || !audience || teamDomain.includes('REPLACE_') || audience.includes('REPLACE_')) {
    return { ok:false, response: forbidden('HBE Access is not fully configured.') };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok:false, response: forbidden('Cloudflare Access authentication required.') };

  try {
    const payload = await verifyAccessJwt(token, teamDomain, audience);
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) return { ok:false, response: forbidden('Verified Access identity has no email address.') };

    const professional = await env.BUYER_DB.prepare(`SELECT id,email,display_name,role,status,workspace_status,workspace_user_id
      FROM hbe_professionals WHERE lower(email)=? LIMIT 1`).bind(email).first();

    if (!professional || professional.status !== 'active') {
      return { ok:false, response: forbidden('This verified identity is not an active HBE professional.') };
    }

    return {
      ok:true,
      professional: {
        id: professional.id,
        email: String(professional.email).toLowerCase(),
        displayName: professional.display_name,
        role: professional.role,
        workspaceStatus: professional.workspace_status,
        workspaceUserId: professional.workspace_user_id || null
      }
    };
  } catch (err) {
    console.error('Cloudflare Access JWT verification failed', err);
    return { ok:false, response: forbidden('Cloudflare Access token verification failed.') };
  }
}

async function verifyAccessJwt(token, teamDomain, audience) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unexpected JWT algorithm or key id');

  if (payload.iss !== teamDomain) throw new Error('Wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw new Error('Wrong audience');

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('Expired JWT');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 60) throw new Error('JWT not active yet');

  const certs = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept:'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!certs.ok) throw new Error(`Unable to load Access signing keys: ${certs.status}`);
  const jwks = await certs.json();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256'));
  if (!jwk) throw new Error('Unknown Access signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false,
    ['verify']
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlBytes(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new Error('Invalid JWT signature');
  return payload;
}

async function adminPortal(env, professional) {
  const rows = await env.BUYER_DB.prepare(`SELECT id,email,display_name,role,status,workspace_status,workspace_user_id,created_at,updated_at
    FROM hbe_professionals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, display_name, email`).all();
  const people = rows.results || [];

  const table = people.map(p => `<tr>
    <td><strong>${esc(p.display_name)}</strong><small>${esc(p.role)}</small></td>
    <td>${esc(p.email)}</td>
    <td><span class="pill ${esc(p.workspace_status)}">${esc(p.workspace_status)}</span></td>
    <td><span class="pill ${esc(p.status)}">${esc(p.status)}</span></td>
    <td>
      <form method="post" action="/api/hbe/admin/professional/status" class="inline"><input type="hidden" name="id" value="${esc(p.id)}"><select name="status"><option${p.status==='pending'?' selected':''}>pending</option><option${p.status==='active'?' selected':''}>active</option><option${p.status==='disabled'?' selected':''}>disabled</option></select><button>Save HBE access</button></form>
      <form method="post" action="/api/hbe/admin/workspace/status" class="inline"><input type="hidden" name="id" value="${esc(p.id)}"><select name="workspace_status"><option${p.workspace_status==='requested'?' selected':''}>requested</option><option${p.workspace_status==='provisioned'?' selected':''}>provisioned</option><option${p.workspace_status==='suspended'?' selected':''}>suspended</option></select><input name="workspace_user_id" value="${esc(p.workspace_user_id||'')}" placeholder="Workspace user ID (optional)"><button>Save Workspace status</button></form>
    </td>
  </tr>`).join('');

  return page(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>HBE Admin Portal</title>${ADMIN_CSS}</head><body>
  <header><a href="https://hbexperts.com/">HomeBuyer Experts</a><nav><a href="/hbe">HBEUI</a><a href="/hbe/admin" aria-current="page">Admin Portal</a><a href="/cdn-cgi/access/logout">Sign Out</a></nav></header>
  <main>
    <div class="eyebrow">HBE ADMIN PORTAL</div><h1>Active & registered users</h1><p class="lede">Google Workspace owns <strong>@hbexperts.com</strong> mailboxes. This portal tracks who should have an HBE identity and who may enter HBEUI. An email request never grants HBEUI access by itself.</p>
    <section class="card"><h2>Add a person / request an HBE address</h2><form method="post" action="/api/hbe/admin/professional" class="new-user"><label>Display name<input name="display_name" required placeholder="Jennifer Rose"></label><label>HBE email local part<input name="local_part" required pattern="[A-Za-z0-9._-]+" placeholder="JRose"><span>@hbexperts.com</span></label><label>Role<select name="role"><option value="professional">Professional</option><option value="broker_admin">Broker admin</option></select></label><button type="submit">Register & request address</button></form><p class="hint">This creates the HBE record in <em>pending/requested</em> state. Google Workspace provisioning is a separate administrative action until Workspace Admin is connected to HBEUI.</p></section>
    <section class="card"><h2>Directory</h2><div class="table-wrap"><table><thead><tr><th>Person</th><th>HBE address</th><th>Google Workspace</th><th>HBEUI access</th><th>Admin actions</th></tr></thead><tbody>${table}</tbody></table></div></section>
    <section class="card"><h2>Security boundary</h2><p>Professional login: <code>https://buyer.hbexperts.com/hbe</code>. Cloudflare Access + authenticator MFA is the one entrance. HBE separately requires an active professional record.</p><p>Signed in as ${esc(professional.displayName)} · ${esc(professional.email)}</p></section>
  </main></body></html>`);
}

async function createProfessional(request, env) {
  const form = await request.formData();
  const displayName = clean(form.get('display_name')).slice(0,120);
  const localPart = normalizeLocalPart(form.get('local_part'));
  const role = clean(form.get('role')) === 'broker_admin' ? 'broker_admin' : 'professional';
  if (!displayName || !localPart) return page(messagePage('Unable to register user','Provide a display name and valid HBE email local part.'),400);

  const email = `${localPart}@hbexperts.com`.toLowerCase();
  const now = new Date().toISOString();
  try {
    await env.BUYER_DB.prepare(`INSERT INTO hbe_professionals
      (id,email,display_name,role,status,workspace_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),email,displayName,role,'pending','requested',now,now).run();
  } catch (err) {
    console.error('Professional registration failed',err);
    return page(messagePage('Unable to register user','That HBE email address may already be registered.'),409);
  }
  return redirect('/hbe/admin');
}

async function updateProfessionalStatus(request, env) {
  const form = await request.formData();
  const id = clean(form.get('id'));
  const status = ['pending','active','disabled'].includes(clean(form.get('status'))) ? clean(form.get('status')) : 'pending';
  const row = await env.BUYER_DB.prepare('SELECT id,email,workspace_status FROM hbe_professionals WHERE id=?').bind(id).first();
  if (!row) return redirect('/hbe/admin');
  if (status === 'active' && row.workspace_status !== 'provisioned') {
    return page(messagePage('Workspace account required','Mark the Google Workspace identity as provisioned before activating HBEUI access.'),409);
  }
  await env.BUYER_DB.prepare('UPDATE hbe_professionals SET status=?,updated_at=? WHERE id=?')
    .bind(status,new Date().toISOString(),id).run();
  return redirect('/hbe/admin');
}

async function updateWorkspaceStatus(request, env) {
  const form = await request.formData();
  const id = clean(form.get('id'));
  const workspaceStatus = ['requested','provisioned','suspended'].includes(clean(form.get('workspace_status'))) ? clean(form.get('workspace_status')) : 'requested';
  const workspaceUserId = clean(form.get('workspace_user_id')).slice(0,200) || null;
  await env.BUYER_DB.prepare('UPDATE hbe_professionals SET workspace_status=?,workspace_user_id=?,updated_at=? WHERE id=?')
    .bind(workspaceStatus,workspaceUserId,new Date().toISOString(),id).run();
  if (workspaceStatus === 'suspended') {
    await env.BUYER_DB.prepare("UPDATE hbe_professionals SET status='disabled',updated_at=? WHERE id=?")
      .bind(new Date().toISOString(),id).run();
  }
  return redirect('/hbe/admin');
}

async function decorateHbeResponse(response, url, professional) {
  const headers = new Headers(response.headers);
  const type = headers.get('content-type') || '';
  if (!type.includes('text/html') || response.status !== 200) return response;
  let text = await response.text();
  if (url.pathname === '/hbe') {
    const tools = `<nav class="hbe-admin-nav"><a href="/hbe">HBEUI</a>${professional.role==='broker_admin'?'<a href="/hbe/admin">Admin Portal</a>':''}<a href="/cdn-cgi/access/logout">Sign Out</a></nav>`;
    text = text.replace('</header>', `${tools}</header>`);
    text = text.replace('</head>', `${HBE_NAV_CSS}</head>`);
  }
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

function withVerifiedProfessional(request, professional) {
  const headers = new Headers(request.headers);
  headers.set('Cf-Access-Authenticated-User-Email', professional.email);
  headers.set('X-HBE-Verified-Professional-Id', professional.id);
  headers.set('X-HBE-Verified-Professional-Email', professional.email);
  headers.set('X-HBE-Verified-Professional-Role', professional.role);
  return new Request(request,{headers});
}

function stripInternalProfessionalHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete('X-HBE-Verified-Professional-Id');
  headers.delete('X-HBE-Verified-Professional-Email');
  headers.delete('X-HBE-Verified-Professional-Role');
  return new Request(request,{headers});
}

function normalizedTeamDomain(value) {
  const raw = String(value || '').trim().replace(/\/+$/,'');
  if (!raw) return '';
  return raw.startsWith('https://') ? raw : `https://${raw}`;
}
function jsonPart(value){return JSON.parse(te.decode(base64UrlBytes(value)))}
function base64UrlBytes(value){const b64=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);const raw=atob(b64);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
function clean(v){return String(v??'').trim()}
function normalizeLocalPart(v){return clean(v).replace(/@.*$/,'').replace(/[^A-Za-z0-9._-]/g,'').slice(0,64)}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function forbidden(message='HBE access required.'){return new Response(message,{status:403,headers:securityHeaders('text/plain; charset=utf-8')})}
function redirect(location){const headers=securityHeaders('text/plain; charset=utf-8');headers.set('location',location);return new Response(null,{status:303,headers})}
function page(body,status=200){return new Response(body,{status,headers:securityHeaders('text/html; charset=utf-8')})}
function securityHeaders(type){return new Headers({'content-type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})}
function messagePage(title,body){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | HBE Admin</title>${ADMIN_CSS}</head><body><main><div class="card"><h1>${esc(title)}</h1><p>${esc(body)}</p><a href="/hbe/admin">Back to Admin Portal</a></div></main></body></html>`}

const HBE_NAV_CSS=`<style>.hbe-admin-nav{display:flex;gap:.8rem;align-items:center;padding:.5rem 1rem;border-top:1px solid #e8e5e0}.hbe-admin-nav a{color:#2d5a3d;font-weight:700;text-decoration:none}.hbe-admin-nav a:hover{text-decoration:underline}</style>`;
const ADMIN_CSS=`<style>:root{--navy:#1a1a2e;--green:#2d5a3d;--border:#e8e5e0;--warm:#faf9f6;--muted:#6b6b6b}*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#2c2c2c;background:#fff}header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.5rem;border-bottom:1px solid var(--border)}header>a{font:700 1.2rem Georgia,serif;color:var(--navy);text-decoration:none}nav{display:flex;gap:1rem;flex-wrap:wrap}nav a{color:var(--green);font-weight:700;text-decoration:none}main{max-width:1180px;margin:auto;padding:3rem 1.5rem 5rem}.eyebrow{font-size:.75rem;font-weight:800;letter-spacing:.13em;color:var(--green)}h1,h2{color:var(--navy);font-family:Georgia,serif}.lede{max-width:850px;color:#555;line-height:1.65}.card{border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin:1rem 0;background:#fff}.new-user{display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:.8rem;align-items:end}.new-user label,.inline{font-size:.82rem;font-weight:700}.new-user input,.new-user select,.inline input,.inline select{width:100%;padding:.65rem;border:1px solid #d8d3cb;border-radius:7px;margin-top:.3rem}.new-user button,.inline button{border:0;border-radius:7px;background:var(--green);color:#fff;padding:.68rem .8rem;font-weight:700}.hint,small{display:block;color:var(--muted);font-size:.8rem}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:900px}th,td{text-align:left;padding:.75rem;border-top:1px solid var(--border);vertical-align:top}th{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.inline{display:grid;grid-template-columns:150px 1fr auto;gap:.4rem;margin-bottom:.4rem}.pill{display:inline-block;padding:.3rem .55rem;border-radius:999px;background:var(--warm);font-size:.78rem;font-weight:700}.pill.active,.pill.provisioned{background:#edf7f0;color:#205a36}.pill.disabled,.pill.suspended{background:#fff0f0;color:#8b2f2f}.pill.pending,.pill.requested{background:#fff7df;color:#745a14}code{background:var(--warm);padding:.2rem .35rem;border-radius:5px}@media(max-width:800px){.new-user{grid-template-columns:1fr}.inline{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}</style>`;
