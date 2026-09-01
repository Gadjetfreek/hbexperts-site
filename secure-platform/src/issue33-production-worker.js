import appWorker from './issue29-production-worker.js';
import { STAGES } from './journey-stages.js';
import { mutationCsrfToken } from './household-state.js';
import { BIMATRIX_CSS, buyerBimatrixPanel, handleBuyerBimatrixRefresh } from './bimatrix/freshness.js';

export const BUYER_FIRST_CSS = `<style id="buyer-first-clarity">
.buyer-first-core{max-width:900px;margin:1rem auto;padding:1rem 1.1rem;border:1px solid #dfe8e2;border-left:4px solid #2d5a3d;border-radius:10px;background:#f7faf8;color:#2c2c2c;line-height:1.55}.buyer-first-core strong{color:#1a1a2e}.buyer-review-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(26,26,46,.58);display:none;align-items:center;justify-content:center;padding:1rem}.buyer-review-backdrop.open{display:flex}.buyer-review{width:min(760px,100%);max-height:min(88vh,900px);overflow:auto;background:#fff;border-radius:14px;padding:1.35rem;box-shadow:0 24px 70px rgba(0,0,0,.28)}.buyer-review h2{margin:.15rem 0 .4rem;color:#1a1a2e;font-family:Georgia,serif}.buyer-review-intro{color:#555;margin:0 0 1rem}.buyer-review-list{display:grid;gap:.7rem;margin:1rem 0}.buyer-review-item{padding:.8rem .9rem;border:1px solid #e8e5e0;border-radius:9px;background:#faf9f6}.buyer-review-item small{display:block;color:#6b6b6b;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.buyer-review-item div{white-space:pre-wrap}.buyer-review-trust{padding:1rem;border-radius:9px;background:#f7faf8;border:1px solid #dfe8e2;color:#333}.buyer-review-actions{display:flex;gap:.7rem;justify-content:flex-end;flex-wrap:wrap;margin-top:1rem}.buyer-review-actions button{font:inherit;font-weight:800;border-radius:7px;padding:.75rem 1rem;cursor:pointer}.buyer-review-edit{background:#fff;color:#2d5a3d;border:1px solid #2d5a3d}.buyer-review-send{background:#2d5a3d;color:#fff;border:1px solid #2d5a3d}.buyer-review-empty{color:#6b6b6b;font-style:italic}@media(max-width:600px){.buyer-review{padding:1rem}.buyer-review-actions{display:grid;grid-template-columns:1fr}.buyer-review-actions button{width:100%}}
</style>`;

export const BUYER_FIRST_JS = `<script id="buyer-first-review-script">
(()=>{
  const form=document.getElementById('buyerExperienceForm');
  const reviewButton=document.getElementById('review-before-send');
  const backdrop=document.getElementById('buyer-review-backdrop');
  const list=document.getElementById('buyer-review-list');
  const edit=document.getElementById('buyer-review-edit');
  const send=document.getElementById('buyer-review-send');
  if(!form||!reviewButton||!backdrop||!list||!edit||!send)return;
  let approved=false;
  const labels={first_name:'First name',last_name:'Last name',email:'Email',phone:'Phone',has_other_buyer:'Another buyer is part of this decision',why:'Why you are considering a home',situation:'Where you are starting',success_definition:'What a successful decision looks like',priorities:'Top priorities',non_negotiables:'Non-negotiables',decision_style:'Decision style',info_preference:'Information preference',uncertainty_style:'How you handle uncertainty',offer_pressure:'Offer pressure',head_heart:'Head / heart balance',disagreement_style:'How you handle disagreement',advisor_preference:'Advisor preference',past_experience:'Past buying experience',past_experience_detail:'Past experience detail',home_feeling:'How home should feel',lifestyle_pace:'Lifestyle pace',space_priority:'Space priority',timeline:'Timing',location:'Location',financing:'Financing',concerns:'Concerns',unknowns:'What you want to understand better',saturday_morning_vision:'Your picture of home',consultation_success:'What would make the consultation useful',notes:'Anything else for HBE',remember_device:'Remember this device',household_join_consent:'Join shared buyer case'};
  const hidden=new Set(['household_invite_token']);
  function values(){
    const fd=new FormData(form), grouped=new Map();
    for(const [key,value] of fd.entries()){
      if(hidden.has(key))continue;
      const v=String(value||'').trim(); if(!v)continue;
      if(!grouped.has(key))grouped.set(key,[]); grouped.get(key).push(v);
    }
    return [...grouped.entries()].map(([key,vals])=>({label:labels[key]||key.replaceAll('_',' '),value:vals.join(', ')}));
  }
  function openReview(){
    const rows=values();
    list.innerHTML=rows.length?rows.map(row=>'<div class="buyer-review-item"><small>'+escapeHtml(row.label)+'</small><div>'+escapeHtml(row.value)+'</div></div>').join(''):'<p class="buyer-review-empty">You have not entered any optional answers.</p>';
    backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; send.focus();
  }
  function closeReview(){backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true');document.body.style.overflow='';reviewButton.focus();}
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));}
  reviewButton.addEventListener('click',()=>{if(form.reportValidity())openReview();});
  edit.addEventListener('click',closeReview);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeReview();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&backdrop.classList.contains('open'))closeReview();});
  send.addEventListener('click',()=>{approved=true;backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true');document.body.style.overflow='';form.requestSubmit();});
  form.addEventListener('submit',e=>{if(!approved){e.preventDefault();openReview();}});
})();
</script>`;

export function addBuyerFirstClarity(text, pathname) {
  if (pathname === '/' || pathname === '/questionnaire') {
    const core = `<div class="buyer-first-core" role="note"><strong>HomeBuyer Experts helps people buy homes.</strong> We work only for home buyers — never for the seller. Our job is to help you make the best choice for you, even when the best choice is to walk away.</div>`;
    if (!text.includes('class="buyer-first-core"')) {
      text = text.includes('<main') ? text.replace(/(<main[^>]*>)/, `$1${core}`) : text.replace('<body>', `<body>${core}`);
    }
  }

  if (pathname === '/questionnaire' && text.includes('id="buyerExperienceForm"')) {
    text = text.replace(
      /<div class="submitbox"><strong>This is the moment HBE receives your information\.<\/strong><p>[\s\S]*?<button class="btn primary" type="submit">Submit to HBE<\/button><\/div>/,
      `<div class="submitbox"><strong>Nothing has been sent yet.</strong><p>Review exactly what HomeBuyer Experts will receive before you choose to send it.</p><button class="btn primary" id="review-before-send" type="button">Review before sending</button></div>`
    );
    if (!text.includes('id="buyer-review-backdrop"')) {
      const review = `<div class="buyer-review-backdrop" id="buyer-review-backdrop" aria-hidden="true"><section class="buyer-review" role="dialog" aria-modal="true" aria-labelledby="buyer-review-title"><div class="eyebrow">BEFORE YOU SEND THIS</div><h2 id="buyer-review-title">Here is what HBE will receive.</h2><p class="buyer-review-intro">Read it over. You can go back and change anything before sending.</p><div class="buyer-review-list" id="buyer-review-list"></div><div class="buyer-review-trust"><strong>Sending this does not hire HBE, sign an agency agreement, or obligate you to buy a home.</strong><br>It creates your private buyer record so HomeBuyer Experts can review what you chose to share and follow up for a real conversation.</div><div class="buyer-review-actions"><button class="buyer-review-edit" id="buyer-review-edit" type="button">Back and edit</button><button class="buyer-review-send" id="buyer-review-send" type="button">Send to HomeBuyer Experts</button></div></section></div>`;
      text = text.replace('</body>', `${review}${BUYER_FIRST_JS}</body>`);
    }
  }

  if (!text.includes('id="buyer-first-clarity"')) text = text.replace('</head>', `${BUYER_FIRST_CSS}</head>`);
  return text;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/portal/bimatrix-refresh') {
      return handleBuyerBimatrixRefresh(request, env);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        const body = await response.clone().json();
        body.issue29 = body.issue29 || {
          stages: STAGES.length,
          stage17: 'afterKeys',
          persistence: 'd1-household-state'
        };
        body.issue33 = { bimatrix: true, buyer_refresh: true, canonical_review: 'monthly' };
        body.issue36 = { buyer_first_clarity: true, pre_submit_review: true };
        headers.set('content-type', 'application/json; charset=utf-8');
        return new Response(JSON.stringify(body), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch {
        return response;
      }
    }

    if (!type.includes('text/html')) return response;
    let text = await response.text();

    if (request.method === 'GET' && url.pathname === '/portal' && response.status === 200) {
      const token = getCookie(request, 'hbe_session');
      const csrf = token ? await mutationCsrfToken(token) : '';
      const csrfField = csrf ? `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">` : '';
      const panel = await buyerBimatrixPanel(request, env, csrfField);
      if (panel && !text.includes('id="possible-assistance"')) {
        text = injectBeforeMainEnd(text, panel);
      }
    }

    if (request.method === 'GET' && response.status === 200) {
      text = addBuyerFirstClarity(text, url.pathname);
    }

    if (!text.includes('id="issue33-bimatrix-css"')) {
      text = text.replace('</head>', `${BIMATRIX_CSS}</head>`);
    }

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  return i >= 0 ? `${text.slice(0, i)}${panel}${text.slice(i)}` : text.replace('</body>', `${panel}</body>`);
}

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
