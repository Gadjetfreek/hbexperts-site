import { DOSSIER_SECTIONS, YN_UNCLEAR, RATING_1_5 } from './dossier-schema.js';
import { r2Available } from './store.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export const SHOWING_CARD_CSS = `<style id="showing-card-css">
.sc-panel{margin:1rem 0;padding:1rem;border:1px solid #dfe8e2;border-left:4px solid #2d5a3d;border-radius:12px;background:#fff}
.sc-panel h2{margin:.1rem 0 .55rem;font:600 1.15rem Georgia,serif;color:#1a1a2e}
.sc-card{display:grid;gap:.55rem;padding:.85rem;border:1px solid #e8e5e0;border-radius:10px;background:#faf9f6;margin:.6rem 0}
.sc-card .meta{display:flex;flex-wrap:wrap;gap:.45rem .8rem;color:#555;font-size:.9rem}
.sc-card .progress{font-weight:800;color:#2d5a3d}
.sc-card .status{display:inline-block;padding:.15rem .5rem;border-radius:999px;background:#edf6f0;color:#2d5a3d;font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
.sc-card .status.in_progress{background:#fff6e8;color:#8a5a00}
.sc-card .status.not_started{background:#f0eeea;color:#666}
.sc-open{display:inline-block;margin-top:.35rem;padding:.7rem 1rem;border-radius:8px;background:#2d5a3d;color:#fff!important;text-decoration:none;font-weight:800}
.sc-page{max-width:720px;margin:0 auto;padding:0 .2rem 5rem}
.sc-top{position:sticky;top:0;z-index:20;background:rgba(248,248,247,.96);backdrop-filter:blur(8px);border-bottom:1px solid #e8e5e0;padding:.65rem .2rem;margin:0 0 .8rem}
.sc-top a{color:#2d5a3d;font-weight:700;text-decoration:none}
.sc-addr{font:600 1.25rem Georgia,serif;color:#1a1a2e;margin:.2rem 0}
.sc-save{font-size:.85rem;color:#555;min-height:1.2em}
.sc-save.ok{color:#2d5a3d}.sc-save.err{color:#8a1f1f}
.sc-sec{border:1px solid #e8e5e0;border-radius:12px;background:#fff;margin:.7rem 0;overflow:hidden}
.sc-sec>summary{cursor:pointer;list-style:none;padding:1rem;font-weight:850;color:#1a1a2e}
.sc-sec>summary::-webkit-details-marker{display:none}
.sc-sec>summary:after{content:'+';float:right;color:#2d5a3d;font-size:1.15rem}
.sc-sec[open]>summary:after{content:'–'}
.sc-sec-body{padding:0 1rem 1rem;display:grid;gap:.9rem}
.sc-field label.sc-label{display:block;font-weight:750;color:#1a1a2e;margin:0 0 .35rem;line-height:1.35}
.sc-readonly{padding:.7rem .8rem;border-radius:8px;background:#f7faf8;border:1px solid #dfe8e2;color:#333;line-height:1.45;white-space:pre-wrap}
.sc-seg{display:flex;flex-wrap:wrap;gap:.4rem}
.sc-seg button,.sc-chip{appearance:none;border:1px solid #cad8ce;background:#fff;color:#2d5a3d;border-radius:999px;padding:.55rem .85rem;font:inherit;font-size:.9rem;font-weight:750;cursor:pointer;min-height:44px}
.sc-seg button[aria-pressed="true"],.sc-chip.on{background:#2d5a3d;color:#fff;border-color:#2d5a3d}
.sc-input,.sc-textarea,.sc-table input,.sc-table select{width:100%;box-sizing:border-box;font:inherit;padding:.7rem .75rem;border:1px solid #d5d1c8;border-radius:8px;background:#fff;min-height:44px}
.sc-textarea{min-height:96px;resize:vertical}
.sc-table{display:grid;gap:.7rem}
.sc-row{border:1px solid #ece9e2;border-radius:10px;padding:.7rem;background:#faf9f6}
.sc-row h4{margin:0 0 .5rem;font-size:.95rem;color:#1a1a2e}
.sc-row .grid{display:grid;gap:.45rem}
.sc-obs{margin-top:.5rem;padding-top:.7rem;border-top:1px dashed #ddd}
.sc-obs ul{margin:.4rem 0;padding-left:1.1rem}
.sc-obs li{margin:.25rem 0;color:#444}
.sc-photo{margin-top:.4rem}
.sc-photo input[type=file]{font-size:.85rem}
.sc-photo-list{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.35rem}
.sc-photo-list a{font-size:.8rem;color:#2d5a3d}
.sc-footer-bar{position:fixed;left:0;right:0;bottom:0;background:#1a1a2e;color:#fff;padding:.65rem 1rem;display:flex;justify-content:space-between;gap:.5rem;align-items:center;font-size:.9rem;z-index:30}
@media(max-width:600px){.sc-page{padding-bottom:4.5rem}.sc-seg button{flex:1 1 calc(33% - .4rem)}}
</style>`;

export function propertiesPanelHtml({ properties, buyerId, caseId, progressById = {} }) {
  if (!properties?.length) {
    return `<section class="sc-panel" id="properties-showings" aria-label="Properties and showings">
      <h2>Properties / Showings</h2>
      <p class="muted">No properties linked to this household yet.</p>
    </section>`;
  }
  const cards = properties.map(p => {
    const prog = progressById[p.id] || { pct: 0, status: 'not_started', filled: 0, total: 0 };
    const ask = p.ask_price != null ? `$${Number(p.ask_price).toLocaleString('en-US')}` : '—';
    const href = `/hbe/properties/${encodeURIComponent(p.id)}/card?buyer=${encodeURIComponent(buyerId || '')}`;
    return `<article class="sc-card">
      <strong>${esc(p.address)}${p.city ? `, ${esc(p.city)}` : ''}${p.state ? ` ${esc(p.state)}` : ''}${p.zip ? ` ${esc(p.zip)}` : ''}</strong>
      <div class="meta"><span>MLS ${esc(p.mls || '—')}</span><span>Ask ${esc(ask)}</span>
        <span class="progress">${prog.pct}% dossier</span>
        <span class="status ${esc(prog.status)}">${esc(String(prog.status).replace('_', ' '))}</span>
      </div>
      <a class="sc-open" href="${href}">Open Showing Card</a>
    </article>`;
  }).join('');
  return `<section class="sc-panel" id="properties-showings" aria-label="Properties and showings">
    <h2>Properties / Showings</h2>
    <p style="margin:0 0 .4rem;color:#555">HBE field tool — raw notes and media stay off BuyerUI.</p>
    ${cards}
  </section>`;
}

function renderControl(field, answers) {
  const current = answers[field.id]?.value;
  const name = esc(field.id);
  if (field.type === 'readonly') {
    return `<div class="sc-readonly">${esc(field.value || '')}</div>`;
  }
  if (field.type === 'photo_prompt') {
    return `<div class="sc-readonly">Attach photo below when ready.</div>`;
  }
  if (field.type === 'yn_unclear' || field.type === 'option' || field.type === 'rating_1_5') {
    const opts = field.type === 'yn_unclear' ? YN_UNCLEAR
      : field.type === 'rating_1_5' ? RATING_1_5
      : (field.options || []);
    const buttons = opts.map(o => {
      const pressed = String(current ?? '') === String(o) ? 'true' : 'false';
      return `<button type="button" data-sc-choice data-field="${name}" data-value="${esc(o)}" aria-pressed="${pressed}">${esc(o)}</button>`;
    }).join('');
    return `<div class="sc-seg" role="group" aria-label="${esc(field.label)}">${buttons}</div>`;
  }
  if (field.type === 'multi_option' || field.type === 'checklist') {
    const selected = Array.isArray(current) ? current.map(String) : [];
    const chips = (field.options || []).map(o => {
      const on = selected.includes(String(o)) ? 'on' : '';
      return `<button type="button" class="sc-chip ${on}" data-sc-multi data-field="${name}" data-value="${esc(o)}" aria-pressed="${on ? 'true' : 'false'}">${esc(o)}</button>`;
    }).join('');
    return `<div class="sc-seg" role="group">${chips}</div>`;
  }
  if (field.type === 'long_text') {
    return `<textarea class="sc-textarea" data-sc-text data-field="${name}" placeholder="${esc(field.placeholder || '')}">${esc(current ?? '')}</textarea>`;
  }
  if (field.type === 'table') {
    return renderTable(field, current);
  }
  const inputType = field.input === 'date' ? 'date' : field.input === 'time' ? 'time' : field.type === 'count' ? 'number' : 'text';
  return `<input class="sc-input" type="${inputType}" data-sc-text data-field="${name}" value="${esc(current ?? '')}" placeholder="${esc(field.placeholder || '')}">`;
}

function renderTable(field, current) {
  const rows = Array.isArray(current?.rows) ? current.rows : null;
  const data = rows || (field.presetRows || []).map(label => ({ label, values: {} }));
  const cols = field.columns || [];
  const blocks = data.map((row, idx) => {
    const cells = cols.map(col => {
      const val = row.values?.[col.id] ?? '';
      if (col.type === 'rating_1_5' || col.type === 'option') {
        const opts = col.type === 'rating_1_5' ? RATING_1_5 : (col.options || []);
        const sel = opts.map(o => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('');
        return `<label>${esc(col.label)}<select data-sc-table data-field="${esc(field.id)}" data-row="${idx}" data-col="${esc(col.id)}"><option value="">—</option>${sel}</select></label>`;
      }
      const t = col.type === 'count' ? 'number' : 'text';
      return `<label>${esc(col.label)}<input type="${t}" data-sc-table data-field="${esc(field.id)}" data-row="${idx}" data-col="${esc(col.id)}" value="${esc(val)}"></label>`;
    }).join('');
    return `<div class="sc-row" data-row-label="${esc(row.label || '')}"><h4>${esc(row.label || `Row ${idx + 1}`)}</h4><div class="grid">${cells}</div></div>`;
  }).join('');
  return `<div class="sc-table" data-sc-table-root data-field="${esc(field.id)}">${blocks}</div>`;
}

function photoBlock(field, photos, propertyId, r2Ok) {
  if (field.type === 'readonly') return '';
  if (field.photos === false && field.type !== 'photo_prompt') return '';
  const mine = (photos || []).filter(p => (p.field_id || '') === field.id);
  const links = mine.map(p => `<a href="/api/hbe/showing/photo/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Photo ${esc(p.id.slice(-6))}</a>`).join('');
  if (!r2Ok) {
    return `<div class="sc-photo"><small>Photo UI ready — R2 binding not available in this environment.</small><div class="sc-photo-list">${links}</div></div>`;
  }
  return `<div class="sc-photo">
    <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"
      data-sc-photo data-field="${esc(field.id)}" data-property="${esc(propertyId)}">
    <div class="sc-photo-list">${links}</div>
  </div>`;
}

function observationBlock(section, observations) {
  const list = (observations || []).filter(o => o.section_id === section.id);
  const items = list.map(o => `<li><small>${esc(o.created_at || '')}</small> — ${esc(o.body)}</li>`).join('') || '<li class="muted">No observations yet.</li>';
  return `<div class="sc-obs">
    <strong>+ Add observation</strong>
    <textarea class="sc-textarea" data-sc-obs-body data-section="${esc(section.id)}" placeholder="Unexpected note for this section"></textarea>
    <button type="button" class="sc-chip" data-sc-obs-add data-section="${esc(section.id)}">Save observation</button>
    <ul data-sc-obs-list data-section="${esc(section.id)}">${items}</ul>
  </div>`;
}

export function showingCardPageHtml({
  property, answers, observations, photos, csrfToken, buyerId, professionalEmail, r2Ok, progress
}) {
  const ask = property.ask_price != null ? `$${Number(property.ask_price).toLocaleString('en-US')}` : '—';
  const back = buyerId ? `/hbe?buyer=${encodeURIComponent(buyerId)}#properties-showings` : '/hbe#properties-showings';
  const sections = DOSSIER_SECTIONS.map(section => {
    const fields = section.fields.map(field => {
      return `<div class="sc-field" data-field-wrap="${esc(field.id)}">
        <label class="sc-label">${esc(field.label)}</label>
        ${renderControl(field, answers)}
        ${photoBlock(field, photos, property.id, r2Ok)}
      </div>`;
    }).join('');
    return `<details class="sc-sec" open>
      <summary>${esc(section.title)}</summary>
      <div class="sc-sec-body">${fields}${observationBlock(section, observations)}</div>
    </details>`;
  }).join('');

  const generalPhotos = (photos || []).filter(p => !p.field_id);
  const generalLinks = generalPhotos.map(p => `<a href="/api/hbe/showing/photo/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Photo ${esc(p.id.slice(-6))}</a>`).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Showing Card · ${esc(property.address)} | HBE</title>
${SHOWING_CARD_CSS}
</head><body style="margin:0;background:#f8f8f7;color:#2c2c2c;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<header style="padding:1rem 1.25rem;border-bottom:1px solid #e8e5e0;background:#fff">
  <a href="https://hbexperts.com/" style="font:700 1.2rem Georgia,serif;color:#1a1a2e;text-decoration:none">HomeBuyer Experts</a>
  <span style="float:right;color:#666;font-size:.85rem">HBE · ${esc(professionalEmail || '')}</span>
</header>
<main class="sc-page">
  <div class="sc-top">
    <a href="${esc(back)}">← Back to household</a>
    <div class="sc-addr">${esc(property.address)}, ${esc(property.city)} ${esc(property.state)} ${esc(property.zip)}</div>
    <div class="meta" style="color:#555;font-size:.92rem">MLS ${esc(property.mls)} · Ask ${esc(ask)} · Dossier ${progress.pct}%</div>
    <div class="sc-save" id="sc-save-state" aria-live="polite">Ready — answers autosave</div>
  </div>
  <input type="hidden" id="sc-csrf" value="${esc(csrfToken)}">
  <input type="hidden" id="sc-property" value="${esc(property.id)}">
  ${sections}
  <section class="sc-sec" style="padding:1rem">
    <strong>General photos</strong>
    <div class="sc-photo" style="margin-top:.5rem">
      ${r2Ok
        ? `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" data-sc-photo data-field="" data-property="${esc(property.id)}">`
        : `<small>Photo UI ready — private R2 not bound yet. Uploads fail closed.</small>`}
      <div class="sc-photo-list">${generalLinks}</div>
    </div>
  </section>
</main>
<div class="sc-footer-bar"><span>Save-as-you-go</span><span id="sc-footer-pct">${progress.pct}% complete</span></div>
${SHOWING_CARD_JS}
</body></html>`;
}

export const SHOWING_CARD_JS = `<script id="showing-card-js">
(()=>{
  const csrf=()=>document.getElementById('sc-csrf')?.value||'';
  const propertyId=()=>document.getElementById('sc-property')?.value||'';
  const stateEl=document.getElementById('sc-save-state');
  const pctEl=document.getElementById('sc-footer-pct');
  let timer=null;
  function setState(msg,cls){if(stateEl){stateEl.textContent=msg;stateEl.className='sc-save '+(cls||'');}}
  async function postJson(url,body){
    const res=await fetch(url,{
      method:'POST',
      headers:{'content-type':'application/json','x-csrf-token':csrf()},
      credentials:'same-origin',
      body:JSON.stringify(body)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||('Save failed '+res.status));
    return data;
  }
  async function saveField(fieldId,value){
    setState('Saving…');
    try{
      const data=await postJson('/api/hbe/showing/answer',{property_id:propertyId(),field_id:fieldId,value,csrf:csrf()});
      setState('Saved '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),'ok');
      if(data.progress&&pctEl) pctEl.textContent=data.progress.pct+'% complete';
    }catch(err){setState(err.message||'Save failed','err');}
  }
  function debounce(fieldId,value){
    clearTimeout(timer);
    timer=setTimeout(()=>saveField(fieldId,value),350);
  }
  document.querySelectorAll('[data-sc-choice]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const field=btn.getAttribute('data-field');
      const value=btn.getAttribute('data-value');
      btn.parentElement.querySelectorAll('[data-sc-choice]').forEach(b=>b.setAttribute('aria-pressed','false'));
      btn.setAttribute('aria-pressed','true');
      saveField(field,value);
    });
  });
  document.querySelectorAll('[data-sc-multi]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const field=btn.getAttribute('data-field');
      btn.classList.toggle('on');
      btn.setAttribute('aria-pressed',btn.classList.contains('on')?'true':'false');
      const values=[...btn.parentElement.querySelectorAll('[data-sc-multi].on')].map(b=>b.getAttribute('data-value'));
      saveField(field,values);
    });
  });
  document.querySelectorAll('[data-sc-text]').forEach(el=>{
    const ev=el.tagName==='TEXTAREA'?'input':'change';
    el.addEventListener('input',()=>debounce(el.getAttribute('data-field'),el.value));
    el.addEventListener(ev,()=>debounce(el.getAttribute('data-field'),el.value));
  });
  function collectTable(fieldId){
    const root=document.querySelector('[data-sc-table-root][data-field="'+fieldId+'"]');
    if(!root) return {rows:[]};
    const rows=[...root.querySelectorAll('.sc-row')].map(row=>{
      const label=row.getAttribute('data-row-label')||'';
      const values={};
      row.querySelectorAll('[data-sc-table]').forEach(inp=>{
        values[inp.getAttribute('data-col')]=inp.value;
      });
      return {label,values};
    });
    return {rows};
  }
  document.querySelectorAll('[data-sc-table]').forEach(el=>{
    el.addEventListener('change',()=>{
      const field=el.getAttribute('data-field');
      debounce(field,collectTable(field));
    });
    el.addEventListener('input',()=>{
      const field=el.getAttribute('data-field');
      debounce(field,collectTable(field));
    });
  });
  document.querySelectorAll('[data-sc-obs-add]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const section=btn.getAttribute('data-section');
      const ta=document.querySelector('[data-sc-obs-body][data-section="'+section+'"]');
      const body=(ta?.value||'').trim();
      if(!body) return;
      setState('Saving observation…');
      try{
        const data=await postJson('/api/hbe/showing/observation',{property_id:propertyId(),section_id:section,body,csrf:csrf()});
        const ul=document.querySelector('[data-sc-obs-list][data-section="'+section+'"]');
        if(ul&&data.observation){
          const li=document.createElement('li');
          li.textContent=(data.observation.created_at||'')+' — '+data.observation.body;
          ul.prepend(li);
        }
        if(ta) ta.value='';
        setState('Observation saved','ok');
      }catch(err){setState(err.message||'Observation failed','err');}
    });
  });
  document.querySelectorAll('[data-sc-photo]').forEach(input=>{
    input.addEventListener('change',async()=>{
      const file=input.files&&input.files[0];
      if(!file) return;
      setState('Uploading photo…');
      const fd=new FormData();
      fd.set('csrf',csrf());
      fd.set('property_id',propertyId());
      fd.set('field_id',input.getAttribute('data-field')||'');
      fd.set('photo',file);
      try{
        const res=await fetch('/api/hbe/showing/photo',{method:'POST',credentials:'same-origin',headers:{'x-csrf-token':csrf()},body:fd});
        const data=await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(data.error||('Upload failed '+res.status));
        setState('Photo attached','ok');
        const list=input.parentElement.querySelector('.sc-photo-list');
        if(list&&data.photo){
          const a=document.createElement('a');
          a.href='/api/hbe/showing/photo/'+encodeURIComponent(data.photo.id);
          a.target='_blank'; a.rel='noopener';
          a.textContent='Photo '+String(data.photo.id).slice(-6);
          list.prepend(a);
        }
      }catch(err){setState(err.message||'Upload failed','err');}
      input.value='';
    });
  });
})();
</script>`;

export { r2Available };
