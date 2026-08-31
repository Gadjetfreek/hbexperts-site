import { STAGES, STAGE_CHECKLISTS, stageLabel, stageIndex, COMPENSATION_PUBLIC, COMPENSATION_POST_HIRE_NOTE } from './journey-stages.js';
import { deriveWhatsNext, filterStory, defaultCompass, canSeeItem } from './household-state.js';

export function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

export const ISSUE29_CSS = `<style id="issue29-convergence">
:root{--navy:#1a1a2e;--green:#2d5a3d;--green2:#3a7a52;--gold:#c9a84c;--text:#2c2c2c;--muted:#6b6b6b;--warm:#faf9f6;--section:#f5f3ef;--border:#e8e5e0;--red:#9b3434}
.i29-split-card{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff;min-width:240px;flex:0 0 min(320px,86vw)}
.i29-split-card.selected{outline:2px solid var(--green)}
.i29-split-card header{grid-column:1/-1;padding:.85rem 1rem .5rem;border-bottom:1px solid var(--border)}
.i29-split-card header strong{display:block;font:600 1.05rem Georgia,serif;color:var(--navy)}
.i29-split-card header small{color:var(--muted)}
.i29-split-card a{display:flex;flex-direction:column;justify-content:center;gap:.15rem;padding:.9rem .85rem 1rem;text-decoration:none;color:var(--navy);font-weight:800;font-size:.82rem;letter-spacing:.04em;text-transform:uppercase}
.i29-split-card a span{font-weight:600;text-transform:none;letter-spacing:0;color:var(--muted);font-size:.78rem}
.i29-split-card a:first-of-type{border-right:1px solid var(--border);background:#f7faf8}
.i29-split-card a:hover,.i29-split-card a:focus-visible{background:#edf6f0;outline:none}
.i29-split-card a:focus-visible{box-shadow:inset 0 0 0 3px rgba(45,90,61,.35)}
.i29-map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0}
.i29-stop{position:relative;display:grid;grid-template-columns:34px 1fr;gap:.55rem;min-height:104px;padding:.9rem;border:1px solid var(--border);border-radius:12px;background:#fff;color:inherit;text-align:left;font:inherit;cursor:pointer}
.i29-stop.future{opacity:.7}
.i29-stop.current{border-color:rgba(45,90,61,.55);box-shadow:0 6px 22px rgba(45,90,61,.1)}
.i29-stop.done .i29-num{background:var(--green);color:#fff}
.i29-num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--section);font-weight:800;font-size:.8rem}
.i29-stop strong,.i29-stop small{display:block}
.i29-stop small{color:var(--muted);font-size:.78rem;margin-top:.2rem}
.i29-peek{pointer-events:none;position:absolute;left:50%;bottom:calc(100% + 8px);width:min(360px,86vw);transform:translate(-50%,8px);background:#fff;border:1px solid var(--border);border-radius:12px;padding:1rem;box-shadow:0 18px 50px rgba(26,26,46,.16);opacity:0;visibility:hidden;transition:.14s;z-index:30;text-align:left}
.i29-stop:hover .i29-peek,.i29-stop:focus .i29-peek,.i29-stop:focus-visible .i29-peek,.i29-stop:focus-within .i29-peek,.i29-stop.open .i29-peek{opacity:1;visibility:visible;transform:translate(-50%,0);pointer-events:auto}
.i29-peek h3{font:600 1.15rem Georgia,serif;color:var(--navy);margin:.15rem 0 .4rem}
.i29-peek ul{margin:.3rem 0 .6rem;padding-left:1.1rem}
.i29-peek li{margin:.25rem 0;font-size:.88rem}
.i29-peek .i29-open-full{pointer-events:auto;display:inline-block;margin-top:.35rem;color:#fff;background:var(--green);border-radius:7px;padding:.45rem .7rem;font-size:.8rem;font-weight:800;text-decoration:none}
.i29-story,.i29-compass,.i29-next,.i29-checklist,.i29-thanks,.i29-comp{background:#fff;border:1px solid var(--border);border-radius:12px;padding:1.15rem;margin:1rem 0}
.i29-story{min-height:220px}
.i29-kicker{font-size:.72rem;font-weight:800;letter-spacing:.13em;color:var(--green);text-transform:uppercase}
.i29-story h2,.i29-compass h2,.i29-next h2,.i29-checklist h2,.i29-thanks h1{font-family:Georgia,serif;color:var(--navy);margin:.25rem 0 .6rem}
.i29-story p,.i29-compass p,.i29-thanks p{color:#444;line-height:1.6}
.i29-dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin-top:.8rem}
.i29-dl div{background:var(--warm);border-radius:9px;padding:.75rem}
.i29-dl small{display:block;color:var(--muted);font-weight:800;font-size:.7rem;text-transform:uppercase}
.i29-next{border-left:4px solid var(--gold)}
.i29-next strong{display:block;font:600 1.2rem Georgia,serif;color:var(--navy);margin:.2rem 0}
.i29-tasks{display:grid;gap:.55rem;margin-top:.8rem}
.i29-task{display:flex;justify-content:space-between;gap:.6rem;background:var(--warm);border-radius:8px;padding:.7rem}
.i29-task small{display:block;color:var(--muted)}
.i29-vis{display:inline-block;font-size:.68rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:.15rem .4rem;border-radius:999px;background:#edf6f0;color:var(--green)}
.i29-vis.hbe{background:#f4efe4;color:#745a14}
.i29-mode{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:1rem 0}
.i29-mode a,.i29-mode span{border:1px solid var(--border);border-radius:999px;padding:.4rem .75rem;text-decoration:none;color:var(--navy);font-size:.85rem;font-weight:700}
.i29-mode .active{background:var(--green);color:#fff;border-color:var(--green)}
.i29-banner{background:#1a1a2e;color:#fff;padding:.75rem 1rem;display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
.i29-banner a{color:#c9a84c;font-weight:800}
.i29-check-row{display:grid;grid-template-columns:auto 1fr auto;gap:.6rem;align-items:start;padding:.65rem 0;border-top:1px solid var(--border)}
.i29-thanks{max-width:760px;margin:2rem auto;background:linear-gradient(180deg,var(--warm),#fff)}
.i29-code{display:inline-grid;padding:1rem 1.2rem;border:1px dashed #c9a84c;background:#fff;border-radius:12px;margin:1rem 0}
.i29-code small{font-weight:800;text-transform:uppercase;color:var(--green)}
.i29-code strong{font:700 clamp(1.2rem,4vw,1.8rem) Georgia,serif;letter-spacing:.06em}
@media(max-width:900px){.i29-map{grid-template-columns:repeat(2,minmax(0,1fr))}.i29-dl{grid-template-columns:1fr}}
.i29-story-form label,.i29-story-form input,.i29-story-form textarea{display:block;width:100%;margin:.45rem 0;font:inherit}.i29-story-form input,.i29-story-form textarea{padding:.65rem;border:1px solid var(--border);border-radius:7px}.i29-muted{color:var(--muted);font-size:.9rem}
@media(max-width:560px){
  .i29-map{grid-template-columns:1fr}
  .i29-peek{left:0;width:min(94vw,360px);transform:translate(0,8px)}
  .i29-stop:hover .i29-peek,.i29-stop:focus .i29-peek,.i29-stop:focus-visible .i29-peek,.i29-stop:focus-within .i29-peek,.i29-stop.open .i29-peek{transform:translate(0,0)}
  .i29-split-card{flex-basis:100%}
  .i29-story{min-height:0}
}
</style>`;

export const ISSUE29_JS = `<script>
(()=>{const stops=[...document.querySelectorAll('[data-i29-stop]')];
stops.forEach(el=>{
  el.addEventListener('click',e=>{
    if(e.target.closest('[data-open-checklist]')) return;
    const was=el.classList.contains('open');
    stops.forEach(s=>s.classList.remove('open'));
    if(!was) el.classList.add('open');
  });
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){
      if(e.target.closest('[data-open-checklist]')) return;
      e.preventDefault();
      const was=el.classList.contains('open');
      stops.forEach(s=>s.classList.remove('open'));
      if(!was) el.classList.add('open');
    }
  });
});
document.addEventListener('click',e=>{if(!e.target.closest('[data-i29-stop]'))stops.forEach(s=>s.classList.remove('open'));});
})();
</script>`;

export function stageMapHtml({ currentStage, completed = [], actor = { kind: 'buyer' }, hrefFor }) {
  const currentIndex = stageIndex(currentStage);
  const journeyComplete = currentStage === 'complete';
  return `<div class="i29-map" aria-label="HomeBuyer 17-stage journey">${STAGES.map((s,i)=>{
    const done = journeyComplete || completed.includes(s[0]) || (currentIndex>i && currentIndex>=0);
    const current = s[0]===currentStage;
    const items = (STAGE_CHECKLISTS[s[0]]||[]).filter(it=>canSeeItem(it, actor)).slice(0,5);
    const href = hrefFor ? hrefFor(s[0]) : `#stage-${s[0]}`;
    return `<div class="i29-stop ${done?'done':''} ${current?'current':''} ${!done&&!current?'future':''}" data-i29-stop data-stage="${esc(s[0])}" tabindex="0" role="button" aria-expanded="false">
      <span class="i29-num">${done?'✓':i+1}</span>
      <div><strong>${esc(s[1])}</strong><small>${esc(s[2])}</small></div>
      <div class="i29-peek">
        <div class="i29-kicker">What happens here</div>
        <h3>${esc(s[1])}</h3>
        <ul>${s[3].map(b=>`<li>${esc(b)}</li>`).join('')}</ul>
        <div class="i29-kicker">Checklist preview</div>
        <ul>${items.map(it=>`<li>${esc(it.title)} <em class="i29-vis ${it.visibility==='hbe'?'hbe':''}">${esc(it.visibility)}</em></li>`).join('')}</ul>
        <a class="i29-open-full" data-open-checklist href="${esc(href)}">Open full checklist</a>
      </div>
    </div>`;
  }).join('')}</div>`;
}

export function splitHouseholdCard({ householdName, members, stage, selected, hbeHref, buyerHref }) {
  const names = (members||[]).map(m=>`${m.first_name} ${m.last_name}`).join(' & ') || householdName;
  return `<article class="i29-split-card ${selected?'selected':''}">
    <header><strong>${esc(names)}</strong><small>${esc(stageLabel(stage))} · ${members.length>1?`${members.length} buyers`:'1 buyer'}</small></header>
    <a href="${esc(hbeHref)}">HBE Dashboard<span>Workspace, story synthesis, HBE-only work</span></a>
    <a href="${esc(buyerHref)}">Buyer Dashboard<span>Preview buyer-facing UI without leaving HBE</span></a>
  </article>`;
}

export function storyPanel(story, { mode, actor }) {
  const view = filterStory(story || {}, actor, mode);
  const isHbe = actor.kind === 'hbe';
  const title = isHbe ? 'Household story — HBE synthesis' : (mode === 'shared' ? 'Shared household story' : 'Your story in this household');
  const body = isHbe
    ? (view.hbe_synthesis || view.shared_story || 'HBE will synthesize wants, needs, tradeoffs, risks, decision style, unresolved questions, evidence, and what changed. This is not a questionnaire dump.')
    : (mode === 'mine'
      ? [view.shared_story, view.private_context].filter(Boolean).join('\n\n') || 'Shared facts will appear here, plus only your private context — never the other buyer’s private answers.'
      : (view.shared_story || 'The shared household story lives here. Private questionnaire answers stay on each person’s login.'));
  return `<section class="i29-story" id="household-story">
    <div class="i29-kicker">${esc(isHbe ? 'HBE ONLY + SHARED' : (mode==='shared'?'SHARED VIEW':'MY VIEW'))}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(body)}</p>
    <div class="i29-dl">
      ${dl('Wants', view.wants)}${dl('Needs', view.needs)}${dl('Tradeoffs', view.tradeoffs)}
      ${isHbe?dl('Risks', view.risks):''}${isHbe?dl('Decision style', view.decision_style):''}
      ${dl('Unresolved questions', view.unresolved_questions)}${dl('Evidence', view.evidence)}${dl('What changed', view.what_changed)}
    </div>
    ${isHbe?storyForm(story):''}
  </section>`;
}

function dl(k,v){return v?`<div><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`:''}

function storyForm(story){
  const s=story||{};
  return `<form method="post" action="/api/hbe/story" class="i29-story-form">
    <input type="hidden" name="case_id" value="${esc(s.case_id||'')}">
    <input type="hidden" name="buyer_id" value="${esc(s.selected_buyer_id||'')}">
    <label>Shared story<textarea name="shared_story" rows="4">${esc(s.shared_story||'')}</textarea></label>
    <label>HBE synthesis (never shown on buyer shared view)<textarea name="hbe_synthesis" rows="4">${esc(s.hbe_synthesis||'')}</textarea></label>
    <div class="i29-dl">
      <label>Wants<input name="wants" value="${esc(s.wants||'')}"></label>
      <label>Needs<input name="needs" value="${esc(s.needs||'')}"></label>
      <label>Tradeoffs<input name="tradeoffs" value="${esc(s.tradeoffs||'')}"></label>
      <label>Risks (HBE)<input name="risks" value="${esc(s.risks||'')}"></label>
      <label>Decision style (HBE)<input name="decision_style" value="${esc(s.decision_style||'')}"></label>
      <label>Unresolved questions<input name="unresolved_questions" value="${esc(s.unresolved_questions||'')}"></label>
      <label>Evidence<input name="evidence" value="${esc(s.evidence||'')}"></label>
      <label>What changed<input name="what_changed" value="${esc(s.what_changed||'')}"></label>
    </div>
    <button class="i29-open-full" type="submit">Save household story</button>
  </form>`;
}

export function compassPanel(compass) {
  const c = compass && (compass.optimizing_for || compass.tradeoffs || compass.uncertainty || compass.evidence || compass.next_conversation)
    ? compass
    : defaultCompass('consultation');
  return `<section class="i29-compass" id="journey-compass">
    <div class="i29-kicker">Journey Compass</div>
    <h2>This household box is never empty.</h2>
    <div class="i29-dl">
      <div><small>Optimizing for</small><strong>${esc(c.optimizing_for)}</strong></div>
      <div><small>Tradeoffs being tested</small><strong>${esc(c.tradeoffs)}</strong></div>
      <div><small>Unresolved uncertainty</small><strong>${esc(c.uncertainty)}</strong></div>
      <div><small>Evidence learned so far</small><strong>${esc(c.evidence)}</strong></div>
      <div><small>Next conversation / decision</small><strong>${esc(c.next_conversation)}</strong></div>
    </div>
  </section>`;
}

export function whatsNextPanel({ stage, checklistItems, completions, tasks, actor }) {
  const next = deriveWhatsNext({ stage, checklistItems, completions, tasks, actor });
  const allowed = actor.kind === 'hbe' ? ['buyer','shared','hbe'] : ['buyer','shared'];
  const general = (tasks||[]).filter(t => t.status==='open' && allowed.includes(t.visibility||'shared') && t.title !== next.title);
  return `<section class="i29-next" id="whats-next">
    <div class="i29-kicker">What’s Next</div>
    <h2>Highest priority right now</h2>
    <strong>${esc(next.title)}</strong>
    <small>${esc(next.reason)}${next.due_at?` · due ${esc(next.due_at)}`:''}</small>
    <div class="i29-tasks">${general.length?general.map(t=>`<div class="i29-task"><div><strong>${esc(t.title)}</strong><small>${t.due_at?esc(t.due_at):'No date'} · ${esc(t.priority)} · <em class="i29-vis ${t.visibility==='hbe'?'hbe':''}">${esc(t.visibility||'shared')}</em></small></div></div>`).join(''):`<p class="i29-muted">No additional general tasks — the What’s Next item above remains the useful action.</p>`}</div>
  </section>`;
}

export function checklistPanel({ stageId, items, completions, actor, action, hiddenFields = '' }) {
  const stage = STAGES.find(s=>s[0]===stageId);
  const done = new Set((completions||[]).map(c=>c.item_id || c.item_key));
  const rows = (items||[]).filter(i=>i.stage_id===stageId && canSeeItem(i, actor));
  return `<section class="i29-checklist" id="stage-${esc(stageId)}">
    <div class="i29-kicker">Stage checklist · ${esc(stageLabel(stageId))}</div>
    <h2>${esc(stage?stage[1]:stageId)}</h2>
    <p>${esc(stage?stage[2]:'')}</p>
    ${rows.map(item=>{
      const isDone = done.has(item.id) || done.has(item.item_key);
      return `<form class="i29-check-row" method="post" action="${esc(action)}">
        ${hiddenFields}
        <input type="hidden" name="item_id" value="${esc(item.id||item.item_key)}">
        <input type="hidden" name="reopen" value="${isDone?'yes':'no'}">
        <button type="submit" aria-pressed="${isDone?'true':'false'}">${isDone?'✓':'○'}</button>
        <div><strong>${esc(item.title)}</strong><small><em class="i29-vis ${item.visibility==='hbe'?'hbe':''}">${esc(item.visibility)}</em>${item.creates_action_title?` · completing creates: ${esc(item.creates_action_title)}`:''}</small></div>
        <span>${isDone?'Done':'Open'}</span>
      </form>`;
    }).join('')}
  </section>`;
}

export function modeSwitcher({ mode, firstName, others, mineHref, sharedHref }) {
  const otherNames = (others||[]).map(o=>o.first_name).join(' & ');
  const greeting = mode === 'shared'
    ? `You are in Shared Household View${otherNames?` with ${otherNames}`:''}. Private answers stay on each login.`
    : `You are in My View as ${firstName}. This is your login — not a shared credential.`;
  return `<div class="i29-mode" role="navigation" aria-label="Household view">
    <span>${esc(greeting)}</span>
    <a class="${mode==='mine'?'active':''}" href="${esc(mineHref)}">My View</a>
    <a class="${mode==='shared'?'active':''}" href="${esc(sharedHref)}">Shared Household View</a>
  </div>`;
}

export function previewBanner({ buyerName, returnHref }) {
  return `<div class="i29-banner">Previewing buyer-facing UI for ${esc(buyerName)} — HBE context is preserved. <a href="${esc(returnHref)}">Return to HBE Dashboard</a></div>`;
}

export function thankYouHtml({ first, accessCode, remembered }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Buyer Experience received | HomeBuyer Experts</title>${ISSUE29_CSS}</head>
<body style="margin:0;background:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2c2c2c">
<header style="padding:1rem 1.5rem;border-bottom:1px solid #e8e5e0"><a href="https://hbexperts.com/" style="font:700 1.28rem Georgia,serif;color:#1a1a2e;text-decoration:none">HomeBuyer Experts</a></header>
<main class="i29-thanks">
  <div class="i29-kicker">Submitted · not a hire</div>
  <h1>Thank you, ${esc(first)}.</h1>
  <p>Your Buyer Experience is now a private HBE record. Submitting is how you start a conversation — it does not hire HomeBuyer Experts, and it does not commit you to a search, an offer, or a timeline.</p>
  <p><strong>Privacy, plainly.</strong> Reflective answers stay with you and authorized HBE professionals. Another buyer in the household does not automatically see them. HBE does not use this information to advertise at you. You can read the full policy at <a href="https://hbexperts.com/privacy/">hbexperts.com/privacy</a>.</p>
  <p><strong>What happens next — without promises we cannot keep.</strong> An HBE advisor reviews what you actually submitted. The usual next step is a Buyer Strategy Session: a complimentary, no-obligation conversation of about an hour. We aim to meet in person in Northeast Ohio when that is useful; Zoom is also available. Timing depends on calendars. We will not spend that hour re-asking questions you have already answered if we can help it.</p>
  <p>The next useful step after that conversation might be to search. It might also be to prepare, learn, change the plan, wait, or decide HBE is not the right fit. Nothing is signed because you filled this out.</p>
  <section class="i29-comp">
    <div class="i29-kicker">Compensation</div>
    <h2 style="font:600 1.2rem Georgia,serif;color:#1a1a2e;margin:.25rem 0">${esc(COMPENSATION_PUBLIC.headline)}</h2>
    <p>${esc(COMPENSATION_PUBLIC.body)}</p>
  </section>
  <div class="i29-code"><small>Your cross-device access code</small><strong>${esc(accessCode)}</strong></div>
  <p>Keep this code somewhere private. Use it with your email to open the same Buyer Portal on another phone, tablet, or computer. ${remembered?'This device is remembered for up to 30 days.':'This device is signed in for this browser session.'} Contracts and financial-document areas still require extra verification.</p>
  <p><a class="i29-open-full" href="/portal">Open my Buyer Portal</a></p>
</main>
<script>try{sessionStorage.removeItem('hbe:buyer-experience:draft');sessionStorage.removeItem('hbeBuyerExperienceV2')}catch{}</script>
</body></html>`;
}

export function compensationPublicHtml() {
  return `<section class="i29-comp" id="compensation-note"><div class="i29-kicker">Before you hire</div><h2 style="font:600 1.25rem Georgia,serif;color:#1a1a2e;margin:.25rem 0">${esc(COMPENSATION_PUBLIC.headline)}</h2><p>${esc(COMPENSATION_PUBLIC.body)}</p></section>`;
}

export function compensationPostHireHtml(summary) {
  return `<section class="i29-comp"><div class="i29-kicker">After hire · private household</div><p>${esc(COMPENSATION_POST_HIRE_NOTE)}</p>${summary?`<p><strong>Recorded arrangement:</strong> ${esc(summary)}</p>`:''}</section>`;
}

export function dashboardShell({ title, banner = '', body, extraHead = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(title)}</title>${ISSUE29_CSS}${extraHead}</head><body style="margin:0;background:#f8f8f7;color:#2c2c2c;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${banner}<header style="padding:1rem 1.5rem;border-bottom:1px solid #e8e5e0;background:#fff"><a href="https://hbexperts.com/" style="font:700 1.28rem Georgia,serif;color:#1a1a2e;text-decoration:none">HomeBuyer Experts</a></header><main style="max-width:1180px;margin:auto;padding:1.25rem 1rem 4rem">${body}</main>${ISSUE29_JS}</body></html>`;
}
