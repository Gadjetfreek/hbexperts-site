const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/') return html(landing());
      if (request.method === 'GET' && url.pathname === '/questionnaire') return html(questionnaire());
      if (request.method === 'POST' && url.pathname === '/api/intake') return createBuyer(request, env);
      if (request.method === 'GET' && url.pathname === '/buyer') return buyerHome(request, env);
      if (request.method === 'GET' && url.pathname === '/login') return html(loginPage());
      if (request.method === 'POST' && url.pathname === '/api/login') return loginBuyer(request, env);
      if (request.method === 'GET' && url.pathname === '/hbe') return hbeHome(request, env);
      if (request.method === 'POST' && url.pathname.startsWith('/api/hbe/buyer/')) return updateStage(request, env, url);
      if (request.method === 'GET' && url.pathname === '/health') return json({ok:true, service:'hbe-buyer-platform'});
      return new Response('Not found', {status:404});
    } catch (err) {
      console.error(err);
      return html(errorPage(), 500);
    }
  }
};

async function createBuyer(request, env) {
  const form = await request.formData();
  const first = clean(form.get('first_name'));
  const last = clean(form.get('last_name'));
  const email = clean(form.get('email')).toLowerCase();
  if (!first || !last || !email) return html(questionnaire('Please provide your first name, last name, and email.'), 400);

  const id = crypto.randomUUID();
  const token = randomToken(24);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
  const tokenHash = await sha256(token);
  const codeHash = await sha256(`${email}:${code}`);
  const now = new Date().toISOString();
  const answers = {
    phone: clean(form.get('phone')),
    why: clean(form.get('why')),
    timeline: clean(form.get('timeline')),
    location: clean(form.get('location')),
    financing: clean(form.get('financing')),
    concerns: clean(form.get('concerns')),
    notes: clean(form.get('notes'))
  };

  await env.BUYER_DB.prepare(`INSERT INTO buyers
    (id,created_at,updated_at,first_name,last_name,email,phone,stage,completed_stages,answers_json,buyer_token_hash,access_code_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, now, now, first, last, email, answers.phone, 'consultation', JSON.stringify(['buyerExperience']), JSON.stringify(answers), tokenHash, codeHash)
    .run();

  return html(welcome(first, code), 200, cookie(token));
}

async function buyerHome(request, env) {
  const token = getCookie(request, 'hbe_buyer');
  if (!token) return redirect('/login');
  const buyer = await findBuyerByToken(env, token);
  if (!buyer) return redirect('/login');
  return html(buyerUI(buyer));
}

async function loginBuyer(request, env) {
  const form = await request.formData();
  const email = clean(form.get('email')).toLowerCase();
  const code = clean(form.get('code'));
  const codeHash = await sha256(`${email}:${code}`);
  const buyer = await env.BUYER_DB.prepare('SELECT * FROM buyers WHERE email = ? AND access_code_hash = ? ORDER BY created_at DESC LIMIT 1').bind(email, codeHash).first();
  if (!buyer) return html(loginPage('That email and access code did not match.'), 401);
  const token = randomToken(24);
  const tokenHash = await sha256(token);
  await env.BUYER_DB.prepare('UPDATE buyers SET buyer_token_hash = ?, updated_at = ? WHERE id = ?').bind(tokenHash, new Date().toISOString(), buyer.id).run();
  return redirect('/buyer', cookie(token));
}

async function hbeHome(request, env) {
  if (!isHbe(request, env)) return new Response('HBE access required', {status:403});
  const {results} = await env.BUYER_DB.prepare('SELECT id,created_at,updated_at,first_name,last_name,email,phone,stage,completed_stages,answers_json FROM buyers ORDER BY created_at DESC').all();
  return html(hbeUI(results || []));
}

async function updateStage(request, env, url) {
  if (!isHbe(request, env)) return new Response('HBE access required', {status:403});
  const id = decodeURIComponent(url.pathname.split('/').pop());
  const form = await request.formData();
  const stage = clean(form.get('stage'));
  const allowed = ['consultation','representation','search','market','possibilities','evaluation','offer','terms','negotiation','diligence','inspection','value','loan','commitment','closing','complete'];
  if (!allowed.includes(stage)) return new Response('Invalid stage', {status:400});
  await env.BUYER_DB.prepare('UPDATE buyers SET stage = ?, updated_at = ? WHERE id = ?').bind(stage, new Date().toISOString(), id).run();
  return redirect('/hbe');
}

async function findBuyerByToken(env, token) {
  return env.BUYER_DB.prepare('SELECT * FROM buyers WHERE buyer_token_hash = ?').bind(await sha256(token)).first();
}

function isHbe(request, env) {
  const email = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase();
  return email && email === String(env.HBE_ADMIN_EMAIL || '').toLowerCase();
}

function landing() {
  return shell('HomeBuyer Experts Buyer Experience', `
    <section class="hero"><div class="eyebrow">HomeBuyer Experts</div><h1>Your HomeBuyer journey starts with you.</h1>
    <p class="lede">Before we talk about houses, we want to understand the human making the decision. This first step is the Buyer Experience questionnaire.</p>
    <p>You can look around here without an account. We do not create your private BuyerUI until you choose to begin and submit the questionnaire.</p>
    <a class="btn primary" href="/questionnaire">Start the Buyer Experience</a>
    <a class="btn ghost" href="/login">Already started? Open my BuyerUI</a></section>`);
}

function questionnaire(message='') {
  return shell('Buyer Experience', `
    <section><div class="eyebrow">Step 1 · Buyer Experience</div><h1>Tell us where you are starting from.</h1>
    <p class="lede">There are no perfect answers. Share what you know today; uncertainty is useful information too.</p>${message?`<div class="notice">${esc(message)}</div>`:''}
    <form method="post" action="/api/intake">
      <div class="grid2"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Last name<input name="last_name" autocomplete="family-name" required></label></div>
      <div class="grid2"><label>Email<input type="email" name="email" autocomplete="email" required></label><label>Phone<input name="phone" autocomplete="tel"></label></div>
      <label>Why are you thinking about buying a home now?<textarea name="why" rows="4"></textarea></label>
      <label>What timing are you imagining?<input name="timeline" placeholder="For example: soon, this fall, next year, unsure"></label>
      <label>Where are you hoping to live?<input name="location" placeholder="Cities, neighborhoods, school area, commute, or unsure"></label>
      <label>Where are you with financing?<select name="financing"><option value="">Choose one</option><option>Haven't started</option><option>Talking with lenders</option><option>Preapproved</option><option>Cash purchase</option><option>Not sure</option></select></label>
      <label>What concerns or questions are already on your mind?<textarea name="concerns" rows="4"></textarea></label>
      <label>Anything else you want HBE to understand at the start?<textarea name="notes" rows="4"></textarea></label>
      <button class="btn primary" type="submit">Save my Buyer Experience</button>
    </form></section>`);
}

function welcome(first, code) {
  return shell('Buyer Experience saved', `
    <section class="hero"><div class="eyebrow">Buyer Experience saved</div><h1>Thanks, ${esc(first)}.</h1>
    <p class="lede">Your private buyer record now exists in HBE's central system. Your next stop is the consultation.</p>
    <div class="code"><small>Your cross-device access code</small><strong>${esc(code)}</strong></div>
    <p>Keep this six-digit code. On another phone, tablet, or computer, use your email plus this code to open the same BuyerUI.</p>
    <a class="btn primary" href="/buyer">Open my BuyerUI</a></section>`);
}

function loginPage(message='') {
  return shell('Open my BuyerUI', `<section class="hero"><div class="eyebrow">Private BuyerUI</div><h1>Open your journey on this device.</h1>
  <p class="lede">Use the same email you entered in the Buyer Experience and your six-digit access code.</p>${message?`<div class="notice">${esc(message)}</div>`:''}
  <form method="post" action="/api/login"><label>Email<input type="email" name="email" required></label><label>Access code<input inputmode="numeric" pattern="[0-9]{6}" name="code" required></label><button class="btn primary">Open my BuyerUI</button></form></section>`);
}

function buyerUI(b) {
  const completed = JSON.parse(b.completed_stages || '[]');
  const steps = [
    ['buyerExperience','Buyer Experience'],['consultation','Consultation'],['representation','Hire HBE'],['search','Build Your Home Search'],['market','Learn the Market'],['possibilities','Discover Possibilities'],['evaluation','Evaluate Homes'],['offer','Ready to Offer?'],['terms','Build the Offer'],['negotiation','Negotiate Wisely'],['diligence','Learn What We Did Not Know'],['inspection','Inspection Decision'],['value','Value Check'],['loan','Final Financing'],['commitment','Final Decision'],['closing','Get the Keys']
  ];
  let reached = true;
  const stageHtml = steps.map(([id,label],i) => {
    const done = completed.includes(id) || steps.findIndex(x=>x[0]===b.stage) > i;
    const current = id === b.stage;
    const open = done || current;
    if(current) reached=false;
    return `<div class="step ${done?'done':''} ${current?'current':''} ${open?'':'locked'}"><span>${done?'✓':i+1}</span><div><strong>${esc(label)}</strong><small>${current?'Current step':done?'Completed':'We will open this when you reach it.'}</small></div></div>`;
  }).join('');
  return shell(`${b.first_name}'s BuyerUI`, `<section><div class="eyebrow">HomeBuyer Experts · BuyerUI</div><h1>${esc(b.first_name)}'s HomeBuyer Roadmap</h1><p class="lede">One journey. The same state on every device.</p><div class="status"><small>Current step</small><strong>${esc(titleCase(b.stage))}</strong></div><div class="road">${stageHtml}</div><p class="muted">HBE and your BuyerUI now read this stage from the central buyer record rather than this browser.</p></section>`);
}

function hbeUI(rows) {
  const cards = rows.map(b => {
    const a = safeJson(b.answers_json);
    return `<article class="buyer"><div class="eyebrow">${esc(b.stage)}</div><h2>${esc(b.first_name)} ${esc(b.last_name)}</h2><p>${esc(b.email)}${b.phone?` · ${esc(b.phone)}`:''}</p><p><strong>WHY:</strong> ${esc(a.why||'Not stated')}</p><p><strong>Timing:</strong> ${esc(a.timeline||'Not stated')}</p><form method="post" action="/api/hbe/buyer/${encodeURIComponent(b.id)}/stage"><label>Current journey step<select name="stage">${['consultation','representation','search','market','possibilities','evaluation','offer','terms','negotiation','diligence','inspection','value','loan','commitment','closing','complete'].map(s=>`<option ${s===b.stage?'selected':''}>${s}</option>`).join('')}</select></label><button class="btn primary">Update shared state</button></form></article>`;
  }).join('');
  return shell('HBEUI', `<section><div class="eyebrow">HomeBuyer Experts · HBEUI</div><h1>Active buyers</h1><p class="lede">This screen and every BuyerUI are reading the same D1 record.</p><div class="buyers">${cards||'<p>No buyer records yet.</p>'}</div></section>`);
}

function shell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(title)}</title><style>
  :root{--ink:#34271d;--paper:#f4e6bf;--paper2:#ead6a4;--deep:#49331f;--gold:#a87523}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#cfb77d,#bfa064);color:var(--ink);font-family:Inter,system-ui,sans-serif;min-height:100vh}.wrap{max-width:980px;margin:auto;padding:28px 18px 70px}section{background:rgba(249,237,204,.94);border:1px solid #8f7043;border-radius:20px;padding:clamp(22px,5vw,48px);box-shadow:0 20px 60px #4d351c33}.hero{margin-top:8vh}.eyebrow{font-size:11px;font-weight:850;letter-spacing:.15em;text-transform:uppercase;color:#76511e}h1,h2{font-family:Georgia,serif}h1{font-size:clamp(36px,7vw,68px);line-height:.98;margin:10px 0 18px}h2{margin:4px 0}.lede{font-size:18px;line-height:1.55;max-width:760px}.btn{display:inline-block;border:0;border-radius:999px;padding:13px 18px;margin:10px 8px 0 0;text-decoration:none;font-weight:800;cursor:pointer}.primary{background:var(--deep);color:white}.ghost{background:transparent;border:1px solid #80633d;color:var(--deep)}label{display:block;font-weight:750;margin:16px 0 6px}input,textarea,select{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid #9d8057;background:#fffaf0}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.notice{background:#fff2c8;border-left:4px solid var(--gold);padding:12px}.code{display:inline-grid;padding:16px 22px;border:1px dashed #7c5c2d;background:#fff4d6;border-radius:14px;margin:12px 0}.code small{font-weight:800;text-transform:uppercase}.code strong{font:700 40px Georgia,serif;letter-spacing:.12em}.status{display:inline-grid;background:#4a3422;color:#fff;padding:12px 16px;border-radius:12px;margin:8px 0 22px}.status small{text-transform:uppercase;font-weight:800}.status strong{font:700 24px Georgia,serif}.road{display:grid;gap:9px}.step{display:grid;grid-template-columns:40px 1fr;gap:10px;align-items:center;padding:10px 12px;background:#f7e9c4;border:1px solid #9a794c;border-radius:12px}.step>span{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:2px solid #76572f;font-weight:900}.step strong,.step small{display:block}.step.current{outline:3px solid #b17a22}.step.done>span{background:#4a3422;color:white}.step.locked{opacity:.46}.buyers{display:grid;gap:14px}.buyer{background:#f8eac6;border:1px solid #957344;border-radius:14px;padding:18px}.muted{opacity:.75}@media(max-width:640px){.grid2{grid-template-columns:1fr}.wrap{padding:12px 10px 50px}section{border-radius:14px}h1{font-size:40px}.btn{width:100%;text-align:center;margin-right:0}}
  </style></head><body><main class="wrap">${body}</main></body></html>`;
}

function errorPage(){return shell('Something went wrong','<section><h1>Something went wrong.</h1><p>Your answers were not intentionally discarded. Please return and try again or contact HBE.</p></section>')}
function clean(v){return String(v??'').trim().slice(0,5000)}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function safeJson(v){try{return JSON.parse(v||'{}')}catch{return {}}}
function titleCase(v){return String(v||'').replace(/([A-Z])/g,' $1').replace(/^./,m=>m.toUpperCase())}
function randomToken(bytes){const a=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function sha256(v){const d=await crypto.subtle.digest('SHA-256',enc.encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function getCookie(req,name){const hit=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return hit?decodeURIComponent(hit.slice(name.length+1)):''}
function cookie(token){return {'Set-Cookie':`hbe_buyer=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}}
function html(body,status=200,extra={}){return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...extra}})}
function json(obj){return new Response(JSON.stringify(obj),{headers:{'content-type':'application/json','cache-control':'no-store'}})}
function redirect(path,extra={}){return new Response(null,{status:303,headers:{Location:path,...extra}})}
