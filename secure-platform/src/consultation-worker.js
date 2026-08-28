import appWorker from './hbe-access-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/hbe/consultation') {
      // HBE Access remains the security gate. The downstream route intentionally
      // does not exist; a non-403 response means Access + HBE professional checks passed.
      const gate = await appWorker.fetch(request, env, ctx);
      if (gate.status === 403) return gate;
      return saveConsultation(request, env);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (request.method !== 'GET' || url.pathname !== '/hbe' || response.status !== 200 || !type.includes('text/html')) {
      return response;
    }

    let text = await response.text();
    try {
      const selectedBuyerId = clean(url.searchParams.get('buyer')) || await newestBuyerId(env);
      if (selectedBuyerId) {
        const caseId = await ensureCaseForBuyer(env, selectedBuyerId);
        const data = await consultationData(env, caseId, selectedBuyerId);
        text = injectBeforeMainEnd(text, consultationWorkspace(data));
      }
    } catch (err) {
      console.error('Consultation workspace render failed', err);
    }

    text = text.replace('</head>', `${CONSULTATION_CSS}</head>`);
    return new Response(text, {status:response.status, statusText:response.statusText, headers});
  }
};

async function saveConsultation(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  if (!buyerId) return redirect('/hbe');

  const caseId = await ensureCaseForBuyer(env, buyerId);
  const now = new Date().toISOString();
  const professional = clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE';
  const nextStep = allowedNextStep(form.get('next_step'));

  await env.BUYER_DB.prepare(`INSERT INTO buyer_consultation_records
    (case_id,created_at,updated_at,meeting_at,updated_by,clearer,changed,unknowns,evidence_needed,next_step,next_step_notes,summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(case_id) DO UPDATE SET
      updated_at=excluded.updated_at,
      meeting_at=excluded.meeting_at,
      updated_by=excluded.updated_by,
      clearer=excluded.clearer,
      changed=excluded.changed,
      unknowns=excluded.unknowns,
      evidence_needed=excluded.evidence_needed,
      next_step=excluded.next_step,
      next_step_notes=excluded.next_step_notes,
      summary=excluded.summary`)
    .bind(
      caseId, now, now,
      clean(form.get('meeting_at')) || null,
      professional,
      clean(form.get('clearer')) || null,
      clean(form.get('changed')) || null,
      clean(form.get('unknowns')) || null,
      clean(form.get('evidence_needed')) || null,
      nextStep || null,
      clean(form.get('next_step_notes')) || null,
      clean(form.get('summary')) || null
    ).run();

  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}#consultation-workspace`);
}

async function consultationData(env, caseId, selectedBuyerId) {
  const [membersResult, record] = await Promise.all([
    env.BUYER_DB.prepare(`SELECT b.id,b.first_name,b.last_name,b.email,b.phone,b.stage,b.answers_json,b.submitted_at
      FROM buyer_case_members m JOIN buyers b ON b.id=m.buyer_id
      WHERE m.case_id=? ORDER BY m.created_at`).bind(caseId).all(),
    env.BUYER_DB.prepare('SELECT * FROM buyer_consultation_records WHERE case_id=? LIMIT 1').bind(caseId).first()
  ]);

  return {
    caseId,
    selectedBuyerId,
    members:(membersResult.results || []).map(m => ({...m, answers:safeJson(m.answers_json)})),
    record:record || {}
  };
}

function consultationWorkspace(data) {
  const r = data.record || {};
  const householdNote = data.members.length > 1
    ? `<div class="consult-household-note"><strong>${data.members.length} individual voices in one shared decision.</strong><span>Compare differences in priorities, uncertainty, decision style, and desired guidance. Differences are information to understand, not problems to erase.</span></div>`
    : `<div class="consult-household-note"><strong>Individual buyer consultation.</strong><span>Use the submitted Buyer Experience as a starting hypothesis. Confirm it in conversation rather than treating the form as the final word.</span></div>`;

  return `<section id="consultation-workspace" class="consult-shell">
    <div class="consult-head">
      <div><div class="consult-eyebrow">STAGE 2 · CONSULTATION</div><h2>Turn the Buyer Experience into understanding.</h2><p>Prepare from what the buyer already told us, then record what the human conversation changes. The consultation does not automatically move anyone into representation.</p></div>
      <a class="consult-top-link" href="#consultation-record">Jump to record</a>
    </div>
    ${householdNote}
    <div class="consult-brief-grid">${data.members.map(memberBrief).join('')}</div>
    ${data.members.length > 1 ? householdComparison(data.members) : ''}
    <form id="consultation-record" class="consult-record" method="post" action="/api/hbe/consultation">
      <input type="hidden" name="buyer_id" value="${esc(data.selectedBuyerId)}">
      <div class="consult-record-head"><div><div class="consult-eyebrow">CONSULTATION RECORD</div><h3>What did we learn together?</h3></div><span>${r.updated_at ? `Last saved ${esc(formatDateTime(r.updated_at))}` : 'Not saved yet'}</span></div>
      <div class="consult-fields two">
        <label>Consultation date & time<input type="datetime-local" name="meeting_at" value="${esc(localDateTimeValue(r.meeting_at))}"></label>
        <label>Next best step<select name="next_step">${nextStepOptions(r.next_step)}</select></label>
      </div>
      <div class="consult-fields">
        <label>What became clearer?<textarea name="clearer" rows="4" placeholder="What does the buyer understand more clearly now?">${esc(r.clearer || '')}</textarea></label>
        <label>What changed?<textarea name="changed" rows="4" placeholder="Priorities, assumptions, timing, tradeoffs, or direction that changed during the conversation.">${esc(r.changed || '')}</textarea></label>
        <label>What remains unknown?<textarea name="unknowns" rows="4" placeholder="Questions or uncertainty that still matter before the next decision.">${esc(r.unknowns || '')}</textarea></label>
        <label>What evidence do we need next?<textarea name="evidence_needed" rows="4" placeholder="Market evidence, lender input, property information, records, professional advice, or lived experience.">${esc(r.evidence_needed || '')}</textarea></label>
        <label>Why is that the next best step?<textarea name="next_step_notes" rows="3" placeholder="Explain the reasoning without turning the recommendation into pressure.">${esc(r.next_step_notes || '')}</textarea></label>
        <label>Consultation summary<textarea name="summary" rows="5" placeholder="A concise human record of the conversation, important tradeoffs, and what should stay visible going forward.">${esc(r.summary || '')}</textarea></label>
      </div>
      <div class="consult-save"><div><strong>Saving records learning; it does not hire HBE for the buyer.</strong><small>If representation is the next useful step, the buyer still chooses it deliberately in Stage 3.</small></div><button type="submit">Save consultation record</button></div>
    </form>
  </section>`;
}

function memberBrief(member) {
  const a = member.answers || {};
  const fields = [
    ['WHY', a.why],
    ['Good outcome', a.success_definition],
    ['Top priorities', a.priorities],
    ['Non-negotiables', a.non_negotiables],
    ['Decision style', a.decision_style],
    ['Information style', a.info_preference],
    ['Uncertainty', a.uncertainty_style],
    ['Under offer pressure', a.offer_pressure],
    ['Head vs. heart', a.head_heart],
    ['Useful guidance', a.advisor_preference],
    ['Timing', a.timeline],
    ['Location', a.location],
    ['Financing', a.financing],
    ['Concerns', a.concerns],
    ['Known unknowns', a.unknowns],
    ['Saturday-morning vision', a.saturday_morning_vision],
    ['A useful consultation would...', a.consultation_success]
  ].filter(([,value]) => hasValue(value));

  return `<article class="consult-person">
    <div class="consult-person-head"><div><div class="consult-eyebrow">BUYER EXPERIENCE BRIEF</div><h3>${esc(member.first_name)} ${esc(member.last_name)}</h3></div><small>Submitted ${esc(formatDate(member.submitted_at))}</small></div>
    <p class="consult-contact">${esc(member.email)}${member.phone ? ` · ${esc(member.phone)}` : ''}</p>
    <div class="consult-profile">${fields.length ? fields.map(([label,value]) => briefItem(label,value)).join('') : '<p class="consult-muted">No reflective answers were provided. Begin with the buyer, not assumptions.</p>'}</div>
  </article>`;
}

function householdComparison(members) {
  return `<article class="consult-compare"><div class="consult-eyebrow">HOUSEHOLD COMPARISON PROMPTS</div><h3>Listen for where the individual views meet — and where they do not.</h3><div class="consult-prompt-grid">
    <div><strong>Shared purpose</strong><span>Are they trying to solve the same underlying problem?</span></div>
    <div><strong>Priority differences</strong><span>Which values or non-negotiables carry different weight for each person?</span></div>
    <div><strong>Uncertainty</strong><span>What does each person need to know before feeling ready to choose?</span></div>
    <div><strong>Decision process</strong><span>How can HBE give each buyer information in a form they can actually use?</span></div>
  </div><p>${members.map(m => esc(m.first_name)).join(' + ')} remain individual decision-makers inside one shared journey.</p></article>`;
}

function briefItem(label, value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(' · ') : String(value ?? '').trim();
  return `<div class="consult-item"><small>${esc(label)}</small><p>${esc(text)}</p></div>`;
}

function nextStepOptions(selected) {
  const options = [
    ['', 'Choose after the conversation'],
    ['representation', 'Explore / choose HBE representation'],
    ['prepare', 'Prepare before searching'],
    ['research', 'Research / gather evidence'],
    ['wait', 'Wait / revisit later'],
    ['stop', 'Do not pursue buying now'],
    ['other', 'Another next step']
  ];
  return options.map(([value,label]) => `<option value="${esc(value)}"${String(selected || '') === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
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

async function newestBuyerId(env) {
  const row = await env.BUYER_DB.prepare('SELECT id FROM buyers ORDER BY submitted_at DESC LIMIT 1').first();
  return row?.id || null;
}

function allowedNextStep(value) {
  const v = clean(value);
  return ['representation','prepare','research','wait','stop','other'].includes(v) ? v : '';
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? `${text.slice(0,i)}${panel}${text.slice(i)}` : text.replace('</body>', `${panel}</body>`);
}
function redirect(location) { return new Response(null,{status:303,headers:{location}}); }
function safeJson(value) { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } }
function hasValue(value) { return Array.isArray(value) ? value.some(Boolean) : String(value ?? '').trim().length > 0; }
function clean(value) { return String(value ?? '').trim().slice(0,10000); }
function esc(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function formatDate(value) { try { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)); } catch { return String(value || ''); } }
function formatDateTime(value) { try { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)); } catch { return String(value || ''); } }
function localDateTimeValue(value) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value).slice(0,16); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

const CONSULTATION_CSS = `<style id="hbe-consultation-workspace">
.consult-shell{max-width:1180px;margin:2rem auto;padding:0 1.5rem}.consult-head,.consult-record-head{display:flex;justify-content:space-between;gap:1.5rem;align-items:flex-start}.consult-head h2,.consult-record h3,.consult-person h3,.consult-compare h3{font-family:Georgia,serif;color:#1a1a2e;margin:.25rem 0 .55rem}.consult-head h2{font-size:1.8rem}.consult-head p{max-width:760px;color:#5f5f5f;line-height:1.55}.consult-eyebrow{font-size:.7rem;font-weight:800;letter-spacing:.13em;color:#2d5a3d}.consult-top-link{white-space:nowrap;color:#2d5a3d;font-weight:700;text-decoration:none}.consult-household-note{margin:1rem 0;display:flex;gap:.55rem;flex-direction:column;padding:1rem 1.1rem;background:#faf9f6;border:1px solid #e8e5e0;border-left:3px solid #c9a84c;border-radius:9px}.consult-household-note span{color:#5f5f5f}.consult-brief-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:1rem}.consult-person,.consult-compare,.consult-record{background:#fff;border:1px solid #e8e5e0;border-radius:12px;padding:1.2rem}.consult-person-head{display:flex;justify-content:space-between;gap:1rem}.consult-person-head small,.consult-record-head span,.consult-contact,.consult-muted{color:#6b6b6b}.consult-contact{font-size:.86rem;margin:.25rem 0 1rem}.consult-profile{display:grid;gap:.65rem}.consult-item{padding:.7rem .75rem;background:#faf9f6;border-radius:8px}.consult-item small{display:block;color:#2d5a3d;font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:.66rem}.consult-item p{margin:.25rem 0 0;color:#343434;line-height:1.45;white-space:pre-wrap}.consult-compare{margin-top:1rem}.consult-prompt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.consult-prompt-grid>div{padding:.8rem;background:#faf9f6;border-radius:8px}.consult-prompt-grid strong,.consult-prompt-grid span{display:block}.consult-prompt-grid span{margin-top:.2rem;color:#666;font-size:.88rem}.consult-compare>p{margin:.85rem 0 0;color:#666}.consult-record{margin-top:1rem}.consult-fields{display:grid;gap:1rem;margin-top:1rem}.consult-fields.two{grid-template-columns:1fr 1fr}.consult-fields label{font-weight:700;color:#1a1a2e}.consult-fields input,.consult-fields select,.consult-fields textarea{display:block;width:100%;margin-top:.35rem;padding:.75rem;border:1px solid #d9d5cf;border-radius:8px;background:#fff;color:#2c2c2c;font:inherit;font-weight:400}.consult-fields textarea{resize:vertical}.consult-save{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-top:1rem;padding-top:1rem;border-top:1px solid #e8e5e0}.consult-save strong,.consult-save small{display:block}.consult-save small{color:#666;margin-top:.2rem}.consult-save button{border:0;border-radius:7px;background:#2d5a3d;color:#fff;padding:.8rem 1.1rem;font-weight:800;cursor:pointer}.consult-save button:hover{background:#3a7a52}@media(max-width:700px){.consult-head,.consult-record-head,.consult-save{flex-direction:column}.consult-fields.two,.consult-prompt-grid{grid-template-columns:1fr}.consult-top-link{white-space:normal}.consult-shell{padding:0 .85rem}}
</style>`;
