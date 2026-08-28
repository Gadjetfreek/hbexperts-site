import appWorker from './representation-worker.js';
import { mlsConfigured, searchMls } from './mls-adapter.js';

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/search/profile') {
      return saveBuyerSearchProfile(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/search/profile') {
      const gate = await appWorker.fetch(request, env, ctx);
      if (gate.status === 403) return gate;
      return saveHbeSearchProfile(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/search/run') {
      const gate = await appWorker.fetch(request, env, ctx);
      if (gate.status === 403) return gate;
      return runHbeSearch(request, env);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (response.status !== 200 || !type.includes('text/html')) return response;

    let text = await response.text();

    try {
      if (request.method === 'GET' && url.pathname === '/portal') {
        const auth = await getBuyerSession(request, env);
        if (auth) {
          const caseId = await ensureCaseForBuyer(env, auth.buyer.id);
          const data = await searchData(env, caseId, auth.buyer.id);
          text = injectBeforeMainEnd(text, buyerSearchPanel(data));
        }
      }

      if (request.method === 'GET' && url.pathname === '/hbe') {
        const selectedBuyerId = clean(url.searchParams.get('buyer')) || await newestBuyerId(env);
        if (selectedBuyerId) {
          const caseId = await ensureCaseForBuyer(env, selectedBuyerId);
          const data = await searchData(env, caseId, selectedBuyerId);
          text = injectBeforeMainEnd(text, hbeSearchPanel(data, env));
        }
      }
    } catch (err) {
      console.error('Search workspace render failed', err);
    }

    text = text.replace('</head>', `${SEARCH_CSS}</head>`);
    return new Response(text, {status:response.status,statusText:response.statusText,headers});
  }
};

async function saveBuyerSearchProfile(request, env) {
  if (!sameOrigin(request)) return new Response('Invalid request origin',{status:403});
  const auth = await getBuyerSession(request, env);
  if (!auth) return redirect('/login');
  const caseId = await ensureCaseForBuyer(env, auth.buyer.id);
  const caseRow = await env.BUYER_DB.prepare('SELECT stage FROM buyer_cases WHERE id=?').bind(caseId).first();
  if (caseRow?.stage !== 'search') return new Response('Home Search is not active yet.',{status:409});

  const form = await request.formData();
  const now = new Date().toISOString();
  const existing = await env.BUYER_DB.prepare('SELECT * FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first();
  const profile = normalizeProfile(form, existing || {});

  await upsertProfile(env, caseId, profile, now, 'buyer');
  await env.BUYER_DB.prepare(`INSERT INTO buyer_search_confirmations (buyer_id,case_id,confirmed_at,profile_version)
    VALUES (?,?,?,?) ON CONFLICT(buyer_id) DO UPDATE SET case_id=excluded.case_id,confirmed_at=excluded.confirmed_at,profile_version=excluded.profile_version`)
    .bind(auth.buyer.id,caseId,now,profile.version).run();

  return redirect('/portal#home-search');
}

async function saveHbeSearchProfile(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');
  const caseId = await ensureCaseForBuyer(env, buyerId);
  const now = new Date().toISOString();
  const existing = await env.BUYER_DB.prepare('SELECT * FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first();
  const profile = normalizeProfile(form, existing || {});
  await upsertProfile(env, caseId, profile, now, clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE');
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#home-search`);
}

async function runHbeSearch(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');
  const caseId = await ensureCaseForBuyer(env, buyerId);
  const caseRow = await env.BUYER_DB.prepare('SELECT stage FROM buyer_cases WHERE id=?').bind(caseId).first();
  if (caseRow?.stage !== 'search') return messagePage('Search not active','Representation must be active before HBE runs the household MLS search.',409,buyerId);

  const profile = await env.BUYER_DB.prepare('SELECT * FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first();
  if (!profile) return messagePage('Search profile missing','Build and save the household search profile first.',409,buyerId);

  const confirmations = await env.BUYER_DB.prepare(`SELECT m.buyer_id,c.profile_version,c.confirmed_at
    FROM buyer_case_members m LEFT JOIN buyer_search_confirmations c ON c.buyer_id=m.buyer_id
    WHERE m.case_id=?`).bind(caseId).all();
  const notConfirmed = (confirmations.results || []).filter(row => Number(row.profile_version || 0) !== Number(profile.version || 0));
  if (notConfirmed.length) return messagePage('Buyer confirmation needed','Each linked buyer must confirm the current search profile before HBE runs the automated MLS search.',409,buyerId);

  if (!mlsConfigured(env)) return messagePage('MLS feed not connected','Stage 4 is ready, but the approved MLS Now/Trestle feed credentials have not been configured yet. No listing data was requested.',409,buyerId);

  try {
    const result = await searchMls(env, profile, {top:25});
    const now = new Date().toISOString();
    await env.BUYER_DB.prepare(`INSERT INTO buyer_search_runs
      (id,case_id,created_at,run_by,profile_version,provider,feed_mode,objective_query,result_count,status,error_text)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),caseId,now,clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE',profile.version,result.provider,result.feedMode,result.query,result.count ?? result.listings.length,'success',null).run();

    return searchResultPage(result, buyerId, profile);
  } catch (err) {
    const now = new Date().toISOString();
    await env.BUYER_DB.prepare(`INSERT INTO buyer_search_runs
      (id,case_id,created_at,run_by,profile_version,provider,feed_mode,objective_query,result_count,status,error_text)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),caseId,now,clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE',profile.version,'Trestle',String(env.MLS_FEED_MODE || 'VOW'),null,null,'error',String(err).slice(0,1000)).run();
    return messagePage('MLS search failed','The feed request failed safely. No stage or buyer criteria were changed. Review the configured feed credentials/permissions before retrying.',502,buyerId);
  }
}

async function upsertProfile(env, caseId, profile, now, updatedBy) {
  await env.BUYER_DB.prepare(`INSERT INTO buyer_search_profiles
    (case_id,created_at,updated_at,updated_by,version,price_min,price_max,cities,counties,postal_codes,property_types_json,beds_min,baths_min,sqft_min,lot_min_acres,garage_min,year_built_min,hard_constraints,preferences,tradeoffs,search_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(case_id) DO UPDATE SET
      updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=excluded.version,
      price_min=excluded.price_min,price_max=excluded.price_max,cities=excluded.cities,counties=excluded.counties,postal_codes=excluded.postal_codes,
      property_types_json=excluded.property_types_json,beds_min=excluded.beds_min,baths_min=excluded.baths_min,sqft_min=excluded.sqft_min,
      lot_min_acres=excluded.lot_min_acres,garage_min=excluded.garage_min,year_built_min=excluded.year_built_min,
      hard_constraints=excluded.hard_constraints,preferences=excluded.preferences,tradeoffs=excluded.tradeoffs,search_notes=excluded.search_notes`)
    .bind(caseId,now,now,updatedBy,profile.version,profile.price_min,profile.price_max,profile.cities,profile.counties,profile.postal_codes,profile.property_types_json,profile.beds_min,profile.baths_min,profile.sqft_min,profile.lot_min_acres,profile.garage_min,profile.year_built_min,profile.hard_constraints,profile.preferences,profile.tradeoffs,profile.search_notes).run();
}

function normalizeProfile(form, existing) {
  const nextVersion = Number(existing.version || 0) + 1;
  const min = intOrNull(form.get('price_min'));
  const max = intOrNull(form.get('price_max'));
  return {
    version:nextVersion,
    price_min:min,
    price_max:max !== null && min !== null && max < min ? min : max,
    cities:clean(form.get('cities')).slice(0,1000),
    counties:clean(form.get('counties')).slice(0,1000),
    postal_codes:clean(form.get('postal_codes')).slice(0,500),
    property_types_json:JSON.stringify(values(form,'property_types').slice(0,20)),
    beds_min:intOrNull(form.get('beds_min')),
    baths_min:intOrNull(form.get('baths_min')),
    sqft_min:intOrNull(form.get('sqft_min')),
    lot_min_acres:decimalOrNull(form.get('lot_min_acres')),
    garage_min:intOrNull(form.get('garage_min')),
    year_built_min:intOrNull(form.get('year_built_min')),
    hard_constraints:clean(form.get('hard_constraints')).slice(0,5000),
    preferences:clean(form.get('preferences')).slice(0,5000),
    tradeoffs:clean(form.get('tradeoffs')).slice(0,5000),
    search_notes:clean(form.get('search_notes')).slice(0,5000)
  };
}

async function searchData(env, caseId, selectedBuyerId) {
  const [caseRow,profile,members,runs] = await Promise.all([
    env.BUYER_DB.prepare('SELECT stage,completed_stages FROM buyer_cases WHERE id=?').bind(caseId).first(),
    env.BUYER_DB.prepare('SELECT * FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,c.confirmed_at,c.profile_version
      FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id
      LEFT JOIN buyer_search_confirmations c ON c.buyer_id=b.id
      WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all(),
    env.BUYER_DB.prepare(`SELECT created_at,run_by,profile_version,provider,feed_mode,result_count,status,error_text
      FROM buyer_search_runs WHERE case_id=? ORDER BY created_at DESC LIMIT 8`).bind(caseId).all()
  ]);
  return {caseId,selectedBuyerId,caseRow:caseRow || {},profile:profile || null,members:members.results || [],runs:runs.results || []};
}

function buyerSearchPanel(data) {
  const active = data.caseRow.stage === 'search';
  const p = data.profile || {};
  const me = data.members.find(m=>m.id===data.selectedBuyerId) || {};
  const confirmed = data.profile && Number(me.profile_version || 0) === Number(p.version || 0);
  if (!active) return `<section id="home-search" class="search-shell search-locked"><div class="search-kicker">STAGE 4 · BUILD YOUR HOME SEARCH</div><h2>Your search begins after representation is active.</h2><p>We can learn about what matters before then, but HBE will not treat you as an active represented search until the written representation agreement is in place.</p></section>`;

  return `<section id="home-search" class="search-shell"><div class="search-kicker">STAGE 4 · BUILD YOUR HOME SEARCH</div><h2>Turn what matters into a search we can learn from.</h2><p class="search-lede">An MLS filter is not your decision. This profile separates <strong>hard constraints</strong> from <strong>preferences</strong> and keeps tradeoffs visible as the market teaches us more.</p>${searchProfileForm(p,'/api/search/profile',null)}<div class="search-confirm ${confirmed?'confirmed':''}"><strong>${confirmed?'You confirmed this version of the search.':'Your confirmation is still needed.'}</strong><span>${confirmed?`Version ${esc(p.version)} is the current shared search profile.`:'Review the profile, make any corrections, then save it. Your save confirms the current version for you.'}</span></div></section>`;
}

function hbeSearchPanel(data, env) {
  const active = data.caseRow.stage === 'search';
  const p = data.profile || {};
  const everyoneConfirmed = data.profile && data.members.length && data.members.every(m=>Number(m.profile_version||0)===Number(p.version||0));
  return `<section id="home-search" class="search-shell search-hbe"><div class="search-head"><div><div class="search-kicker">STAGE 4 · BUILD YOUR HOME SEARCH · HBE WORKSPACE</div><h2>Household search profile</h2><p>Keep buyer meaning visible; compile only objective fields into the automated MLS query.</p></div><span class="search-stage ${active?'active':''}">${active?'Stage 4 active':'Waiting for representation'}</span></div>
    ${searchProfileForm(p,'/api/hbe/search/profile',data.selectedBuyerId)}
    <div class="search-member-grid">${data.members.map(m=>memberConfirmation(m,p)).join('')}</div>
    <div class="search-mls-box"><div><div class="search-kicker">MLS CONNECTION</div><h3>${mlsConfigured(env)?'Trestle feed configured':'Feed adapter ready · credentials not configured'}</h3><p>${mlsConfigured(env)?'The automated search will use only the objective fields above and will log each run.':'No MLS listing data is requested until the approved MLS Now/Trestle license and credentials are configured.'}</p></div><form method="post" action="/api/hbe/search/run"><input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}"><button type="submit" ${(!active||!data.profile||!everyoneConfirmed||!mlsConfigured(env))?'disabled':''}>Run MLS search</button></form></div>
    ${data.runs.length?`<div class="search-runs"><h3>Recent MLS runs</h3>${data.runs.map(runRow).join('')}</div>`:''}
  </section>`;
}

function searchProfileForm(p, action, buyerId) {
  const types = parseList(p.property_types_json);
  return `<form method="post" action="${action}" class="search-form">${buyerId?`<input type="hidden" name="buyer_id" value="${esc(buyerId)}">`:''}
    <div class="search-section"><div><small>MEANING</small><h3>What must the search protect?</h3></div><div class="search-text-grid"><label>Hard constraints<textarea name="hard_constraints" rows="4" placeholder="Things that truly rule a home in or out. Keep these few and defensible.">${esc(p.hard_constraints||'')}</textarea></label><label>Preferences<textarea name="preferences" rows="4" placeholder="Things we would like, but can trade when the alternative is better.">${esc(p.preferences||'')}</textarea></label><label>Known tradeoffs<textarea name="tradeoffs" rows="4" placeholder="What are we willing to exchange for what? Location for space, condition for price, commute for lot size..."></textarea>${p.tradeoffs?`<script type="application/json" class="prefill">${escJson(p.tradeoffs)}</script>`:''}</label><label>Search notes<textarea name="search_notes" rows="4" placeholder="Context that helps HBE interpret results without turning it into a hidden filter.">${esc(p.search_notes||'')}</textarea></label></div></div>
    <div class="search-section"><div><small>OBJECTIVE MLS CRITERIA</small><h3>What should the database actually filter?</h3><p>Use only objective fields here. Neighborhood character, demographics, schools-as-proxies, or subjective labels do not belong in the automated filter.</p></div>
      <div class="search-grid"><label>Price minimum<input type="number" min="0" step="1000" name="price_min" value="${val(p.price_min)}"></label><label>Price maximum<input type="number" min="0" step="1000" name="price_max" value="${val(p.price_max)}"></label><label>Bedrooms minimum<input type="number" min="0" max="20" name="beds_min" value="${val(p.beds_min)}"></label><label>Bathrooms minimum<input type="number" min="0" max="20" name="baths_min" value="${val(p.baths_min)}"></label><label>Living area minimum<input type="number" min="0" step="100" name="sqft_min" value="${val(p.sqft_min)}"></label><label>Lot minimum acres<input type="number" min="0" step="0.01" name="lot_min_acres" value="${val(p.lot_min_acres)}"></label><label>Garage spaces minimum<input type="number" min="0" max="20" name="garage_min" value="${val(p.garage_min)}"></label><label>Year built minimum<input type="number" min="1700" max="2100" name="year_built_min" value="${val(p.year_built_min)}"></label></div>
      <div class="search-text-grid"><label>Cities<textarea name="cities" rows="2" placeholder="Akron, Cuyahoga Falls">${esc(p.cities||'')}</textarea></label><label>Counties<textarea name="counties" rows="2" placeholder="Summit, Medina">${esc(p.counties||'')}</textarea></label><label>Postal codes<textarea name="postal_codes" rows="2" placeholder="44313, 44221">${esc(p.postal_codes||'')}</textarea></label></div>
      <fieldset class="search-types"><legend>Property types</legend>${['Residential','Residential Lease','Land'].map(t=>`<label><input type="checkbox" name="property_types" value="${esc(t)}" ${types.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join('')}</fieldset>
    </div>
    <div class="search-save"><div><strong>Saving creates a new profile version.</strong><span>Linked buyers confirm the same current version before automated MLS matching runs.</span></div><button type="submit">Save search profile</button></div>
  </form>`;
}

function memberConfirmation(m,p) {
  const confirmed = p.version && Number(m.profile_version||0)===Number(p.version||0);
  return `<article class="search-member ${confirmed?'confirmed':''}"><small>PROFILE CONFIRMATION</small><strong>${esc(m.first_name)} ${esc(m.last_name)}</strong><span>${confirmed?`Confirmed v${esc(p.version)}`:'Current version not confirmed'}</span>${m.confirmed_at?`<em>${esc(formatDateTime(m.confirmed_at))}</em>`:''}</article>`;
}
function runRow(r){return `<div class="search-run"><span>${esc(formatDateTime(r.created_at))}</span><strong>${esc(r.status)} · v${esc(r.profile_version)}</strong><span>${r.result_count===null?'—':`${esc(r.result_count)} result(s)`} · ${esc(r.provider||'')}</span></div>`;}

function searchResultPage(result,buyerId,profile){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MLS Search Results</title>${SEARCH_CSS}</head><body><main class="search-results"><div class="search-kicker">HBE · MLS SEARCH</div><h1>${esc(result.listings.length)} listings returned</h1><p>These are objective matches to search profile version ${esc(profile.version)}. Matching the filter is not an HBE recommendation.</p><div class="search-result-grid">${result.listings.map(listingCard).join('')||'<p>No current matches were returned.</p>'}</div><p><a href="/hbe?buyer=${encodeURIComponent(buyerId)}#home-search">Return to HBEUI</a></p></main></body></html>`,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
function listingCard(x){const address=x.UnparsedAddress||[x.City,x.StateOrProvince,x.PostalCode].filter(Boolean).join(', ')||'Address not supplied';return `<article class="listing-card"><small>${esc(x.StandardStatus||'')}</small><h3>${esc(address)}</h3><strong>${money(x.ListPrice)}</strong><p>${esc(x.BedroomsTotal??'—')} bd · ${esc(x.BathroomsTotalInteger??'—')} ba · ${esc(x.LivingArea??'—')} sq ft</p><p>${esc(x.PropertyType||'')} ${x.PropertySubType?`· ${esc(x.PropertySubType)}`:''}</p><footer>MLS #${esc(x.ListingId||x.ListingKey||'—')} · Listed by ${esc(x.ListOfficeName||'listing participant')}</footer></article>`;}

async function getBuyerSession(request,env){const token=getCookie(request,'hbe_session');if(!token)return null;const now=new Date().toISOString();const row=await env.BUYER_DB.prepare(`SELECT s.id AS session_id,s.buyer_id,s.expires_at,b.* FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token),now).first();if(!row)return null;await env.BUYER_DB.prepare('UPDATE buyer_sessions SET last_seen_at=? WHERE id=?').bind(now,row.session_id).run();return{session:{id:row.session_id,buyer_id:row.buyer_id},buyer:row};}
async function ensureCaseForBuyer(env,buyerId){const existing=await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=?').bind(buyerId).first();if(existing?.case_id)return existing.case_id;throw new Error('Buyer case not initialized');}
async function newestBuyerId(env){const row=await env.BUYER_DB.prepare('SELECT id FROM buyers ORDER BY submitted_at DESC LIMIT 1').first();return row?.id||null;}
function parseList(v){try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return[];}}
function values(form,name){return form.getAll(name).map(v=>clean(v)).filter(Boolean);}
function intOrNull(v){if(v===null||v==='')return null;const n=Number.parseInt(String(v),10);return Number.isFinite(n)&&n>=0?n:null;}
function decimalOrNull(v){if(v===null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;}
function val(v){return v===null||v===undefined?'':esc(v);}
function clean(v){return String(v??'').trim();}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function escJson(v=''){return JSON.stringify(String(v)).slice(1,-1).replace(/</g,'\\u003c');}
function money(v){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n):'Price not supplied';}
function formatDateTime(v){if(!v)return'';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v));}catch{return String(v);}}
function getCookie(request,name){const raw=request.headers.get('cookie')||'';for(const part of raw.split(';')){const[k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='));}return'';}
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}}
async function sha256(v){const d=await crypto.subtle.digest('SHA-256',enc.encode(v));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');}
function injectBeforeMainEnd(text,panel){const i=text.lastIndexOf('</main>');return i>=0?`${text.slice(0,i)}${panel}${text.slice(i)}`:text.replace('</body>',`${panel}</body>`);}
function redirect(location){return new Response(null,{status:303,headers:{location}});}
function messagePage(title,body,status,buyerId){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body><main style="max-width:720px;margin:4rem auto;padding:1rem;font-family:system-ui"><h1>${esc(title)}</h1><p>${esc(body)}</p><p><a href="/hbe?buyer=${encodeURIComponent(buyerId)}#home-search">Return to HBEUI</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}

const SEARCH_CSS=`<style id="hbe-search-workspace">.search-shell{max-width:1180px;margin:2rem auto;padding:1.35rem;background:#fff;border:1px solid #e8e5e0;border-radius:12px}.search-kicker,.search-section small,.search-member small{font-size:.7rem;font-weight:800;letter-spacing:.13em;color:#2d5a3d}.search-shell h2,.search-shell h3,.search-results h1,.listing-card h3{font-family:Georgia,serif;color:#1a1a2e}.search-shell h2{margin:.3rem 0 .6rem}.search-lede,.search-head p,.search-section p{color:#5f5f5f;line-height:1.55}.search-section{margin-top:1rem;padding-top:1rem;border-top:1px solid #e8e5e0}.search-section h3{margin:.2rem 0}.search-text-grid,.search-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.search-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.search-form label{display:block;font-weight:700;color:#1a1a2e}.search-form input,.search-form textarea,.search-form select{width:100%;font:inherit;padding:.72rem;border:1px solid #d9d5cf;border-radius:8px;background:#fff;margin-top:.35rem}.search-types{display:flex;flex-wrap:wrap;gap:.6rem;border:0;padding:0;margin:1rem 0}.search-types legend{font-weight:800;margin-bottom:.5rem}.search-types label{display:flex;align-items:center;gap:.45rem;border:1px solid #e8e5e0;padding:.55rem .7rem;border-radius:8px}.search-types input{width:auto;margin:0}.search-save,.search-head,.search-mls-box{display:flex;justify-content:space-between;align-items:center;gap:1rem}.search-save{margin-top:1rem;padding-top:1rem;border-top:1px solid #e8e5e0}.search-save strong,.search-save span,.search-confirm strong,.search-confirm span{display:block}.search-save span,.search-confirm span{color:#666;font-size:.88rem;margin-top:.2rem}.search-save button,.search-mls-box button{border:0;border-radius:7px;background:#2d5a3d;color:white;padding:.8rem 1rem;font-weight:800;cursor:pointer}.search-mls-box button:disabled{opacity:.45;cursor:not-allowed}.search-confirm,.search-mls-box,.search-member{margin-top:1rem;padding:.85rem;background:#faf9f6;border-radius:9px}.search-confirm.confirmed,.search-member.confirmed{border-left:3px solid #2d5a3d}.search-stage{padding:.35rem .65rem;border-radius:999px;background:#eee;font-size:.8rem;font-weight:800;white-space:nowrap}.search-stage.active{background:#e9f4ec;color:#2d5a3d}.search-member-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.7rem}.search-member strong,.search-member span,.search-member em{display:block}.search-member span{margin-top:.2rem}.search-member em{font-size:.78rem;color:#777;font-style:normal;margin-top:.2rem}.search-runs{margin-top:1rem}.search-run{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:.5rem;padding:.6rem 0;border-bottom:1px solid #eee;font-size:.86rem}.search-results{max-width:1100px;margin:3rem auto;padding:1rem;font-family:system-ui}.search-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.8rem}.listing-card{border:1px solid #e8e5e0;border-radius:10px;padding:1rem}.listing-card h3{margin:.3rem 0}.listing-card>strong{font-size:1.15rem}.listing-card p,.listing-card footer{color:#666}.listing-card footer{font-size:.78rem;border-top:1px solid #eee;padding-top:.6rem}.search-locked{background:#faf9f6}@media(max-width:800px){.search-grid{grid-template-columns:1fr 1fr}.search-text-grid{grid-template-columns:1fr}.search-save,.search-head,.search-mls-box{align-items:stretch;flex-direction:column}.search-run{grid-template-columns:1fr}.search-shell{margin:1rem .85rem}}@media(max-width:480px){.search-grid{grid-template-columns:1fr}}</style>`;
