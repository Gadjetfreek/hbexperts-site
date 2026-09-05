import appWorker from './issue29-production-worker.js';
import { STAGES } from './journey-stages.js';
import { mutationCsrfToken } from './household-state.js';
import { BIMATRIX_CSS, buyerBimatrixPanel, handleBuyerBimatrixRefresh } from './bimatrix/freshness.js';
import { buyerGuidanceRuntimeScript } from './buyer-guidance.js';

export const BUYER_FIRST_CSS = `<style id="buyer-first-clarity">
.buyer-first-core{max-width:900px;margin:1rem auto;padding:1rem 1.1rem;border:1px solid #dfe8e2;border-left:4px solid #2d5a3d;border-radius:10px;background:#f7faf8;color:#2c2c2c;line-height:1.55}.buyer-first-core strong{color:#1a1a2e}.buyer-review-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(26,26,46,.58);display:none;align-items:center;justify-content:center;padding:1rem}.buyer-review-backdrop.open{display:flex}.buyer-review{width:min(760px,100%);max-height:min(88vh,900px);overflow:auto;background:#fff;border-radius:14px;padding:1.35rem;box-shadow:0 24px 70px rgba(0,0,0,.28)}.buyer-review h2{margin:.15rem 0 .4rem;color:#1a1a2e;font-family:Georgia,serif}.buyer-review-intro{color:#555;margin:0 0 1rem}.buyer-review-list{display:grid;gap:.7rem;margin:1rem 0}.buyer-review-item{padding:.8rem .9rem;border:1px solid #e8e5e0;border-radius:9px;background:#faf9f6}.buyer-review-item small{display:block;color:#6b6b6b;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.buyer-review-item div{white-space:pre-wrap}.buyer-review-trust{padding:1rem;border-radius:9px;background:#f7faf8;border:1px solid #dfe8e2;color:#333}.buyer-review-actions{display:flex;gap:.7rem;justify-content:flex-end;flex-wrap:wrap;margin-top:1rem}.buyer-review-actions button{font:inherit;font-weight:800;border-radius:7px;padding:.75rem 1rem;cursor:pointer}.buyer-review-edit{background:#fff;color:#2d5a3d;border:1px solid #2d5a3d}.buyer-review-send{background:#2d5a3d;color:#fff;border:1px solid #2d5a3d}.buyer-review-empty{color:#6b6b6b;font-style:italic}
.buyer-answer-help{display:block;margin:.4rem 0 .15rem;color:#5f625f;font-size:.86rem;line-height:1.45}.buyer-answer-help strong{color:#2d5a3d}.buyer-suggestions{display:flex;flex-wrap:wrap;gap:.4rem;margin:.45rem 0 .7rem}.buyer-suggestion{appearance:none;border:1px solid #cad8ce;background:#fff;color:#2d5a3d;border-radius:999px;padding:.38rem .62rem;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}.buyer-suggestion:hover,.buyer-suggestion:focus-visible{background:#edf6f0;outline:2px solid rgba(45,90,61,.24);outline-offset:1px}
.buyer-focus-card{background:#fff;border:1px solid #dfe8e2;border-radius:14px;padding:1.2rem 1.25rem;margin:1rem 0 1.15rem;box-shadow:0 8px 26px rgba(26,26,46,.05)}.buyer-focus-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem;margin-top:.9rem}.buyer-focus-grid>div{background:#faf9f6;border-radius:10px;padding:.8rem}.buyer-focus-grid small{display:block;color:#6b6b6b;font-size:.68rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.2rem}.buyer-focus-grid strong{color:#1a1a2e;line-height:1.35}.buyer-focus-card h1{font:600 clamp(1.5rem,4vw,2.05rem) Georgia,serif;color:#1a1a2e;margin:.2rem 0}.buyer-focus-card p{margin:.35rem 0;color:#555;line-height:1.5}.buyer-more{background:#fff;border:1px solid #e8e5e0;border-radius:12px;margin:.8rem 0;overflow:hidden}.buyer-more>summary{cursor:pointer;padding:1rem 1.05rem;font-weight:850;color:#1a1a2e;list-style:none}.buyer-more>summary::-webkit-details-marker{display:none}.buyer-more>summary:after{content:'+';float:right;color:#2d5a3d;font-size:1.2rem}.buyer-more[open]>summary:after{content:'–'}.buyer-more-body{padding:0 1rem 1rem}.buyer-focus-card+.i29-next{margin-top:0}.buyer-focus-card+.i29-next h2{font-size:1.05rem}.buyer-focus-card+.i29-next>strong{font-size:1.35rem}.buyer-focus-card+.i29-next .i29-tasks{display:none}
@media(max-width:760px){.buyer-focus-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.buyer-review{padding:1rem}.buyer-review-actions{display:grid;grid-template-columns:1fr}.buyer-review-actions button{width:100%}.buyer-focus-grid{grid-template-columns:1fr}.buyer-focus-card{padding:1rem}}
.qx-page1-orient{margin:0 0 1rem}.step .buyer-first-core.qx-page1-orient{max-width:none;margin:0 0 1rem}.step .value-context.qx-page1-orient{max-width:none;margin:0 0 .85rem}.step .i29-comp.qx-page1-orient{margin:0 0 1.15rem}
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
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  reviewButton.addEventListener('click',()=>{if(form.reportValidity())openReview();});
  edit.addEventListener('click',closeReview);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeReview();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&backdrop.classList.contains('open'))closeReview();});
  send.addEventListener('click',()=>{approved=true;backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true');document.body.style.overflow='';form.requestSubmit();});
  form.addEventListener('submit',e=>{if(!approved){e.preventDefault();openReview();}});
})();
</script>`;

export const BUYER_GUIDANCE_JS = `<script id="buyer-guided-answer-script">
${buyerGuidanceRuntimeScript()}
</script>`;

export const BUYER_PORTAL_FOCUS_JS = `<script id="buyer-portal-focus-script">
(()=>{
  const main=document.querySelector('main'); if(!main||document.querySelector('.buyer-focus-card'))return;
  const next=document.querySelector('.i29-next'); if(!next)return;
  const current=document.querySelector('.i29-stop.current strong')?.textContent?.trim()||'Your current step';
  const nextTitle=next.querySelector(':scope > strong')?.textContent?.trim()||'Review your next step';
  const reason=next.querySelector(':scope > small')?.textContent?.trim()||'This keeps the decision moving without making you solve the whole process at once.';
  const card=document.createElement('section'); card.className='buyer-focus-card'; card.setAttribute('aria-label','Your current focus');
  card.innerHTML='<div class="i29-kicker">NOW</div><h1>'+escapeHtml(current)+'</h1><p>Focus on the next useful decision. You do not need to solve the whole process at once.</p><div class="buyer-focus-grid"><div><small>Now</small><strong>'+escapeHtml(current)+'</strong></div><div><small>Why this matters</small><strong>'+escapeHtml(reason)+'</strong></div><div><small>Best next step</small><strong>'+escapeHtml(nextTitle)+'</strong></div><div><small>Time</small><strong>Do this when you are ready. HBE will flag anything truly date-critical.</strong></div></div>';
  next.parentNode.insertBefore(card,next); next.parentNode.insertBefore(next,card.nextSibling);
  const groups=[
    {label:'See the full 17-stage journey',nodes:[document.querySelector('.i29-map')]},
    {label:'Your story and decision compass',nodes:[document.querySelector('.i29-story'),document.querySelector('.i29-compass')]},
    {label:'Current-step checklist',nodes:[document.querySelector('.i29-checklist')]},
    {label:'Representation and compensation details',nodes:[document.querySelector('.i29-comp')]}
  ];
  for(const group of groups){
    const nodes=group.nodes.filter(Boolean); if(!nodes.length)continue;
    const details=document.createElement('details'); details.className='buyer-more';
    const summary=document.createElement('summary'); summary.textContent=group.label;
    const body=document.createElement('div'); body.className='buyer-more-body';
    details.append(summary,body);
    const anchor=nodes[0]; anchor.parentNode.insertBefore(details,anchor);
    nodes.forEach(node=>body.appendChild(node));
  }
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
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
      /until you deliberately press <strong>Submit to HBE<\/strong> at the end/g,
      'until you deliberately review and send it to HomeBuyer Experts'
    );
    text = text.replace(
      /Until you press <strong>Submit to HBE<\/strong>/g,
      'Until you review and send to HomeBuyer Experts'
    );
    text = text.replace(

      /<div class="submitbox"><strong>This is the moment HBE receives your information\.<\/strong><p>[\s\S]*?<button class="btn primary" type="submit">Submit to HBE<\/button><\/div>/,
      `<div class="submitbox"><strong>Nothing has been sent yet.</strong><p>Review exactly what HomeBuyer Experts will receive before you choose to send it.</p><button class="btn primary" id="review-before-send" type="button">Review &amp; Send to HomeBuyer Experts</button></div>`
    );
    if (!text.includes('id="buyer-review-backdrop"')) {
      const review = `<div class="buyer-review-backdrop" id="buyer-review-backdrop" aria-hidden="true"><section class="buyer-review" role="dialog" aria-modal="true" aria-labelledby="buyer-review-title"><div class="eyebrow">BEFORE YOU SEND THIS</div><h2 id="buyer-review-title">Here is what HBE will receive.</h2><p class="buyer-review-intro">Read it over. You can go back and change anything before sending.</p><div class="buyer-review-list" id="buyer-review-list"></div><div class="buyer-review-trust"><strong>Sending this does not hire HBE, sign an agency agreement, or obligate you to buy a home.</strong><br>It creates your private buyer record so HomeBuyer Experts can review what you chose to share and follow up for a real conversation.</div><div class="buyer-review-actions"><button class="buyer-review-edit" id="buyer-review-edit" type="button">Back and edit</button><button class="buyer-review-send" id="buyer-review-send" type="button">Send to HomeBuyer Experts</button></div></section></div>`;
      text = text.replace('</body>', `${review}${BUYER_GUIDANCE_JS}${BUYER_FIRST_JS}</body>`);
    } else if (!text.includes('id="buyer-guided-answer-script"')) {
      text = text.replace('</body>', `${BUYER_GUIDANCE_JS}</body>`);
    }
  }

  if (pathname === '/portal' && !text.includes('id="buyer-portal-focus-script"')) {
    text = text.replace('</body>', `${BUYER_PORTAL_FOCUS_JS}</body>`);
  }

  if (!text.includes('id="buyer-first-clarity"')) text = text.replace('</head>', `${BUYER_FIRST_CSS}</head>`);
  return text;
}


/**
 * Move orientation education cards into questionnaire page 1 only.
 * Cards currently injected after <main> / before </main> stay visible on every
 * multi-step Continue; confining them to the first .step hides them on pages 2–8.
 * Idempotent: safe if already confined or if form/steps are missing.
 */
export function confineOrientationCardsToPage1(text) {
  if (!text || typeof text !== 'string') return text;

  const extracted = [];

  const take = (re) => {
    const match = text.match(re);
    if (!match) return null;
    text = text.replace(match[0], '');
    return match[0];
  };

  // Public VALUE line only (not portal/HBE panels).
  const value = take(/<div\b(?=[^>]*\bclass="[^"]*\bvalue-context\b)(?![^>]*\bvalue-portal-panel\b)[^>]*>[\s\S]*?<\/div>/i);
  const buyer = take(/<div\b(?=[^>]*\bclass="[^"]*\bbuyer-first-core\b)[^>]*>[\s\S]*?<\/div>/i);
  const comp = take(/<section\b(?=[^>]*\bid="compensation-note")[^>]*>[\s\S]*?<\/section>/i);

  // Preferred keep order: buyer-first → VALUE → compensation
  if (buyer) extracted.push(ensureQxOrientClass(buyer));
  if (value) extracted.push(ensureQxOrientClass(value));
  if (comp) extracted.push(ensureQxOrientClass(comp));

  if (!extracted.length) return text;

  const block = extracted.join('');
  const stepOpen = text.match(/<section\b[^>]*\bclass="[^"]*\bstep\b[^"]*"[^>]*>/i);
  if (!stepOpen) {
    // Graceful fallback: restore near <main> so cards are not deleted.
    if (text.includes('<main')) return text.replace(/(<main[^>]*>)/i, `$1${block}`);
    return text.replace(/<body([^>]*)>/i, `<body$1>${block}`);
  }

  // Extract-then-reinject is idempotent even when cards were already inside page 1.
  return text.replace(stepOpen[0], `${stepOpen[0]}${block}`);
}

function ensureQxOrientClass(html) {
  if (/\bqx-page1-orient\b/.test(html)) return html;
  return html.replace(/\bclass="([^"]*)"/i, 'class="$1 qx-page1-orient"');
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
        body.issue36 = { buyer_first_clarity: true, pre_submit_review: true, attention_architecture: true, guided_open_answers: true };
        body.showingCard = body.showingCard || { enabled: true, dossier: 'brigham-v1', r2: Boolean(env.SHOWING_PHOTOS) };
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
      if (url.pathname === '/questionnaire') {
        text = confineOrientationCardsToPage1(text);
      }
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
