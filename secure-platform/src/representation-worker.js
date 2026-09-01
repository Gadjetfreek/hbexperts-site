import appWorker from './consultation-worker.js';

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/representation/choice') {
      return saveBuyerChoice(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/hbe/representation') {
      const gate = await appWorker.fetch(request, env, ctx);
      if (gate.status === 403) return gate;
      return saveHbeRepresentation(request, env);
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
          const data = await representationData(env, caseId, auth.buyer.id);
          text = injectBeforeMainEnd(text, buyerRepresentationPanel(data));
        }
      }

      if (request.method === 'GET' && url.pathname === '/hbe') {
        const selectedBuyerId = clean(url.searchParams.get('buyer')) || await newestBuyerId(env);
        if (selectedBuyerId) {
          const caseId = await ensureCaseForBuyer(env, selectedBuyerId);
          const data = await representationData(env, caseId, selectedBuyerId);
          text = injectBeforeMainEnd(text, hbeRepresentationPanel(data));
        }
      }
    } catch (err) {
      console.error('Representation workspace render failed', err);
    }

    text = text.replace('</head>', `${REPRESENTATION_CSS}</head>`);
    return new Response(text, {status:response.status,statusText:response.statusText,headers});
  }
};

async function saveBuyerChoice(request, env) {
  if (!sameOrigin(request)) return new Response('Invalid request origin', {status:403});
  const auth = await getBuyerSession(request, env);
  if (!auth) return redirect('/login');

  const form = await request.formData();
  const choice = allowedBuyerChoice(form.get('choice'));
  if (!choice) return redirect('/portal#hire-hbe');

  const caseId = await ensureCaseForBuyer(env, auth.buyer.id);
  const consultation = await env.BUYER_DB.prepare('SELECT next_step FROM buyer_consultation_records WHERE case_id=? LIMIT 1').bind(caseId).first();
  const agreement = await env.BUYER_DB.prepare('SELECT agreement_status FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first();

  if (agreement?.agreement_status === 'signed') return redirect('/portal#hire-hbe');
  if (consultation?.next_step !== 'representation') {
    return new Response('Representation is not the current consultation outcome.', {status:409});
  }

  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO buyer_representation_choices
    (buyer_id,case_id,choice,choice_at,updated_at,note)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(buyer_id) DO UPDATE SET
      case_id=excluded.case_id,
      choice=excluded.choice,
      choice_at=excluded.choice_at,
      updated_at=excluded.updated_at,
      note=excluded.note`)
    .bind(auth.buyer.id,caseId,choice,now,now,clean(form.get('note')) || null).run();

  await env.BUYER_DB.prepare(`INSERT INTO notifications (id,buyer_id,type,created_at,payload_json)
    VALUES (?,?,?,?,?)`).bind(
      crypto.randomUUID(),auth.buyer.id,'representation_choice',now,JSON.stringify({choice})
    ).run();

  return redirect('/portal#hire-hbe');
}

async function saveHbeRepresentation(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');

  const caseId = await ensureCaseForBuyer(env, buyerId);
  const existing = await env.BUYER_DB.prepare('SELECT * FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first();
  if (existing?.agreement_status === 'signed') {
    return messagePage('Representation is already active','The signed representation record is immutable. Use a future amendment/termination workflow rather than changing the activation record.',409);
  }

  const status = allowedAgreementStatus(form.get('agreement_status'));
  const now = new Date().toISOString();
  const professional = clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'verified HBE professional';

  if (status === 'signed') {
    const members = await env.BUYER_DB.prepare(`SELECT m.buyer_id,c.choice
      FROM buyer_case_members m LEFT JOIN buyer_representation_choices c ON c.buyer_id=m.buyer_id
      WHERE m.case_id=?`).bind(caseId).all();
    const notReady = (members.results || []).filter(row => row.choice !== 'prepare');
    if (notReady.length) {
      return messagePage('Buyer choice still needed','Do not activate representation until each linked buyer has deliberately asked HBE to prepare the written agreement for review.',409);
    }
    if (!clean(form.get('signed_at')) || !clean(form.get('agreement_version')) || !clean(form.get('compensation_summary'))) {
      return messagePage('Agreement details incomplete','Signed date, agreement/version reference, and compensation summary are required before representation can be activated.',409);
    }
  }

  const signedAt = status === 'signed' ? clean(form.get('signed_at')) : null;
  const activatedAt = status === 'signed' ? now : null;
  await env.BUYER_DB.prepare(`INSERT INTO buyer_representation_records
    (case_id,created_at,updated_at,agreement_status,agreement_version,signed_at,compensation_summary,confirmed_by,activated_at,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(case_id) DO UPDATE SET
      updated_at=excluded.updated_at,
      agreement_status=excluded.agreement_status,
      agreement_version=excluded.agreement_version,
      signed_at=excluded.signed_at,
      compensation_summary=excluded.compensation_summary,
      confirmed_by=excluded.confirmed_by,
      activated_at=excluded.activated_at,
      notes=excluded.notes`)
    .bind(
      caseId,now,now,status,
      clean(form.get('agreement_version')) || null,
      signedAt,
      clean(form.get('compensation_summary')) || null,
      professional,
      activatedAt,
      clean(form.get('notes')) || null
    ).run();

  if (status === 'signed') {
    await activateRepresentation(env, caseId, now);
  }

  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#hire-hbe`);
}

async function activateRepresentation(env, caseId, now) {
  const members = await env.BUYER_DB.prepare(`SELECT b.id,b.completed_stages
    FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id WHERE m.case_id=?`).bind(caseId).all();
  const caseRow = await env.BUYER_DB.prepare('SELECT completed_stages FROM buyer_cases WHERE id=?').bind(caseId).first();

  const caseCompleted = addCompleted(caseRow?.completed_stages, ['consultation','representation']);
  const statements = [
    env.BUYER_DB.prepare(`UPDATE buyer_cases SET stage='search',completed_stages=?,updated_at=? WHERE id=?`).bind(caseCompleted,now,caseId),
    env.BUYER_DB.prepare(`UPDATE buyer_case_invitations SET revoked_at=? WHERE case_id=? AND accepted_at IS NULL AND revoked_at IS NULL`).bind(now,caseId)
  ];

  for (const member of (members.results || [])) {
    statements.push(
      env.BUYER_DB.prepare(`UPDATE buyers SET stage='search',completed_stages=?,updated_at=? WHERE id=?`)
        .bind(addCompleted(member.completed_stages,['consultation','representation']),now,member.id)
    );
    statements.push(
      env.BUYER_DB.prepare(`INSERT INTO notifications (id,buyer_id,type,created_at,payload_json) VALUES (?,?,?,?,?)`)
        .bind(crypto.randomUUID(),member.id,'representation_activated',now,JSON.stringify({next_stage:'search'}))
    );
  }
  await env.BUYER_DB.batch(statements);
}

async function representationData(env, caseId, selectedBuyerId) {
  const [consultation,record,members] = await Promise.all([
    env.BUYER_DB.prepare('SELECT next_step,next_step_notes,updated_at FROM buyer_consultation_records WHERE case_id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare('SELECT * FROM buyer_representation_records WHERE case_id=? LIMIT 1').bind(caseId).first(),
    env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,b.email,c.choice,c.choice_at,c.note
      FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id
      LEFT JOIN buyer_representation_choices c ON c.buyer_id=b.id
      WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all()
  ]);

  return {caseId,selectedBuyerId,consultation:consultation || {},record:record || {},members:members.results || []};
}

function buyerRepresentationPanel(data) {
  const mine = data.members.find(m => m.id === data.selectedBuyerId) || {};
  const signed = data.record.agreement_status === 'signed';
  const open = data.consultation.next_step === 'representation';

  if (signed) {
    return `<section id="hire-hbe" class="rep-shell rep-active"><div class="rep-kicker">STAGE 3 · HIRE HBE</div><h2>Representation is active.</h2><p>Your written buyer-agency agreement is recorded as signed. The software record is not the agreement itself; your signed document controls the relationship.</p><div class="rep-summary"><div><small>Agreement</small><strong>${esc(data.record.agreement_version || 'Recorded agreement')}</strong></div><div><small>Signed</small><strong>${esc(formatDate(data.record.signed_at))}</strong></div><div><small>Compensation</small><strong>${esc(data.record.compensation_summary || 'See signed agreement')}</strong></div></div><div class="rep-next"><strong>Next: Build Your Home Search</strong><span>Your journey has advanced to Stage 4.</span></div></section>`;
  }

  if (!open) {
    return `<section id="hire-hbe" class="rep-shell rep-locked"><div class="rep-kicker">STAGE 3 · HIRE HBE</div><h2>Representation is a choice, not an assumption.</h2><p>This stage opens when your Consultation shows that exploring representation is the useful next step. Until then, nothing here commits you to HBE.</p></section>`;
  }

  return `<section id="hire-hbe" class="rep-shell"><div class="rep-kicker">STAGE 3 · HIRE HBE</div><h2>Choose whether you want HBE to prepare a written representation agreement.</h2><p class="rep-lede">This screen helps you decide what happens next. <strong>It does not create an agency relationship and it is not an electronic signature.</strong> Representation begins only through the actual written agreement.</p>
    <div class="rep-principles">
      <div><strong>Clear loyalty</strong><span>HBE represents buyers exclusively. We do not take seller listings.</span></div>
      <div><strong>Fiduciary responsibility</strong><span>The written relationship explains HBE's duties, your responsibilities, confidentiality, and the scope of representation.</span></div>
      <div><strong>Compensation is negotiable</strong><span>How HBE is paid depends on the written representation arrangement. HBE does not publish percentages, dollar amounts, fee schedules, or preset packages before hire. Seller-paid compensation is not automatic or guaranteed.</span></div>
      <div><strong>Conflicts stay visible</strong><span>HBE does not accept paid referrals or kickbacks for sending buyers to lenders, inspectors, title companies, contractors, or similar providers.</span></div>
      <div><strong>You keep the choice</strong><span>You may ask questions, request changes, take more time, use another brokerage, or decide not to proceed.</span></div>
      <div><strong>The document controls</strong><span>If anything on this page differs from the written agreement, the signed agreement governs.</span></div>
    </div>
    ${data.consultation.next_step_notes ? `<div class="rep-context"><small>WHY THIS CAME NEXT IN CONSULTATION</small><p>${esc(data.consultation.next_step_notes)}</p></div>` : ''}
    <form method="post" action="/api/representation/choice" class="rep-choice-form">
      <fieldset><legend>What would you like to do?</legend>
        ${choiceRadio('prepare','Ask HBE to prepare the written agreement for my review','I want to see the actual terms and decide after reviewing them.',mine.choice)}
        ${choiceRadio('need_time','I need more time or information','I am not ready to move into representation yet.',mine.choice)}
        ${choiceRadio('not_now','I do not want to pursue HBE representation now','Keep my choice clear without pressure to continue.',mine.choice)}
      </fieldset>
      <label>Anything you want HBE to understand before the next conversation? <span>Optional</span><textarea name="note" rows="3">${esc(mine.note || '')}</textarea></label>
      <div class="rep-action"><p><strong>No button on this page hires HBE.</strong><br><small>Your choice tells us what you want to happen next.</small></p><button type="submit">Save my choice</button></div>
    </form>
    ${mine.choice_at ? `<p class="rep-saved">Last choice saved ${esc(formatDateTime(mine.choice_at))}.</p>` : ''}
  </section>`;
}

function hbeRepresentationPanel(data) {
  const r = data.record || {};
  const consultReady = data.consultation.next_step === 'representation';
  const allReady = data.members.length > 0 && data.members.every(m => m.choice === 'prepare');
  const signed = r.agreement_status === 'signed';

  if (signed) {
    return `<section id="hire-hbe" class="rep-shell rep-hbe rep-active"><div class="rep-kicker">STAGE 3 · HIRE HBE · HBE WORKSPACE</div><div class="rep-hbe-head"><div><h2>Representation active</h2><p>The activation record is now immutable. Future changes belong in an explicit amendment or termination workflow so the history remains truthful.</p></div><span class="rep-status signed">Representation active</span></div><div class="rep-summary"><div><small>Agreement</small><strong>${esc(r.agreement_version || 'Recorded agreement')}</strong></div><div><small>Signed</small><strong>${esc(formatDate(r.signed_at))}</strong></div><div><small>Compensation</small><strong>${esc(r.compensation_summary || 'See signed agreement')}</strong></div></div></section>`;
  }

  return `<section id="hire-hbe" class="rep-shell rep-hbe"><div class="rep-kicker">STAGE 3 · HIRE HBE · HBE WORKSPACE</div><div class="rep-hbe-head"><div><h2>Representation readiness</h2><p>Buyer intent and the actual written agreement stay separate. HBE may activate Stage 4 only after the agreement exists and the linked buyers have deliberately chosen to review/proceed.</p></div><span class="rep-status ${esc(r.agreement_status || 'not_started')}">${esc(statusLabel(r.agreement_status))}</span></div>
    <div class="rep-readiness ${consultReady ? 'ready' : ''}"><strong>Consultation outcome</strong><span>${consultReady ? 'Explore representation is the recorded next step.' : 'Representation is not the recorded consultation next step.'}</span></div>
    <div class="rep-member-grid">${data.members.map(memberChoiceCard).join('')}</div>
    <form method="post" action="/api/hbe/representation" class="rep-hbe-form">
      <input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}">
      <div class="rep-form-grid">
        <label>Agreement status<select name="agreement_status">${statusOptions(r.agreement_status)}</select></label>
        <label>Agreement/version reference<input name="agreement_version" value="${esc(r.agreement_version || '')}" placeholder="Example: Ohio buyer agency agreement · 2026-08"></label>
        <label>Signed date<input type="date" name="signed_at" value="${esc(dateInput(r.signed_at))}"></label>
        <label>Compensation summary<input name="compensation_summary" value="${esc(r.compensation_summary || '')}" placeholder="Use the actual signed terms; compensation is negotiable."></label>
      </div>
      <label>Internal notes<textarea name="notes" rows="3">${esc(r.notes || '')}</textarea></label>
      <div class="rep-activation-note ${allReady ? 'ready' : ''}"><strong>${allReady ? 'Buyer choice gate is satisfied.' : 'Buyer choice gate is not yet satisfied.'}</strong><span>${allReady ? 'If the written agreement is signed, HBE may record it and Stage 4 will unlock.' : 'Each linked buyer must choose “prepare the written agreement” before representation can be activated in the system.'}</span></div>
      <div class="rep-action"><p><strong>Do not mark “Signed / active” from a conversation alone.</strong><br><small>Record only what the actual written agreement establishes.</small></p><button type="submit">Save representation record</button></div>
    </form>
  </section>`;
}

function memberChoiceCard(member) {
  const labels = {prepare:'Prepare agreement',need_time:'Needs time',not_now:'Not pursuing now'};
  return `<article class="rep-member"><small>BUYER CHOICE</small><strong>${esc(member.first_name)} ${esc(member.last_name)}</strong><span class="rep-member-choice ${esc(member.choice || 'none')}">${esc(labels[member.choice] || 'No choice yet')}</span>${member.choice_at ? `<em>${esc(formatDateTime(member.choice_at))}</em>` : ''}${member.note ? `<p>${esc(member.note)}</p>` : ''}</article>`;
}

function choiceRadio(value,title,detail,selected) {
  return `<label class="rep-choice"><input type="radio" name="choice" value="${esc(value)}"${selected===value?' checked':''} required><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></label>`;
}

function statusOptions(selected) {
  const options = [['not_started','Not started'],['sent','Agreement sent / under review'],['signed','Signed / representation active']];
  return options.map(([v,l]) => `<option value="${v}"${String(selected || 'not_started')===v?' selected':''}>${l}</option>`).join('');
}
function statusLabel(status) { return ({sent:'Agreement under review',signed:'Representation active'})[status] || 'Not started'; }
function allowedBuyerChoice(value) { const v=clean(value); return ['prepare','need_time','not_now'].includes(v)?v:''; }
function allowedAgreementStatus(value) { const v=clean(value); return ['not_started','sent','signed'].includes(v)?v:'not_started'; }

async function getBuyerSession(request,env) {
  const token = getCookie(request,'hbe_session');
  if (!token) return null;
  const now = new Date().toISOString();
  const row = await env.BUYER_DB.prepare(`SELECT s.id AS session_id,s.buyer_id,s.expires_at,b.*
    FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token),now).first();
  if (!row) return null;
  await env.BUYER_DB.prepare('UPDATE buyer_sessions SET last_seen_at=? WHERE id=?').bind(now,row.session_id).run();
  return {session:{id:row.session_id,buyer_id:row.buyer_id,expires_at:row.expires_at},buyer:row};
}

async function ensureCaseForBuyer(env,buyerId) {
  const existing = await env.BUYER_DB.prepare('SELECT case_id FROM buyer_case_members WHERE buyer_id=?').bind(buyerId).first();
  if (existing?.case_id) return existing.case_id;
  const buyer = await env.BUYER_DB.prepare('SELECT stage,completed_stages FROM buyers WHERE id=?').bind(buyerId).first();
  if (!buyer) throw new Error('Buyer not found');
  const caseId=crypto.randomUUID(),now=new Date().toISOString();
  await env.BUYER_DB.batch([
    env.BUYER_DB.prepare('INSERT INTO buyer_cases (id,created_at,updated_at,stage,completed_stages,status) VALUES (?,?,?,?,?,?)').bind(caseId,now,now,buyer.stage||'consultation',buyer.completed_stages||'["buyerExperience"]','active'),
    env.BUYER_DB.prepare('INSERT INTO buyer_case_members (case_id,buyer_id,role,created_at) VALUES (?,?,?,?)').bind(caseId,buyerId,'buyer',now),
    env.BUYER_DB.prepare('INSERT INTO buyer_person_profiles (buyer_id,case_id,created_at,updated_at,profile_json) VALUES (?,?,?,?,?)').bind(buyerId,caseId,now,now,'{}'),
    env.BUYER_DB.prepare('INSERT INTO buyer_case_financials (case_id,updated_at,pilot_rate) VALUES (?,?,0.0275)').bind(caseId,now)
  ]);
  return caseId;
}

async function newestBuyerId(env) { const row=await env.BUYER_DB.prepare('SELECT id FROM buyers ORDER BY submitted_at DESC LIMIT 1').first(); return row?.id||null; }
function addCompleted(jsonValue,stages) { let a=[]; try{a=JSON.parse(jsonValue||'[]');if(!Array.isArray(a))a=[];}catch{} for(const s of stages)if(!a.includes(s))a.push(s); return JSON.stringify(a); }
function getCookie(request,name) { const cookie=request.headers.get('cookie')||''; for(const part of cookie.split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));} return ''; }
function sameOrigin(request) { const origin=request.headers.get('origin'); if(!origin)return true; try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;} }
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',enc.encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
function injectBeforeMainEnd(text,panel){const i=text.lastIndexOf('</main>');return i>=0?`${text.slice(0,i)}${panel}${text.slice(i)}`:text.replace('</body>',`${panel}</body>`);}
function redirect(location){return new Response(null,{status:303,headers:{location}});}
function messagePage(title,body,status=400){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body><main style="max-width:720px;margin:4rem auto;padding:1rem;font-family:system-ui"><h1>${esc(title)}</h1><p>${esc(body)}</p><p><a href="/hbe">Return to HBEUI</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8'}});}
function clean(value){return String(value??'').trim().slice(0,10000);}
function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function formatDate(value){if(!value)return '—';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value));}catch{return String(value);}}
function formatDateTime(value){if(!value)return '';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch{return String(value);}}
function dateInput(value){if(!value)return '';return String(value).slice(0,10);}

const REPRESENTATION_CSS=`<style id="hbe-representation-workspace">
.rep-shell{max-width:1180px;margin:2rem auto;padding:1.35rem;background:#fff;border:1px solid #e8e5e0;border-radius:12px}.rep-kicker{font-size:.7rem;font-weight:800;letter-spacing:.13em;color:#2d5a3d}.rep-shell h2{font-family:Georgia,serif;color:#1a1a2e;margin:.3rem 0 .6rem}.rep-shell p{color:#555;line-height:1.55}.rep-lede{max-width:850px}.rep-principles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:1rem 0}.rep-principles>div,.rep-summary>div,.rep-readiness,.rep-member,.rep-context,.rep-activation-note,.rep-next{padding:.85rem;background:#faf9f6;border-radius:9px}.rep-principles strong,.rep-principles span,.rep-summary small,.rep-summary strong,.rep-readiness strong,.rep-readiness span,.rep-next strong,.rep-next span{display:block}.rep-principles span,.rep-readiness span,.rep-next span{margin-top:.2rem;color:#666;font-size:.9rem}.rep-context{border-left:3px solid #c9a84c}.rep-context small{font-weight:800;color:#2d5a3d}.rep-context p{margin:.3rem 0 0}.rep-choice-form,.rep-hbe-form{margin-top:1rem;border-top:1px solid #e8e5e0;padding-top:1rem}.rep-choice-form fieldset{border:0;padding:0;margin:0}.rep-choice-form legend{font-weight:800;color:#1a1a2e;margin-bottom:.6rem}.rep-choice{display:flex;gap:.75rem;align-items:flex-start;padding:.9rem;border:1px solid #e8e5e0;border-radius:9px;margin:.6rem 0;cursor:pointer}.rep-choice:hover{background:#faf9f6}.rep-choice input{margin-top:.25rem;accent-color:#2d5a3d}.rep-choice span strong,.rep-choice span small{display:block}.rep-choice span small{color:#666;margin-top:.15rem}.rep-choice-form>label,.rep-hbe-form>label,.rep-form-grid label{display:block;font-weight:700;color:#1a1a2e;margin-top:1rem}.rep-choice-form>label span{font-weight:400;color:#777}.rep-shell textarea,.rep-shell input,.rep-shell select{width:100%;font:inherit;padding:.72rem;border:1px solid #d9d5cf;border-radius:8px;background:#fff;margin-top:.35rem}.rep-action{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-top:1rem}.rep-action p{margin:0}.rep-action button{border:0;border-radius:7px;background:#2d5a3d;color:#fff;padding:.8rem 1rem;font-weight:800;cursor:pointer}.rep-saved{font-size:.85rem;color:#777}.rep-locked{background:#faf9f6}.rep-active{border-left:4px solid #2d5a3d}.rep-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}.rep-summary small{font-size:.7rem;color:#777;text-transform:uppercase}.rep-summary strong{margin-top:.2rem;color:#1a1a2e}.rep-next{margin-top:1rem;border-left:3px solid #c9a84c}.rep-hbe-head{display:flex;justify-content:space-between;gap:1rem}.rep-status{white-space:nowrap;padding:.4rem .7rem;border-radius:999px;background:#eee;color:#555;font-size:.8rem;font-weight:800}.rep-status.signed{background:#e9f4ec;color:#2d5a3d}.rep-status.sent{background:#fff4d9;color:#715711}.rep-readiness{margin:1rem 0}.rep-readiness.ready{border-left:3px solid #2d5a3d}.rep-member-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem}.rep-member small,.rep-member strong,.rep-member em{display:block}.rep-member small{color:#2d5a3d;font-weight:800;font-size:.65rem}.rep-member strong{margin:.25rem 0}.rep-member em{font-size:.78rem;color:#777;font-style:normal;margin-top:.25rem}.rep-member p{font-size:.88rem;margin:.5rem 0 0}.rep-member-choice{display:inline-block;padding:.3rem .5rem;border-radius:6px;background:#eee;font-size:.8rem;font-weight:700}.rep-member-choice.prepare{background:#e9f4ec;color:#2d5a3d}.rep-member-choice.need_time{background:#fff4d9;color:#715711}.rep-member-choice.not_now{background:#f6eaea;color:#7c3333}.rep-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.rep-activation-note{display:flex;flex-direction:column;gap:.2rem;margin-top:1rem}.rep-activation-note span{color:#666;font-size:.9rem}.rep-activation-note.ready{border-left:3px solid #2d5a3d}@media(max-width:700px){.rep-principles,.rep-summary,.rep-form-grid{grid-template-columns:1fr}.rep-action,.rep-hbe-head{flex-direction:column;align-items:stretch}.rep-shell{margin:1rem .85rem}}
</style>`;
