import appWorker from './hbe-portal-sync-worker.js';

const enc = new TextEncoder();
const TIME_CATEGORIES = [
  'Strategy / consultation','Buyer profile / values clarification','Research / market analysis','Communication',
  'Showing preparation / scheduling','Showing travel','Showing time','Post-showing decision aid / review',
  'Offer analysis','Offer writing / negotiation','Due diligence / inspection','Appraisal / value analysis',
  'Financing coordination','Closing / final decision','Administration / compliance','Other'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/hbe/time') {
      if (!isHbe(request, env)) return forbidden();
      return addTime(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/hbe/household/link') {
      if (!isHbe(request, env)) return forbidden();
      return linkHousehold(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/hbe/financials') {
      if (!isHbe(request, env)) return forbidden();
      return saveFinancials(request, env);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (!type.includes('text/html') || response.status !== 200) return response;

    let text = await response.text();

    try {
      if (request.method === 'GET' && url.pathname === '/hbe' && isHbe(request, env)) {
        const selectedBuyerId = clean(url.searchParams.get('buyer')) || await newestBuyerId(env);
        if (selectedBuyerId) {
          const caseId = await ensureCaseForBuyer(env, selectedBuyerId);
          const data = await hbePilotData(env, caseId, selectedBuyerId);
          text = injectBeforeMainEnd(text, hbePilotPanel(data));
        }
      }

      if (request.method === 'GET' && url.pathname === '/portal') {
        const buyerId = await sessionBuyerId(request, env);
        if (buyerId) {
          const caseId = await ensureCaseForBuyer(env, buyerId);
          const data = await buyerHouseholdData(env, caseId, buyerId);
          text = injectBeforeMainEnd(text, buyerHouseholdPanel(data));
        }
      }
    } catch (err) {
      console.error('Pilot layer render failed', err);
    }

    text = text.replace('</head>', `${PILOT_CSS}</head>`);
    return new Response(text, {status: response.status, statusText: response.statusText, headers});
  }
};

async function addTime(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');
  const caseId = await ensureCaseForBuyer(env, buyerId);
  const minutes = Math.max(1, Math.min(1440, Number.parseInt(form.get('minutes') || '0', 10) || 0));
  const category = allowedCategory(form.get('category'));
  const stage = clean(form.get('stage')) || null;
  const note = clean(form.get('note')).slice(0, 500) || null;
  const now = new Date().toISOString();
  const professional = clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE';
  await env.BUYER_DB.prepare(`INSERT INTO buyer_time_entries (id,case_id,buyer_id,professional_email,created_at,minutes,category,stage,note) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), caseId, buyerId, professional, now, minutes, category, stage, note).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#pilot-ops`);
}

async function linkHousehold(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  const otherEmail = clean(form.get('other_email')).toLowerCase();
  if (!buyerId || !otherEmail) return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);

  const primary = await env.BUYER_DB.prepare('SELECT id,email FROM buyers WHERE id=?').bind(buyerId).first();
  const other = await env.BUYER_DB.prepare('SELECT id,email FROM buyers WHERE lower(email)=? ORDER BY submitted_at DESC LIMIT 1').bind(otherEmail).first();
  if (!primary || !other || primary.id === other.id) return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}&pilot=link-not-found#pilot-ops`);

  const caseId = await ensureCaseForBuyer(env, buyerId);
  const otherMembership = await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=?').bind(other.id).first();
  if (otherMembership?.case_id && otherMembership.case_id !== caseId) {
    const count = await env.BUYER_DB.prepare('SELECT COUNT(*) AS n FROM buyer_case_members WHERE case_id=?').bind(otherMembership.case_id).first();
    if (Number(count?.n || 0) > 1) return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}&pilot=other-case#pilot-ops`);
    await env.BUYER_DB.prepare('DELETE FROM buyer_case_members WHERE buyer_id=?').bind(other.id).run();
  }
  const now = new Date().toISOString();
  await env.BUYER_DB.prepare('INSERT OR IGNORE INTO buyer_case_members (case_id,buyer_id,role,created_at) VALUES (?,?,?,?)')
    .bind(caseId, other.id, 'buyer', now).run();
  await env.BUYER_DB.prepare('INSERT OR IGNORE INTO buyer_person_profiles (buyer_id,case_id,created_at,updated_at,profile_json) VALUES (?,?,?,?,?)')
    .bind(other.id, caseId, now, now, '{}').run();
  await env.BUYER_DB.prepare('UPDATE buyer_person_profiles SET case_id=?,updated_at=? WHERE buyer_id=?').bind(caseId, now, other.id).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}&pilot=linked#pilot-ops`);
}

async function saveFinancials(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');
  const caseId = await ensureCaseForBuyer(env, buyerId);
  const projected = moneyInt(form.get('projected_purchase_price'));
  const finalPrice = moneyInt(form.get('final_purchase_price'));
  const actual = moneyInt(form.get('actual_hbe_comp'));
  const notes = clean(form.get('notes')).slice(0, 500) || null;
  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO buyer_case_financials (case_id,updated_at,projected_purchase_price,final_purchase_price,pilot_rate,actual_hbe_comp,notes)
    VALUES (?,?,?,?,0.0275,?,?) ON CONFLICT(case_id) DO UPDATE SET updated_at=excluded.updated_at,projected_purchase_price=excluded.projected_purchase_price,final_purchase_price=excluded.final_purchase_price,actual_hbe_comp=excluded.actual_hbe_comp,notes=excluded.notes`)
    .bind(caseId, now, projected, finalPrice, actual, notes).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#pilot-economics`);
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

async function hbePilotData(env, caseId, selectedBuyerId) {
  const [membersResult,timeResult,financials] = await Promise.all([
    env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,b.email,b.stage,b.answers_json FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT id,created_at,professional_email,minutes,category,stage,note FROM buyer_time_entries WHERE case_id=? ORDER BY created_at DESC LIMIT 100').bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT * FROM buyer_case_financials WHERE case_id=?').bind(caseId).first()
  ]);
  return {caseId,selectedBuyerId,members:membersResult.results||[],entries:timeResult.results||[],financials:financials||{pilot_rate:0.0275}};
}

async function buyerHouseholdData(env, caseId, buyerId) {
  const result = await env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,b.email,b.stage FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all();
  return {caseId,buyerId,members:result.results||[]};
}

function hbePilotPanel(data) {
  const totalMinutes = data.entries.reduce((sum,e)=>sum+Number(e.minutes||0),0);
  const categoryTotals = Object.create(null);
  for (const e of data.entries) categoryTotals[e.category]=(categoryTotals[e.category]||0)+Number(e.minutes||0);
  const topCategories = Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const fin = data.financials || {};
  const price = Number(fin.final_purchase_price || fin.projected_purchase_price || 0);
  const pilot = price ? price * 0.0275 : 0;
  const comparisons = price ? [
    ['Pilot 2.75%',pilot],['2.5%',price*.025],['3.0%',price*.03],['$7,500 flat',7500],['$8,500 flat',8500],['$9,000 flat',9000]
  ] : [];

  return `<section id="pilot-ops" class="pilot-shell"><div class="pilot-title"><div><div class="pilot-eyebrow">PILOT OPERATIONS</div><h2>Time, household & compensation learning</h2></div><strong>${fmtHours(totalMinutes)} logged</strong></div>
    <div class="pilot-grid">
      <article class="pilot-card"><h3>Quick time entry</h3><p class="pilot-muted">Internal measurement only. This is not a buyer billing meter.</p>
        <form method="post" action="/api/hbe/time"><input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}"><div class="pilot-time-buttons">${[15,30,60,120].map(m=>`<button name="minutes" value="${m}">+${m<60?m+'m':m/60+'h'}</button>`).join('')}</div><label>Category<select name="category">${TIME_CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><label>Note <span>optional</span><input name="note" maxlength="500" placeholder="What did we work on?"></label><button class="pilot-primary" name="minutes" value="30">Log 30 minutes</button></form>
      </article>
      <article class="pilot-card"><h3>Case workload</h3><div class="pilot-metric"><strong>${fmtHours(totalMinutes)}</strong><span>total professional time logged</span></div>${topCategories.length?`<div class="pilot-bars">${topCategories.map(([c,m])=>`<div><span>${esc(c)}</span><strong>${fmtHours(m)}</strong></div>`).join('')}</div>`:'<p class="pilot-muted">No time entries yet. Start loose; consistency matters more than precision.</p>'}</article>
      <article class="pilot-card"><h3>Household</h3><p class="pilot-muted">Each person keeps their own login and answers while sharing one case.</p><div class="pilot-members">${data.members.map(m=>`<div><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><span>${esc(m.email)}</span></div>`).join('')}</div><form method="post" action="/api/hbe/household/link"><input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}"><label>Link another submitted buyer by email<input type="email" name="other_email" required placeholder="their@email.com"></label><button class="pilot-primary">Link to this case</button></form></article>
    </div>
    <article id="pilot-economics" class="pilot-card pilot-economics"><div class="pilot-title"><div><div class="pilot-eyebrow">COMPENSATION LAB</div><h3>Pilot at 2.75%; compare alternatives beside it</h3></div></div><form class="pilot-fin-form" method="post" action="/api/hbe/financials"><input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}"><label>Projected purchase price<input type="number" min="0" step="1000" name="projected_purchase_price" value="${fin.projected_purchase_price||''}"></label><label>Final purchase price<input type="number" min="0" step="1000" name="final_purchase_price" value="${fin.final_purchase_price||''}"></label><label>Actual HBE compensation<input type="number" min="0" step="1" name="actual_hbe_comp" value="${fin.actual_hbe_comp||''}"></label><label>Notes<input name="notes" value="${esc(fin.notes||'')}"></label><button class="pilot-primary">Save</button></form>${comparisons.length?`<div class="pilot-compare">${comparisons.map(([name,amount])=>`<div><span>${esc(name)}</span><strong>${money(amount)}</strong>${totalMinutes?`<small>${money(amount/(totalMinutes/60))}/logged hr</small>`:''}</div>`).join('')}</div>`:'<p class="pilot-muted">Enter a projected purchase price to compare compensation models while the case develops.</p>'}</article>
  </section>`;
}

function buyerHouseholdPanel(data) {
  const me = data.members.find(m=>m.id===data.buyerId);
  const others = data.members.filter(m=>m.id!==data.buyerId);
  return `<section class="buyer-household"><div class="pilot-eyebrow">YOUR BUYING TEAM</div><h2>One journey. Individual voices.</h2><p>${others.length ? `You and ${others.map(o=>esc(o.first_name)).join(' & ')} are connected to the same home-buying journey. Shared facts, showings, dates and decisions can stay together while each of you keeps your own login and individual reflections.` : `This is your individual view. If another buyer is part of the decision, HBE can connect their separate account to this same journey after they complete their own Buyer Experience.`}</p><div class="buyer-view-tabs"><span class="active">My View${me?` · ${esc(me.first_name)}`:''}</span><span>${others.length?'Our Shared View':'Shared View · not connected yet'}</span></div>${others.length?`<div class="household-members">${data.members.map(m=>`<div class="${m.id===data.buyerId?'me':''}"><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><small>${m.id===data.buyerId?'You · individual answers remain yours':'Connected buyer · same shared journey'}</small></div>`).join('')}</div>`:''}</section>`;
}

async function newestBuyerId(env){const row=await env.BUYER_DB.prepare('SELECT id FROM buyers ORDER BY submitted_at DESC LIMIT 1').first();return row?.id||null}
async function sessionBuyerId(request,env){const token=getCookie(request,'hbe_session');if(!token)return null;const row=await env.BUYER_DB.prepare('SELECT buyer_id FROM buyer_sessions WHERE token_hash=? AND expires_at>? LIMIT 1').bind(await sha256(token),new Date().toISOString()).first();return row?.buyer_id||null}
function injectBeforeMainEnd(text,panel){const i=text.lastIndexOf('</main>');return i>=0?text.slice(0,i)+panel+text.slice(i):text.replace('</body>',panel+'</body>')}
function isHbe(request,env){const email=clean(request.headers.get('Cf-Access-Authenticated-User-Email')).toLowerCase();return !!email&&email===String(env.HBE_ADMIN_EMAIL||'').toLowerCase()}
function forbidden(){return new Response('HBE access required',{status:403})}
function redirect(location){return new Response(null,{status:303,headers:{location}})}
function allowedCategory(v){const c=clean(v);return TIME_CATEGORIES.includes(c)?c:'Other'}
function moneyInt(v){const n=Number.parseInt(String(v||'').replace(/[^0-9]/g,''),10);return Number.isFinite(n)&&n>=0?n:null}
function clean(v){return String(v??'').trim()}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function money(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v||0))}
function fmtHours(m){const h=Number(m||0)/60;return h<1?`${Math.round(Number(m||0))} min`:`${h.toFixed(h>=10?1:2)} hr`}
function getCookie(request,name){const raw=request.headers.get('cookie')||'';for(const part of raw.split(';')){const[k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='))}return null}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',enc.encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}

const PILOT_CSS=`<style id="hbe-pilot-style">.pilot-shell{max-width:1180px;margin:2rem auto;padding:0 1.5rem}.pilot-title{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.pilot-title h2,.pilot-title h3{margin:.15rem 0;color:#1a1a2e;font-family:Georgia,serif}.pilot-eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.13em;color:#2d5a3d}.pilot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin:1rem 0}.pilot-card{border:1px solid #e8e5e0;background:#fff;border-radius:12px;padding:1rem}.pilot-card h3{margin:.1rem 0 .4rem;color:#1a1a2e}.pilot-muted{color:#6b6b6b;font-size:.88rem}.pilot-card label{display:block;font-size:.82rem;font-weight:700;margin:.7rem 0}.pilot-card label span{font-weight:400;color:#777}.pilot-card input,.pilot-card select{width:100%;padding:.65rem;border:1px solid #dcd7cf;border-radius:7px;margin-top:.3rem}.pilot-time-buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem}.pilot-time-buttons button,.pilot-primary{border:0;border-radius:7px;padding:.62rem .7rem;font-weight:700;cursor:pointer}.pilot-time-buttons button{background:#f3f1ed;color:#2d5a3d}.pilot-primary{background:#2d5a3d;color:#fff}.pilot-metric strong{font:600 2rem Georgia,serif;color:#1a1a2e;display:block}.pilot-metric span{color:#6b6b6b}.pilot-bars>div,.pilot-members>div{display:flex;justify-content:space-between;gap:.7rem;padding:.45rem 0;border-top:1px solid #eee}.pilot-bars span,.pilot-members span{color:#6b6b6b;font-size:.82rem}.pilot-members>div{display:grid}.pilot-economics{margin-top:1rem}.pilot-fin-form{display:grid;grid-template-columns:repeat(5,1fr);gap:.6rem;align-items:end}.pilot-compare{display:grid;grid-template-columns:repeat(6,1fr);gap:.55rem;margin-top:1rem}.pilot-compare>div{background:#faf9f6;border-radius:9px;padding:.7rem}.pilot-compare span,.pilot-compare small{display:block;color:#6b6b6b;font-size:.75rem}.pilot-compare strong{display:block;color:#1a1a2e;margin:.15rem 0}.buyer-household{margin:2rem 0;padding:1.25rem;border:1px solid #e8e5e0;background:#faf9f6;border-radius:12px}.buyer-household h2{font:600 1.45rem Georgia,serif;color:#1a1a2e;margin:.25rem 0}.buyer-view-tabs{display:flex;gap:.5rem;margin:1rem 0}.buyer-view-tabs span{padding:.45rem .75rem;border-radius:999px;border:1px solid #ddd8cf;font-size:.82rem}.buyer-view-tabs .active{background:#2d5a3d;color:#fff;border-color:#2d5a3d}.household-members{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem}.household-members>div{background:#fff;border:1px solid #e8e5e0;border-radius:8px;padding:.7rem}.household-members strong,.household-members small{display:block}.household-members small{color:#6b6b6b}.household-members .me{border-left:3px solid #2d5a3d}@media(max-width:900px){.pilot-grid{grid-template-columns:1fr}.pilot-fin-form{grid-template-columns:1fr 1fr}.pilot-compare{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){.pilot-shell{padding:0 1rem}.pilot-fin-form,.pilot-compare,.household-members{grid-template-columns:1fr}.pilot-time-buttons{grid-template-columns:1fr 1fr}.pilot-title{display:block}}</style>`;
