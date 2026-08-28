import appWorker from './search-worker.js';

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/search/profile') {
      return saveBuyerProfileWithoutConfirming(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/search/confirm') {
      return confirmCurrentSearchProfile(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/household/invite') {
      const locked = await currentBuyerHouseholdLocked(request, env);
      if (locked) return lockedHouseholdPage();
    }

    const inviteToken = await requestInviteToken(request, url);
    if (inviteToken) {
      const locked = await invitationCaseLocked(env, inviteToken);
      if (locked) return lockedHouseholdPage();
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (request.method !== 'GET' || url.pathname !== '/portal' || response.status !== 200 || !type.includes('text/html')) {
      return response;
    }

    let text = await response.text();
    const marker = 'Review the profile, make any corrections, then save it. Your save confirms the current version for you.</span>';
    if (text.includes(marker)) {
      text = text.replace(marker, `Review the profile and save any corrections. Saving creates a new version; then confirm that exact version below.</span><form method="post" action="/api/search/confirm" class="search-confirm-form"><button type="submit">Confirm current version</button></form>`);
      text = text.replace('</head>', `${STATE_CSS}</head>`);
    }
    return new Response(text,{status:response.status,statusText:response.statusText,headers});
  }
};

async function saveBuyerProfileWithoutConfirming(request, env) {
  if (!sameOrigin(request)) return new Response('Invalid request origin',{status:403});
  const auth = await getBuyerSession(request, env);
  if (!auth) return redirect('/login');
  const caseId = await caseForBuyer(env, auth.buyer.id);
  if (!caseId) return new Response('Buyer case not initialized',{status:409});
  const caseRow = await env.BUYER_DB.prepare('SELECT stage FROM buyer_cases WHERE id=?').bind(caseId).first();
  if (caseRow?.stage !== 'search') return new Response('Home Search is not active yet.',{status:409});

  const form = await request.formData();
  const now = new Date().toISOString();
  const existing = await env.BUYER_DB.prepare('SELECT * FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first();
  const profile = normalizeProfile(form, existing || {});
  await upsertProfile(env,caseId,profile,now,`buyer:${auth.buyer.id}`);

  // Do not confirm here. A profile edit creates a new immutable version that
  // every linked buyer must explicitly confirm in a separate action.
  return redirect('/portal#home-search');
}

async function confirmCurrentSearchProfile(request, env) {
  if (!sameOrigin(request)) return new Response('Invalid request origin',{status:403});
  const auth = await getBuyerSession(request, env);
  if (!auth) return redirect('/login');
  const caseId = await caseForBuyer(env, auth.buyer.id);
  if (!caseId) return new Response('Buyer case not initialized',{status:409});
  const caseRow = await env.BUYER_DB.prepare('SELECT stage FROM buyer_cases WHERE id=?').bind(caseId).first();
  if (caseRow?.stage !== 'search') return new Response('Home Search is not active yet.',{status:409});
  const profile = await env.BUYER_DB.prepare('SELECT version FROM buyer_search_profiles WHERE case_id=? LIMIT 1').bind(caseId).first();
  if (!profile?.version) return new Response('Search profile missing',{status:409});

  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO buyer_search_confirmations (buyer_id,case_id,confirmed_at,profile_version)
    VALUES (?,?,?,?) ON CONFLICT(buyer_id) DO UPDATE SET
      case_id=excluded.case_id,confirmed_at=excluded.confirmed_at,profile_version=excluded.profile_version`)
    .bind(auth.buyer.id,caseId,now,profile.version).run();
  return redirect('/portal#home-search');
}

async function currentBuyerHouseholdLocked(request, env) {
  const auth = await getBuyerSession(request, env);
  if (!auth) return false;
  const caseId = await caseForBuyer(env, auth.buyer.id);
  if (!caseId) return false;
  return caseLocked(env,caseId);
}

async function invitationCaseLocked(env, token) {
  const hash = await sha256(token);
  const invite = await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_invitations WHERE token_hash=? LIMIT 1').bind(hash).first();
  if (!invite?.case_id) return false;
  return caseLocked(env,invite.case_id);
}

async function caseLocked(env, caseId) {
  const [caseRow,rep] = await Promise.all([
    env.BUYER_DB.prepare('SELECT stage FROM buyer_cases WHERE id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare('SELECT agreement_status FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first()
  ]);
  return caseRow?.stage === 'search' || rep?.agreement_status === 'signed';
}

async function requestInviteToken(request,url) {
  if (request.method === 'GET' && url.pathname.startsWith('/invite/')) {
    return clean(decodeURIComponent(url.pathname.slice('/invite/'.length)));
  }
  if (request.method === 'GET' && url.pathname === '/questionnaire') {
    return clean(url.searchParams.get('invite'));
  }
  if (request.method === 'POST' && url.pathname === '/api/intake') {
    try {
      const form=await request.clone().formData();
      return clean(form.get('household_invite_token'));
    } catch { return ''; }
  }
  return '';
}

async function getBuyerSession(request,env) {
  const token=getCookie(request,'hbe_session');
  if(!token)return null;
  const now=new Date().toISOString();
  const row=await env.BUYER_DB.prepare(`SELECT s.id AS session_id,s.buyer_id,s.expires_at,b.*
    FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token),now).first();
  if(!row)return null;
  return {session:{id:row.session_id,buyer_id:row.buyer_id},buyer:row};
}
async function caseForBuyer(env,buyerId){const row=await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=? LIMIT 1').bind(buyerId).first();return row?.case_id||null;}

async function upsertProfile(env,caseId,p,now,updatedBy){
  await env.BUYER_DB.prepare(`INSERT INTO buyer_search_profiles
    (case_id,created_at,updated_at,updated_by,version,price_min,price_max,cities,counties,postal_codes,property_types_json,beds_min,baths_min,sqft_min,lot_min_acres,garage_min,year_built_min,hard_constraints,preferences,tradeoffs,search_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(case_id) DO UPDATE SET
      updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=excluded.version,
      price_min=excluded.price_min,price_max=excluded.price_max,cities=excluded.cities,counties=excluded.counties,postal_codes=excluded.postal_codes,
      property_types_json=excluded.property_types_json,beds_min=excluded.beds_min,baths_min=excluded.baths_min,sqft_min=excluded.sqft_min,
      lot_min_acres=excluded.lot_min_acres,garage_min=excluded.garage_min,year_built_min=excluded.year_built_min,
      hard_constraints=excluded.hard_constraints,preferences=excluded.preferences,tradeoffs=excluded.tradeoffs,search_notes=excluded.search_notes`)
    .bind(caseId,now,now,updatedBy,p.version,p.price_min,p.price_max,p.cities,p.counties,p.postal_codes,p.property_types_json,p.beds_min,p.baths_min,p.sqft_min,p.lot_min_acres,p.garage_min,p.year_built_min,p.hard_constraints,p.preferences,p.tradeoffs,p.search_notes).run();
}
function normalizeProfile(form,existing){const min=intOrNull(form.get('price_min')),max=intOrNull(form.get('price_max'));return{
  version:Number(existing.version||0)+1,price_min:min,price_max:max!==null&&min!==null&&max<min?min:max,
  cities:clean(form.get('cities')).slice(0,1000),counties:clean(form.get('counties')).slice(0,1000),postal_codes:clean(form.get('postal_codes')).slice(0,500),
  property_types_json:JSON.stringify(values(form,'property_types').slice(0,20)),beds_min:intOrNull(form.get('beds_min')),baths_min:intOrNull(form.get('baths_min')),
  sqft_min:intOrNull(form.get('sqft_min')),lot_min_acres:decimalOrNull(form.get('lot_min_acres')),garage_min:intOrNull(form.get('garage_min')),year_built_min:intOrNull(form.get('year_built_min')),
  hard_constraints:clean(form.get('hard_constraints')).slice(0,5000),preferences:clean(form.get('preferences')).slice(0,5000),tradeoffs:clean(form.get('tradeoffs')).slice(0,5000),search_notes:clean(form.get('search_notes')).slice(0,5000)
};}
function values(form,name){return form.getAll(name).map(v=>clean(v)).filter(Boolean);}
function intOrNull(v){if(v===null||v==='')return null;const n=Number.parseInt(String(v),10);return Number.isFinite(n)&&n>=0?n:null;}
function decimalOrNull(v){if(v===null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;}
function getCookie(request,name){const raw=request.headers.get('cookie')||'';for(const part of raw.split(';')){const[k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='));}return'';}
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}}
function clean(v){return String(v??'').trim().slice(0,10000);}
async function sha256(v){const d=await crypto.subtle.digest('SHA-256',enc.encode(v));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');}
function redirect(location){return new Response(null,{status:303,headers:{location}});}
function lockedHouseholdPage(){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Household locked</title></head><body><main style="max-width:720px;margin:4rem auto;padding:1rem;font-family:system-ui"><h1>Household membership is locked.</h1><p>Representation is already active for this buyer case. Adding another buyer now requires a deliberate representation-amendment workflow so the agreement and shared search remain truthful.</p><p><a href="/portal">Return to Buyer Portal</a></p></main></body></html>`,{status:409,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
const STATE_CSS=`<style id="journey-state-guard">.search-confirm-form{margin-top:.75rem}.search-confirm-form button{border:0;border-radius:7px;background:#2d5a3d;color:#fff;padding:.7rem 1rem;font-weight:800;cursor:pointer}</style>`;
