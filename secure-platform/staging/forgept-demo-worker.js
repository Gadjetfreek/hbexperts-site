const ALLOWED_EMAIL_DEFAULT = 'cwhitehead@hbexperts.com';

const HOUSEHOLD = {
  id: 'synthetic-rivera-household',
  buyers: [
    {
      id: 'alex-rivera',
      firstName: 'Alex',
      fullName: 'Alex Rivera',
      voice: 'I want a home that makes daily life calmer without trading away the ability to get to work and family easily.',
      privateNote: 'Alex tends to want the major risks named clearly before deciding and prefers evidence side by side.'
    },
    {
      id: 'sam-rivera',
      firstName: 'Sam',
      fullName: 'Sam Rivera',
      voice: 'I want enough room for people to gather, but I do not want the house itself to become the thing our life revolves around.',
      privateNote: 'Sam wants time to talk through tradeoffs and cares strongly about the feel of the street and neighborhood.'
    }
  ],
  sharedStory: 'Alex and Sam are trying to create a quieter home base with enough room to host family, a practical commute, and a neighborhood that feels settled rather than hectic. They are willing to trade some square footage for location and condition. Their decision works only if both people understand the tradeoffs and can still recognize themselves in the choice.',
  hbeStory: 'Rivera household: prioritize calm daily life, practical commute, gathering space, neighborhood feel, and condition over maximum square footage. Watch for decisions where one buyer is optimizing risk while the other is optimizing lived experience; surface the underlying tradeoff rather than forcing false agreement.',
  currentStage: 6
};

const STAGES = [
  stage('Buyer Experience', 'Understand the people before the properties.', [
    item('Buyer Experience submitted', true),
    item('Private co-buyer invitation offered', true),
    item('HBE review of shared starting point', true)
  ]),
  stage('Consultation', 'Turn answers into a shared decision framework.', [
    item('Review goals, uncertainty and decision style', true),
    item('Explain exclusive buyer representation', true),
    item('Agree on immediate questions to answer', true)
  ]),
  stage('Hire HBE', 'Choose representation deliberately, without pressure.', [
    item('Representation options reviewed', true),
    item('Compensation conversation held', true),
    item('Agreement signed only after buyer choice', true)
  ]),
  stage('Financial Readiness', 'Know the real boundaries before shopping creates pressure.', [
    item('Monthly comfort range discussed', true),
    item('Financing path confirmed', true),
    item('Cash-to-close range understood', true)
  ]),
  stage('Define the Search', 'Translate life priorities into a search that can learn.', [
    item('Search geography agreed', true),
    item('Needs vs preferences separated', true),
    item('Initial tradeoffs named', true)
  ]),
  stage('Market Education', 'Learn what the market is actually offering.', [
    item('Review representative active listings', true),
    item('Review recent sales and market pace', true),
    item('Identify where expectations and market disagree', false, 'hbe', 'Prepare a short market-evidence note for Alex and Sam')
  ]),
  stage('Search', 'Use the market as evidence, not a slot machine.', [
    item('Review today\'s best-fit listings', false, 'buyer', 'Ask household to react to today\'s three best-fit listings'),
    item('Record why rejected listings missed', false, 'hbe', 'Update the household story with rejection patterns'),
    item('Adjust search only when evidence supports it', false)
  ]),
  stage('Tour Homes', 'Experience homes deliberately and notice what changes.', [
    item('Choose tour candidates', false, 'buyer', 'Buyer confirms which homes are worth seeing'),
    item('Plan efficient tour route', false, 'hbe', 'HBE prepares tour sequence and property packet'),
    item('Capture each buyer\'s reaction separately', false)
  ]),
  stage('Compare', 'Separate attraction from durable fit.', [
    item('Compare top homes against shared priorities', false),
    item('Surface disagreements without forcing consensus', false),
    item('Name what remains unknown', false, 'hbe', 'HBE identifies unresolved facts worth investigating')
  ]),
  stage('Offer Planning', 'Decide the boundaries before urgency decides for you.', [
    item('Estimate value range', false, 'hbe', 'Prepare value and comparable-market analysis'),
    item('Choose walk-away boundary', false, 'buyer', 'Household discusses the point where this stops being the right choice'),
    item('Review contingencies and risk tolerance', false)
  ]),
  stage('Write the Offer', 'Turn the buyer\'s decision into clear terms.', [
    item('Confirm price and material terms', false),
    item('Review offer before signature', false),
    item('Submit and document delivery', false)
  ]),
  stage('Under Contract', 'Shift from winning the house to verifying the decision.', [
    item('Critical dates confirmed', false, 'hbe', 'Create date-critical contract timeline'),
    item('Earnest money path confirmed', false, 'buyer', 'Buyer receives earnest-money instructions'),
    item('Inspection and lender contacts coordinated', false)
  ]),
  stage('Inspections', 'Investigate before commitment deepens.', [
    item('Inspection completed', false),
    item('Material findings sorted by consequence', false, 'hbe', 'Prepare inspection decision brief'),
    item('Buyer chooses response', false, 'buyer', 'Household chooses repair, credit, acceptance or exit path')
  ]),
  stage('Due Diligence', 'Resolve title, disclosures and property-specific unknowns.', [
    item('Title and public-record issues reviewed', false),
    item('Insurance / insurability checked', false),
    item('Remaining material unknowns closed or accepted', false)
  ]),
  stage('Financing & Appraisal', 'Keep the financing decision aligned with the home decision.', [
    item('Lender milestones on track', false),
    item('Appraisal reviewed', false),
    item('Any appraisal gap becomes an explicit buyer choice', false)
  ]),
  stage('Closing Prep', 'Make the final commitment boring and predictable.', [
    item('Closing disclosure reviewed', false),
    item('Final funds / wiring safety confirmed', false),
    item('Final walkthrough plan set', false)
  ]),
  stage('Get the Keys', 'Close deliberately; celebrate after the facts are final.', [
    item('Final walkthrough completed', false),
    item('Closing completed', false),
    item('Keys and possession confirmed', false)
  ]),
  stage('After the Keys', 'The relationship does not end at the closing table.', [
    item('30-day settling-in check', false, 'hbe', 'Schedule a 30-day homeowner check-in'),
    item('90-day “what surprised you?” review', false, 'buyer', 'Invite household to record what the home taught them'),
    item('1-year home + decision review', false, 'hbe', 'Schedule the one-year ownership review')
  ])
];

const FOLLOW_UP = [
  ['30 days', 'Settling-in check: urgent surprises, vendors, warranty questions.'],
  ['90 days', 'What changed after living there? Update the household/home story.'],
  ['1 year', 'Review the purchase decision, home performance, taxes/insurance and future plans.'],
  ['Each anniversary', 'Light-touch homeowner check-in for as long as it remains useful.']
];

export default {
  async fetch(request, env) {
    const gate = authorizePreview(request, env);
    if (!gate.ok) return gate.response;

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') return json({ ok: true, mode: 'forgept-synthetic-staging', productionData: false });
    if (path === '/' || path === '/hbe') return html(hbePage());
    if (path === '/portal') return html(portalPage());
    if (path === '/thank-you') return html(thankYouPage());
    if (path === '/invite') return html(invitePage());
    return html(notFoundPage(), 404);
  }
};

function authorizePreview(request, env) {
  const url = new URL(request.url);
  const expectedEmail = String(env.STAGING_ALLOWED_EMAIL || ALLOWED_EMAIL_DEFAULT).toLowerCase();
  const accessEmail = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase();
  if (accessEmail && accessEmail === expectedEmail) return { ok: true };

  const token = String(env.STAGING_PREVIEW_TOKEN || '');
  const supplied = url.searchParams.get('preview') || readCookie(request.headers.get('cookie') || '', 'hbe_stage_preview');
  if (token && supplied && timingSafeEqualText(token, supplied)) {
    if (url.searchParams.has('preview')) {
      url.searchParams.delete('preview');
      const headers = secureHeaders();
      headers.set('location', url.toString());
      headers.append('set-cookie', `hbe_stage_preview=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=14400`);
      return { ok: false, response: new Response(null, { status: 303, headers }) };
    }
    return { ok: true };
  }

  return {
    ok: false,
    response: new Response('HBE staging preview is gated. Use Cloudflare Access or the separately supplied staging preview credential.', {
      status: 403,
      headers: secureHeaders('text/plain; charset=utf-8')
    })
  };
}

function timingSafeEqualText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header, name) {
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function hbePage() {
  const current = STAGES[HOUSEHOLD.currentStage];
  return shell('HBE Dashboard', `
    <header class="topbar">
      <div><div class="eyebrow">Synthetic staging · ForgePT rendition</div><h1>Rivera household</h1><p class="lede">One household, two people, one evolving decision.</p></div>
      <div class="pill">Current stage · ${escapeHtml(current.name)}</div>
    </header>

    <section class="buyer-card" aria-label="Household dashboard switcher">
      <a class="card-half hbe-half" href="/hbe"><span class="kicker">HBE side</span><strong>HBE Dashboard</strong><small>Evidence, coordination, risk and next actions</small></a>
      <a class="card-half buyer-half" href="/portal"><span class="kicker">Buyer side</span><strong>Buyer Dashboard</strong><small>What Alex and Sam see and control</small></a>
    </section>

    <div class="layout two">
      <section class="panel story-panel">
        <div class="eyebrow">This household's story · HBE synthesis</div>
        <h2>The decision behind the search</h2>
        <p class="story">${escapeHtml(HOUSEHOLD.hbeStory)}</p>
        <div class="voice-grid">
          ${HOUSEHOLD.buyers.map(b => `<article><strong>${escapeHtml(b.firstName)}'s lens</strong><p>${escapeHtml(b.privateNote)}</p></article>`).join('')}
        </div>
      </section>
      <section class="panel next-panel" id="nextPanel">
        <div class="eyebrow">What's next</div>
        <h2>Useful even before a human adds a task</h2>
        <div id="nextActions"></div>
      </section>
    </div>

    <section class="panel">
      <div class="section-head"><div><div class="eyebrow">Journey control</div><h2>18 stages + long-horizon care</h2></div><p>Click a stage to see its checklist. Completing selected items can create a buyer or HBE follow-up.</p></div>
      <div class="stage-strip" id="stageStrip">${renderStageButtons(false)}</div>
      <div id="stageDetail"></div>
    </section>

    <section class="panel follow">
      <div class="eyebrow">After the keys</div><h2>Follow-up can last years, when it remains useful.</h2>
      <div class="follow-grid">${FOLLOW_UP.map(([when, text]) => `<article><strong>${when}</strong><p>${escapeHtml(text)}</p></article>`).join('')}</div>
    </section>

    ${appScript('hbe')}
  `);
}

function portalPage() {
  const current = STAGES[HOUSEHOLD.currentStage];
  return shell('Buyer Portal', `
    <header class="topbar">
      <div><div class="eyebrow">Synthetic staging · Buyer Portal</div><h1 id="portalGreeting">Alex + Sam · Shared journey</h1><p class="lede">Your private views stay yours. The shared view contains only the facts and voice you choose to share together.</p></div>
      <a class="ghost" href="/hbe">View HBE card</a>
    </header>

    <section class="mode-switch" aria-label="Portal view">
      <button data-mode="alex" type="button">Alex's private view</button>
      <button data-mode="shared" class="active" type="button">Shared household view</button>
      <button data-mode="sam" type="button">Sam's private view</button>
    </section>

    <section class="panel story-panel">
      <div class="eyebrow" id="storyLabel">This household's story · shared</div>
      <h2 id="storyTitle">The life behind the home</h2>
      <p class="story" id="storyBody">${escapeHtml(HOUSEHOLD.sharedStory)}</p>
      <p class="privacy-copy" id="privacyCopy">Shared mode never exposes either buyer's private reflections. HBE can work with each person's private input without turning it into a score or revealing it to the other buyer.</p>
    </section>

    <div class="layout two">
      <section class="panel next-panel">
        <div class="eyebrow">What's next</div><h2>${escapeHtml(current.name)}</h2><div id="nextActions"></div>
      </section>
      <section class="panel compass">
        <div class="eyebrow">Journey Compass</div><h2>Not an empty box.</h2>
        <dl><div><dt>We're optimizing for</dt><dd>Calm daily life + practical commute</dd></div><div><dt>Tradeoff we're watching</dt><dd>Space vs location/condition</dd></div><div><dt>Still uncertain</dt><dd>Which neighborhoods feel right after dark and on weekends</dd></div></dl>
        <a class="text-link" href="/invite">Invite the other buyer privately →</a>
      </section>
    </div>

    <section class="panel">
      <div class="section-head"><div><div class="eyebrow">Your journey</div><h2>Hover to preview. Click to work the stage.</h2></div><p>18 stages keep “Get the Keys” intact and add post-purchase care after it.</p></div>
      <div class="portal-map" id="stageStrip">${renderStageButtons(true)}</div>
      <div id="stageDetail"></div>
    </section>

    <section class="panel compensation">
      <div class="eyebrow">Representation & compensation</div><h2>The number is not the relationship.</h2>
      <p>Before you hire HBE, this portal does not publish a one-size-fits-all commission number. If you choose representation, HBE will explain the available compensation structures, what each means for you, and the tradeoffs. <strong>Real estate compensation is negotiable.</strong></p>
      <div class="option-grid"><article><strong>Seller-offered compensation</strong><p>Use available seller-side compensation where it fits the agreement and your interests.</p></article><article><strong>Buyer-paid arrangement</strong><p>Agree directly on buyer-paid compensation when that creates the clearest structure.</p></article><article><strong>Negotiated hybrid</strong><p>Combine sources or terms when permitted and appropriate. The agreement is specific to the client.</p></article></div>
    </section>

    ${appScript('portal')}
    <script>${portalModeScript()}</script>
  `);
}

function thankYouPage() {
  return shell('Buyer Experience received', `
    <main class="thankyou">
      <div class="eyebrow">Buyer Experience · synthetic staging</div>
      <div class="seal">✓</div>
      <h1>Your Buyer Experience is ready for HBE.</h1>
      <p class="lede">You shared information so HBE can understand the people and decision before talking about houses. That information belongs inside your private buyer journey—not in public marketing and not in a generic lead list.</p>
      <section class="panel steps-card"><h2>What happens next</h2><ol><li><strong>HBE reviews what you actually submitted.</strong> Unanswered reflective questions stay unanswered.</li><li><strong>We prepare for the consultation.</strong> We use your priorities and questions to make the conversation more useful.</li><li><strong>You remain in control.</strong> The consultation is education and decision support, not pressure to hire.</li></ol></section>
      <section class="privacy-banner"><strong>Privacy by design.</strong><span>Your private reflections are not displayed in the shared household portal unless you deliberately share them. A second buyer receives their own invitation and login rather than inheriting your session.</span></section>
      <div class="actions"><a class="primary" href="/portal">Open synthetic Buyer Portal</a><a class="ghost" href="/hbe">See HBE's synthetic view</a></div>
    </main>
  `);
}

function invitePage() {
  return shell('Private co-buyer invitation', `
    <main class="thankyou">
      <div class="eyebrow">Private household invitation · demonstration</div>
      <h1>Invite Sam without sharing Alex's session.</h1>
      <p class="lede">In production, the second buyer gets an independent invitation, establishes their own identity/login, and chooses what becomes shared household information.</p>
      <section class="panel invite-card"><label><span>Second buyer email</span><input type="email" value="sam.rivera@example.test" readonly></label><button class="primary" id="sendInvite" type="button">Create synthetic invitation</button><div id="inviteResult" class="result" hidden></div></section>
      <p class="privacy-copy">This staging rendition does not send email and uses only the reserved <code>.test</code> domain. No real invitation, login, or client record is created.</p>
      <a class="ghost" href="/portal">← Back to Buyer Portal</a>
      <script>document.getElementById('sendInvite').addEventListener('click',()=>{const box=document.getElementById('inviteResult');box.hidden=false;box.innerHTML='<strong>Invitation simulated.</strong><br>Sam would receive a one-time link and create an independent login. Alex\'s private answers remain private.';});</script>
    </main>
  `);
}

function notFoundPage() {
  return shell('Not found', '<main class="thankyou"><h1>That staging route does not exist.</h1><a class="primary" href="/hbe">Open HBE staging demo</a></main>');
}

function stage(name, description, checklist) { return { name, description, checklist }; }
function item(text, done = false, triggerFor = '', triggerText = '') { return { text, done, triggerFor, triggerText }; }

function renderStageButtons(portal) {
  return STAGES.map((s, i) => {
    const cls = i === HOUSEHOLD.currentStage ? ' current' : i < HOUSEHOLD.currentStage ? ' complete' : '';
    const peek = portal ? `<span class="stagepeek"><strong>${i + 1}. ${escapeHtml(s.name)}</strong>${escapeHtml(s.description)}</span>` : '';
    return `<button class="stage-btn${cls}" type="button" data-stage="${i}"><span class="stage-num">${i + 1}</span><span>${escapeHtml(s.name)}</span>${peek}</button>`;
  }).join('');
}

function appScript(context) {
  const stageData = JSON.stringify(STAGES).replace(/</g, '\\u003c');
  return `<script>
  (()=>{
    const stages=${stageData};
    const currentStage=${HOUSEHOLD.currentStage};
    const storageKey='hbe-forgept-demo-state-v1';
    let state={checked:{},followups:[]};
    try{state={...state,...JSON.parse(localStorage.getItem(storageKey)||'{}')};}catch{}
    const save=()=>localStorage.setItem(storageKey,JSON.stringify(state));
    const isDone=(si,ii)=>state.checked[si+'-'+ii] ?? stages[si].checklist[ii].done;
    function seedNext(){
      const box=document.getElementById('nextActions'); if(!box)return;
      const candidates=[];
      for(let s=currentStage;s<stages.length && candidates.length<3;s++){
        stages[s].checklist.forEach((it,i)=>{if(candidates.length<3&&!isDone(s,i))candidates.push({s,i,it});});
      }
      if(!candidates.length)candidates.push({s:stages.length-1,i:0,it:{text:'Schedule the next useful homeowner check-in'}});
      const follow=state.followups.slice(-3).reverse();
      box.innerHTML='<div class="task-list">'+candidates.map(x=>'<button type="button" class="task" data-open-stage="'+x.s+'"><span>Next</span><strong>'+escapeText(x.it.text)+'</strong><small>Seeded from '+escapeText(stages[x.s].name)+' checklist</small></button>').join('')+'</div>'+(follow.length?'<div class="triggered"><strong>Triggered follow-ups</strong>'+follow.map(f=>'<p><span>'+escapeText(f.owner.toUpperCase())+'</span>'+escapeText(f.text)+'</p>').join('')+'</div>':'');
      box.querySelectorAll('[data-open-stage]').forEach(b=>b.addEventListener('click',()=>renderStage(Number(b.dataset.openStage))));
    }
    function renderStage(index){
      document.querySelectorAll('.stage-btn').forEach(b=>b.classList.toggle('selected',Number(b.dataset.stage)===index));
      const s=stages[index]; const detail=document.getElementById('stageDetail'); if(!detail)return;
      detail.innerHTML='<div class="stage-detail"><div><div class="eyebrow">Stage '+(index+1)+'</div><h3>'+escapeText(s.name)+'</h3><p>'+escapeText(s.description)+'</p></div><div class="checklist">'+s.checklist.map((it,i)=>'<label class="check-row"><input type="checkbox" data-check="'+index+'-'+i+'" '+(isDone(index,i)?'checked':'')+'><span><strong>'+escapeText(it.text)+'</strong>'+(it.triggerFor?'<small>Completing this can trigger a '+escapeText(it.triggerFor.toUpperCase())+' follow-up.</small>':'')+'</span></label>').join('')+'</div></div>';
      detail.querySelectorAll('[data-check]').forEach(cb=>cb.addEventListener('change',()=>{
        const [si,ii]=cb.dataset.check.split('-').map(Number); state.checked[cb.dataset.check]=cb.checked;
        const it=stages[si].checklist[ii];
        if(cb.checked&&it.triggerFor&&it.triggerText&&!state.followups.some(f=>f.key===cb.dataset.check)) state.followups.push({key:cb.dataset.check,owner:it.triggerFor,text:it.triggerText});
        if(!cb.checked) state.followups=state.followups.filter(f=>f.key!==cb.dataset.check);
        save(); seedNext();
      }));
    }
    const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    document.querySelectorAll('.stage-btn').forEach(b=>b.addEventListener('click',()=>renderStage(Number(b.dataset.stage))));
    seedNext(); renderStage(currentStage);
  })();
  </script>`;
}

function portalModeScript() {
  const buyerData = JSON.stringify(HOUSEHOLD.buyers).replace(/</g, '\\u003c');
  const shared = JSON.stringify(HOUSEHOLD.sharedStory).replace(/</g, '\\u003c');
  return `(()=>{const buyers=${buyerData};const shared=${shared};const buttons=[...document.querySelectorAll('[data-mode]')];const greeting=document.getElementById('portalGreeting');const label=document.getElementById('storyLabel');const body=document.getElementById('storyBody');const privacy=document.getElementById('privacyCopy');function setMode(mode){buttons.forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));if(mode==='shared'){greeting.textContent='Alex + Sam · Shared journey';label.textContent="This household's story · shared";body.textContent=shared;privacy.textContent="Shared mode never exposes either buyer's private reflections. HBE can work with each person's private input without turning it into a score or revealing it to the other buyer.";}else{const b=mode==='alex'?buyers[0]:buyers[1];const other=mode==='alex'?buyers[1]:buyers[0];greeting.textContent=b.firstName+" · Private view";label.textContent=b.firstName+"'s voice · private";body.textContent=b.voice;privacy.textContent=other.firstName+" is acknowledged as part of this household, but "+other.firstName+"'s private reflections are not visible in "+b.firstName+"'s view. Shared facts appear only in Shared household view.";}}buttons.forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));setMode('shared');})();`;
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)} | HBE staging</title><style>${styles()}</style></head><body><nav><a class="brand" href="/hbe">HomeBuyer Experts</a><span>Synthetic staging · not production</span><div><a href="/hbe">HBE</a><a href="/portal">Buyer Portal</a><a href="/thank-you">Thank-you</a></div></nav><main class="wrap">${body}</main><footer>People are the purpose. Real estate is the medium. · ForgePT synthetic staging rendition</footer></body></html>`;
}

function styles() {
  return `:root{--navy:#171b34;--green:#2e6544;--green2:#3f7b58;--gold:#c7a74f;--ink:#2a2d32;--muted:#697078;--line:#e6e3dd;--warm:#f8f6f1;--paper:#fff;--blue:#eaf0f7}*{box-sizing:border-box}html{background:#f3f1ec;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;line-height:1.55}a{color:inherit}nav{position:sticky;top:0;z-index:30;display:flex;gap:1.25rem;align-items:center;padding:.9rem clamp(1rem,4vw,2.5rem);background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}nav .brand{font:700 1.2rem Georgia,serif;text-decoration:none;color:var(--navy)}nav>span{color:var(--muted);font-size:.82rem;flex:1}nav div{display:flex;gap:.85rem}nav div a{font-weight:700;font-size:.9rem;text-decoration:none;color:var(--green)}.wrap{max-width:1220px;margin:auto;padding:3rem clamp(1rem,4vw,2.5rem) 5rem}.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:2rem;margin-bottom:2rem}.eyebrow,.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:.73rem;font-weight:800;color:var(--green)}h1,h2,h3{font-family:Georgia,serif;color:var(--navy);line-height:1.12}h1{font-size:clamp(2.3rem,5vw,4.4rem);margin:.35rem 0 .5rem}h2{font-size:clamp(1.5rem,3vw,2.1rem);margin:.3rem 0 .8rem}h3{font-size:1.35rem;margin:.2rem 0 .45rem}.lede{font-size:1.06rem;color:var(--muted);max-width:760px}.pill{padding:.6rem .85rem;border:1px solid var(--line);background:#fff;border-radius:999px;font-weight:700;color:var(--green);white-space:nowrap}.buyer-card{display:grid;grid-template-columns:1fr 1fr;background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:1.4rem;box-shadow:0 14px 40px rgba(23,27,52,.06)}.card-half{padding:1.5rem 1.7rem;text-decoration:none;display:flex;flex-direction:column;gap:.25rem;min-height:130px;justify-content:center;transition:.18s}.card-half:hover{transform:translateY(-2px)}.card-half strong{font:700 1.6rem Georgia,serif;color:var(--navy)}.card-half small{color:var(--muted)}.hbe-half{border-right:1px solid var(--line);background:linear-gradient(135deg,#fff,var(--warm))}.buyer-half{background:linear-gradient(135deg,#fff,#eef5f0)}.layout.two{display:grid;grid-template-columns:1.45fr .9fr;gap:1.4rem}.panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:1.45rem;margin-bottom:1.4rem;box-shadow:0 10px 30px rgba(23,27,52,.035)}.story{font:400 clamp(1.22rem,2.4vw,1.7rem)/1.55 Georgia,serif;color:#353747}.voice-grid,.follow-grid,.option-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.9rem;margin-top:1.2rem}.voice-grid article,.follow-grid article,.option-grid article{background:var(--warm);border:1px solid var(--line);border-radius:12px;padding:1rem}.voice-grid p,.follow-grid p,.option-grid p{margin:.35rem 0 0;color:var(--muted);font-size:.93rem}.section-head{display:flex;justify-content:space-between;gap:2rem;align-items:end;margin-bottom:1rem}.section-head>p{max-width:500px;color:var(--muted);margin:0}.stage-strip,.portal-map{display:grid;grid-template-columns:repeat(6,1fr);gap:.65rem}.stage-btn{position:relative;appearance:none;border:1px solid var(--line);background:#fff;border-radius:11px;padding:.75rem .65rem;min-height:80px;text-align:left;cursor:pointer;color:var(--navy);font-weight:700}.stage-btn:hover,.stage-btn.selected{border-color:var(--green);box-shadow:0 5px 16px rgba(46,101,68,.12)}.stage-btn.current{background:#eef6f0;border-color:#8eb39a}.stage-btn.complete:after{content:'✓';position:absolute;right:.45rem;top:.35rem;color:var(--green)}.stage-num{display:block;font-size:.72rem;color:var(--muted);margin-bottom:.25rem}.stagepeek{position:absolute;left:50%;bottom:calc(100% + 8px);width:230px;transform:translate(-50%,6px);padding:.75rem;background:var(--navy);color:#fff;border-radius:9px;font-weight:400;font-size:.8rem;line-height:1.4;opacity:0;visibility:hidden;pointer-events:none;transition:.15s;z-index:20;box-shadow:0 10px 30px rgba(0,0,0,.18)}.stagepeek strong{display:block;color:#f4df9b;margin-bottom:.25rem}.portal-map .stage-btn:hover .stagepeek,.portal-map .stage-btn:focus .stagepeek{opacity:1;visibility:visible;transform:translate(-50%,0)}.stage-detail{display:grid;grid-template-columns:.7fr 1.3fr;gap:1.2rem;margin-top:1rem;background:var(--warm);border:1px solid var(--line);border-radius:12px;padding:1.2rem}.stage-detail p{color:var(--muted)}.checklist{display:grid;gap:.55rem}.check-row{display:flex;gap:.7rem;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:9px;padding:.75rem;cursor:pointer}.check-row input{margin-top:.22rem;accent-color:var(--green)}.check-row span{display:flex;flex-direction:column}.check-row small{color:var(--muted);margin-top:.15rem}.task-list{display:grid;gap:.55rem}.task{appearance:none;border:1px solid var(--line);background:#fff;border-radius:10px;text-align:left;padding:.8rem;cursor:pointer;display:grid;gap:.15rem}.task>span{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--green);font-weight:800}.task small{color:var(--muted)}.triggered{border-top:1px solid var(--line);margin-top:1rem;padding-top:1rem}.triggered p{display:flex;gap:.55rem;margin:.5rem 0;color:var(--muted)}.triggered p span{font-size:.68rem;background:var(--blue);color:var(--navy);padding:.15rem .35rem;border-radius:4px;font-weight:800;align-self:flex-start}.mode-switch{display:flex;gap:.5rem;margin-bottom:1.4rem;flex-wrap:wrap}.mode-switch button,.ghost,.primary{appearance:none;border-radius:8px;padding:.75rem 1rem;font-weight:800;text-decoration:none;cursor:pointer;font:inherit}.mode-switch button,.ghost{border:1px solid var(--green);background:#fff;color:var(--green)}.mode-switch button.active,.primary{border:1px solid var(--green);background:var(--green);color:#fff}.compass dl{margin:0;display:grid;gap:.75rem}.compass dl div{border-bottom:1px solid var(--line);padding-bottom:.65rem}.compass dt{font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:800}.compass dd{margin:.2rem 0 0;color:var(--navy);font-weight:700}.text-link{display:inline-block;margin-top:1rem;color:var(--green);font-weight:800;text-decoration:none}.privacy-copy{color:var(--muted);font-size:.9rem}.option-grid{grid-template-columns:repeat(3,1fr)}.thankyou{max-width:820px;margin:2rem auto}.seal{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#e9f4ec;color:var(--green);font-weight:900;font-size:1.5rem;margin:1rem 0}.steps-card ol{padding-left:1.25rem}.steps-card li{padding:.45rem}.privacy-banner{display:flex;gap:1rem;background:#fbf7e8;border-left:4px solid var(--gold);padding:1rem 1.1rem;border-radius:8px;margin:1rem 0 1.4rem}.privacy-banner span{color:var(--muted)}.actions{display:flex;gap:.75rem;flex-wrap:wrap}.invite-card{display:grid;gap:1rem}.invite-card label{display:grid;gap:.35rem;font-weight:700}.invite-card input{padding:.8rem;border:1px solid var(--line);border-radius:8px;font:inherit}.result{background:#eaf5ed;border:1px solid #b9d7c1;padding:1rem;border-radius:9px}code{background:var(--warm);padding:.1rem .3rem;border-radius:4px}footer{border-top:1px solid var(--line);padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem;background:#fff}@media(max-width:950px){.stage-strip,.portal-map{grid-template-columns:repeat(3,1fr)}.layout.two,.stage-detail{grid-template-columns:1fr}}@media(max-width:650px){nav>span{display:none}nav div a:nth-child(3){display:none}.wrap{padding-top:2rem}.topbar{display:block}.pill{display:inline-block;margin-top:.5rem}.buyer-card{grid-template-columns:1fr}.hbe-half{border-right:0;border-bottom:1px solid var(--line)}.voice-grid,.follow-grid,.option-grid{grid-template-columns:1fr}.stage-strip,.portal-map{grid-template-columns:repeat(2,1fr)}.section-head{display:block}.privacy-banner{display:block}.privacy-banner strong{display:block;margin-bottom:.35rem}}`;
}

function secureHeaders(type = 'text/html; charset=utf-8') {
  return new Headers({
    'content-type': type,
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
}

function html(body, status = 200) { return new Response(body, { status, headers: secureHeaders() }); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: secureHeaders('application/json; charset=utf-8') }); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
