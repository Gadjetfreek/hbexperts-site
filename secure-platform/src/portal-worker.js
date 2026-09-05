import uiWorker from './ui-worker.js';

const DRAFT_KEY = 'hbe:buyer-experience:draft';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/questionnaire') {
      return page(questionnairePage());
    }

    if (request.method === 'POST' && url.pathname === '/api/intake') {
      return handleIntake(request, env, ctx);
    }

    if (request.method === 'GET' && url.pathname === '/buyer') {
      return redirect('/portal');
    }

    if (request.method === 'GET' && url.pathname === '/portal') {
      const internalUrl = new URL(request.url);
      internalUrl.pathname = '/buyer';
      const internalRequest = new Request(internalUrl.toString(), request);
      const response = await uiWorker.fetch(internalRequest, env, ctx);
      return decorate(response, true);
    }

    const response = await uiWorker.fetch(request, env, ctx);
    return decorate(response, false);
  }
};

async function handleIntake(request, env, ctx) {
  const form = await request.formData();
  const validation = validateSubmission(form);
  if (validation) return page(questionnairePage(validation), 400);

  const email = clean(form.get('email')).toLowerCase();
  const answers = richAnswers(form);

  const baseForm = new FormData();
  baseForm.set('first_name', clean(form.get('first_name')));
  baseForm.set('last_name', clean(form.get('last_name')));
  baseForm.set('email', email);
  baseForm.set('phone', clean(form.get('phone')));
  baseForm.set('why', clean(form.get('why')));
  baseForm.set('timeline', clean(form.get('timeline')));
  baseForm.set('location', clean(form.get('location')));
  baseForm.set('financing', clean(form.get('financing')));
  baseForm.set('concerns', answers.concerns.join('; '));
  baseForm.set('notes', clean(form.get('notes')));
  if (form.get('remember_device') === 'yes') baseForm.set('remember_device', 'yes');

  const headers = new Headers(request.headers);
  headers.delete('content-type');
  headers.delete('content-length');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: baseForm,
    redirect: 'manual'
  });

  const response = await uiWorker.fetch(forwarded, env, ctx);

  if (response.status >= 200 && response.status < 300) {
    try {
      const buyer = await env.BUYER_DB.prepare(
        'SELECT id FROM buyers WHERE email=? ORDER BY submitted_at DESC LIMIT 1'
      ).bind(email).first();
      if (buyer?.id) {
        await env.BUYER_DB.prepare(
          'UPDATE buyers SET answers_json=?, updated_at=? WHERE id=?'
        ).bind(JSON.stringify(answers), new Date().toISOString(), buyer.id).run();
      }
    } catch (err) {
      console.error('Rich Buyer Experience persistence failed', err);
    }
  }

  return decorate(response, false);
}

function validateSubmission(form) {
  const required = [
    ['first_name', 'Please enter your first name.'],
    ['last_name', 'Please enter your last name.'],
    ['email', 'Please enter your email address.'],
    ['has_other_buyer', 'Please tell us whether another buyer is part of the decision.']
  ];

  for (const [name, message] of required) {
    if (!clean(form.get(name))) return message;
  }

  if (values(form, 'priorities').length > 3) {
    return 'Please choose up to three priorities.';
  }

  return '';
}

function richAnswers(form) {
  return {
    version: 'buyer-experience-2026-08-co-buyer-consent',
    phone: clean(form.get('phone')),
    has_other_buyer: clean(form.get('has_other_buyer')) === 'yes',
    why: clean(form.get('why')),
    situation: clean(form.get('situation')),
    success_definition: clean(form.get('success_definition')),
    priorities: values(form, 'priorities'),
    non_negotiables: clean(form.get('non_negotiables')),
    decision_style: clean(form.get('decision_style')),
    info_preference: clean(form.get('info_preference')),
    uncertainty_style: clean(form.get('uncertainty_style')),
    offer_pressure: clean(form.get('offer_pressure')),
    head_heart: clean(form.get('head_heart')),
    disagreement_style: clean(form.get('disagreement_style')),
    advisor_preference: clean(form.get('advisor_preference')),
    past_experience: clean(form.get('past_experience')),
    past_experience_detail: clean(form.get('past_experience_detail')),
    home_feeling: clean(form.get('home_feeling')),
    lifestyle_pace: clean(form.get('lifestyle_pace')),
    space_priority: clean(form.get('space_priority')),
    timeline: clean(form.get('timeline')),
    location: clean(form.get('location')),
    financing: clean(form.get('financing')),
    concerns: values(form, 'concerns'),
    unknowns: clean(form.get('unknowns')),
    saturday_morning_vision: clean(form.get('saturday_morning_vision')),
    consultation_success: clean(form.get('consultation_success')),
    notes: clean(form.get('notes'))
  };
}

async function decorate(response, portalPage) {
  const headers = new Headers(response.headers);

  if (headers.has('location')) {
    const location = headers.get('location');
    if (location === '/buyer') headers.set('location', '/portal');
  }

  const type = headers.get('content-type') || '';
  if (!type.includes('text/html')) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  let text = await response.text();
  text = text
    .replaceAll('BuyerUI', 'Buyer Portal')
    .replaceAll('href="/buyer"', 'href="/portal"')
    .replaceAll("href='/buyer'", "href='/portal'");

  const css = portalPage ? PORTAL_CSS : GLOBAL_SECURE_CSS;
  text = text.replace('</head>', `${css}</head>`);

  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function questionnairePage(message = '') {
  const prefer = 'Prefer not to answer';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Buyer Experience | HomeBuyer Experts</title>
<style>
:root{--navy:#1a1a2e;--green:#2d5a3d;--green2:#3a7a52;--gold:#c9a84c;--text:#2c2c2c;--muted:#6b6b6b;--warm:#faf9f6;--section:#f5f3ef;--border:#e8e5e0;--danger:#9c2f2f}
*{box-sizing:border-box}html{background:#fff;-webkit-font-smoothing:antialiased}body{margin:0;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}.site-header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}.header-inner{max-width:1100px;margin:auto;padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}.brand{font:700 1.28rem Georgia,serif;color:var(--navy);text-decoration:none}.context{color:var(--muted);font-size:.9rem}.experience{max-width:900px;margin:auto;padding:3rem 1.5rem 5rem}.progress-row{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.65rem;color:var(--muted);font-size:.88rem}.progress-track{height:5px;background:var(--border);border-radius:999px;overflow:hidden;margin-bottom:2.5rem}.progress-fill{height:100%;background:var(--green);width:12.5%;transition:width .2s}.step{display:none}.step.active{display:block}.eyebrow{font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:.55rem}h1{font:600 clamp(2rem,5vw,3rem)/1.1 Georgia,serif;color:var(--navy);margin:.2rem 0 1rem}h2{font:600 1.5rem/1.2 Georgia,serif;color:var(--navy);margin:0 0 .5rem}.intro{font-size:1.05rem;color:var(--muted);max-width:760px;margin-bottom:2rem}.privacy{background:var(--warm);border-left:3px solid var(--gold);padding:1rem 1.1rem;border-radius:8px;margin:1.25rem 0 2rem}.error{background:#fff4f4;color:#762222;border:1px solid #e8c4c4;padding:1rem;border-radius:8px;margin-bottom:1.5rem}.group{margin:1.7rem 0}.label{display:block;font-weight:700;color:var(--navy);margin-bottom:.55rem}.hint{display:block;color:var(--muted);font-size:.88rem;font-weight:400;margin-top:.2rem}.required{color:var(--green);font-size:.82rem;font-weight:700;margin-left:.35rem}input[type=text],input[type=email],input[type=tel],textarea,select{width:100%;padding:.85rem .9rem;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text);font:inherit}textarea{resize:vertical;min-height:100px}input:focus,textarea:focus,select:focus{outline:3px solid rgba(45,90,61,.12);border-color:var(--green)}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.choices{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}.choice{display:flex;gap:.7rem;align-items:flex-start;padding:.9rem 1rem;border:1px solid var(--border);border-radius:9px;background:#fff;cursor:pointer;transition:.15s}.choice:hover{border-color:#cfcac2;background:var(--warm)}.choice input{margin-top:.25rem;accent-color:var(--green)}.choice span{line-height:1.4}.subcard{margin:1rem 0 0;padding:1.2rem;background:var(--warm);border:1px solid var(--border);border-radius:10px}.hidden{display:none!important}.navrow{display:flex;justify-content:space-between;gap:1rem;margin-top:2.4rem;padding-top:1.4rem;border-top:1px solid var(--border)}.btn{display:inline-flex;align-items:center;justify-content:center;padding:.85rem 1.35rem;border-radius:6px;text-decoration:none;font-weight:700;cursor:pointer;font:inherit}.primary{border:0;background:var(--green);color:#fff}.primary:hover{background:var(--green2)}.secondary{background:#fff;color:var(--green);border:1px solid var(--green)}.submitbox{background:var(--warm);border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-top:2rem}.submitbox strong{color:var(--navy)}.priority-count{color:var(--muted);font-size:.9rem;margin-top:.5rem}.priority-count.good{color:var(--green);font-weight:700}.footer-note{color:var(--muted);font-size:.88rem;margin-top:1rem}.skip-row{margin-top:.85rem;padding-top:0;border-top:0;align-items:center}.skip-deeper-note{margin:1rem 0 .35rem}.skip-deeper{white-space:normal;text-align:center}
@media(max-width:680px){.experience{padding:2rem 1rem 4rem}.grid2,.choices{grid-template-columns:1fr}.header-inner{padding:1rem}.navrow{align-items:stretch}.btn{flex:1}.context{font-size:.8rem}}
</style>
</head>
<body>
<header class="site-header"><div class="header-inner"><a class="brand" href="https://hbexperts.com/">HomeBuyer Experts</a><span class="context">Buyer Experience</span></div></header>
<main class="experience">
<div class="progress-row"><span id="stepName">You & this decision</span><span id="stepCount">1 of 8</span></div>
<div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
${message ? `<div class="error">${esc(message)}</div>` : ''}
<form id="buyerExperienceForm" method="post" action="/api/intake" novalidate>

<section class="step active" data-title="You & this decision">
<div class="eyebrow">Part 1</div><h1>Start with you.</h1>
<p class="intro">There are no right answers here. These questions help HBE understand what matters to you, how you make important choices, and how we can give you information in a way that actually helps you use it. <strong>You’re in control.</strong></p>
<div class="privacy"><strong>Nothing is sent to HBE yet.</strong> Your draft stays only in this browser session until you deliberately review and send it to HomeBuyer Experts.<br><br><strong>Reflective questions are optional.</strong> Share only what feels useful. You may skip them or choose “Prefer not to answer.” Skipping reflective questions will not reduce the quality of HBE representation or service you receive.</div>
<div class="grid2 group"><label><span class="label">First name <span class="required">Required</span></span><input name="first_name" autocomplete="given-name" required></label><label><span class="label">Last name <span class="required">Required</span></span><input name="last_name" autocomplete="family-name" required></label></div>
<div class="grid2 group"><label><span class="label">Email <span class="required">Required</span></span><input type="email" name="email" autocomplete="email" required></label><label><span class="label">Phone <span class="hint">Optional</span></span><input type="tel" name="phone" autocomplete="tel"></label></div>
<div class="group"><span class="label">Is another buyer making this decision with you? <span class="required">Required</span></span><div class="choices"><label class="choice"><input type="radio" name="has_other_buyer" value="yes" required><span>Yes — another buyer is part of this decision</span></label><label class="choice"><input type="radio" name="has_other_buyer" value="no" required><span>No — I’m the only buyer</span></label></div><p class="footer-note">If another buyer is involved, you will be able to create a private invitation from your Buyer Portal after you submit. They will enter their own identity and answers, and they decide whether to join the shared homebuying journey.</p></div>
<div class="group"><label><span class="label">What has you thinking about buying a home now? <span class="hint">Optional — share only what feels useful.</span></span><textarea name="why"></textarea></label></div>
<div class="group"><label><span class="label">Which best describes where you are starting?</span><select name="situation"><option value="">Choose one if helpful</option><option>First-time buyer</option><option>Moving up</option><option>Downsizing</option><option>Relocating</option><option>Investment purchase</option><option>Second home</option><option>Exploring possibilities</option><option>Something else</option></select></label></div>
<div class="navrow"><a class="btn secondary" href="/">Back to Journey</a><button class="btn primary next" type="button">Continue</button></div>
<p class="footer-note skip-deeper-note">Parts about decision style, pressure, and disagreement are optional reflection. Skipping them does not reduce the quality of HBE representation or service. You can still answer them later with Continue.</p>
<div class="navrow skip-row"><button class="btn secondary skip-deeper" type="button" data-skip-to="5">Skip deeper optional questions</button><span class="footer-note" style="flex:1;margin:0">Or continue through optional reflection pages.</span></div>
</section>

<section class="step" data-title="What matters">
<div class="eyebrow">Part 2</div><h1>What would make this the right decision?</h1>
<div class="group"><label><span class="label">Imagine it’s a year from now. What happened that made you say, “We made the right decision”? <span class="hint">Optional</span></span><textarea name="success_definition"></textarea></label></div>
<div class="group"><span class="label">Choose up to three priorities that matter most right now. <span class="hint">Optional — fewer is completely fine.</span></span><div class="choices" id="priorityChoices">${checkChoices('priorities',['Location','Price / monthly cost','Schools','Commute','Privacy','Yard / outdoor space','Investment potential','Walkability','Character','Low maintenance','Space for family','Future resale'])}</div><div class="priority-count" id="priorityCount">0 selected · choose up to 3 if helpful</div></div>
<div class="group"><label><span class="label">What are your non-negotiables? <span class="hint">Optional — “none yet” is perfectly useful too.</span></span><textarea name="non_negotiables"></textarea></label></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
<p class="footer-note skip-deeper-note">Parts about decision style, pressure, and disagreement are optional reflection. Skipping them does not reduce the quality of HBE representation or service. You can still answer them later with Continue.</p>
<div class="navrow skip-row"><button class="btn secondary skip-deeper" type="button" data-skip-to="5">Skip deeper optional questions</button></div>
</section>

<section class="step" data-title="How you decide">
<div class="eyebrow">Part 3</div><h1>How do you make important choices?</h1>
<p class="intro">These questions help us adapt how we communicate and support you. They are not a personality test and you may skip them.</p>
<div class="group"><span class="label">When making a major decision, which sounds most like you? <span class="hint">Optional</span></span><div class="choices">${radioChoices('decision_style',['I research thoroughly before deciding','I trust my gut and can move quickly','I talk it through with people I trust','I weigh the options carefully, then commit',prefer],false)}</div></div>
<div class="group"><span class="label">How do you prefer important information? <span class="hint">Optional</span></span><div class="choices">${radioChoices('info_preference',['Give me the data and let me analyze it','Give me the big picture first, details later','Walk me through it step by step','Tell me what you recommend and why',prefer],false)}</div></div>
<div class="group"><span class="label">When important information is incomplete, what feels most natural? <span class="hint">Optional</span></span><div class="choices">${radioChoices('uncertainty_style',['Keep gathering information until the uncertainty is smaller','Identify the biggest unknowns, then decide if the remaining risk is acceptable','Talk it through until I understand how the uncertainty changes the choice','If the downside is survivable and it feels right, I can act without knowing everything',prefer],false)}</div></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
<p class="footer-note skip-deeper-note">Parts about decision style, pressure, and disagreement are optional reflection. Skipping them does not reduce the quality of HBE representation or service. You can still answer them later with Continue.</p>
<div class="navrow skip-row"><button class="btn secondary skip-deeper" type="button" data-skip-to="5">Skip deeper optional questions</button></div>
</section>

<section class="step" data-title="Pressure & tradeoffs">
<div class="eyebrow">Part 4</div><h1>What happens when the choice gets harder?</h1>
<div class="group"><span class="label">You find a home you really like. There are three other offers and you have about 90 minutes to decide. What sounds most like you? <span class="hint">Optional</span></span><div class="choices">${radioChoices('offer_pressure',['I want every fact we can reasonably get before deciding','Give me the major risks and I can make the call','I need to talk it through with my partner or advisor first','If it feels right and the downside is survivable, I’m comfortable acting',prefer],false)}</div></div>
<div class="group"><span class="label">Two homes cost about the same. One checks 90% of your boxes but feels ordinary. The other checks 70%, but you immediately love being there. Where do you naturally lean? <span class="hint">Optional</span></span><div class="choices">${radioChoices('head_heart',['Toward the 90% fit — the evidence matters more','Toward the 70% fit — how it feels matters more','I would want to understand exactly what the missing 30% means before choosing','I honestly would not know until I experienced both more fully',prefer],false)}</div></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
<p class="footer-note skip-deeper-note">Parts about decision style, pressure, and disagreement are optional reflection. Skipping them does not reduce the quality of HBE representation or service. You can still answer them later with Continue.</p>
<div class="navrow skip-row"><button class="btn secondary skip-deeper" type="button" data-skip-to="5">Skip deeper optional questions</button></div>
</section>

<section class="step" data-title="Choosing with others">
<div class="eyebrow">Part 5</div><h1>How should we work through decisions with you?</h1>
<div class="group"><span class="label">When someone you trust sees a major choice differently than you do, what usually helps most? <span class="hint">Optional</span></span><div class="choices">${radioChoices('disagreement_style',['Put the evidence side by side','Let each person explain what matters to them before solving it','Give us time to think separately, then come back together','Help identify the tradeoff underneath the disagreement',prefer],false)}</div></div>
<div class="group"><span class="label">What kind of guidance is most useful from HBE? <span class="hint">Optional</span></span><div class="choices">${radioChoices('advisor_preference',['Teach me enough that I can reach my own conclusion','Challenge my thinking and point out what I may be missing','Give me a clear recommendation, including why you reached it','Help us slow down and compare the tradeoffs without pushing a conclusion',prefer],false)}</div></div>
<div class="group"><span class="label">Have you worked with a real estate professional before? <span class="hint">Optional</span></span><div class="choices">${radioChoices('past_experience',['Yes — great experience','Yes — mixed experience','Yes — negative experience','No — this is my first time',prefer],false)}</div></div>
<div class="group"><label><span class="label">If there’s something from a past experience you want done differently this time, tell us. <span class="hint">Optional</span></span><textarea name="past_experience_detail"></textarea></label></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
<p class="footer-note skip-deeper-note">Parts about decision style, pressure, and disagreement are optional reflection. Skipping them does not reduce the quality of HBE representation or service. You can still answer them later with Continue.</p>
<div class="navrow skip-row"><button class="btn secondary skip-deeper" type="button" data-skip-to="5">Skip deeper optional questions</button></div>
</section>

<section class="step" data-title="The life behind the home">
<div class="eyebrow">Part 6</div><h1>What are you really trying to create?</h1>
<div class="group"><span class="label">When you imagine walking into the right home, what is the first feeling you want? <span class="hint">Optional</span></span><div class="choices">${radioChoices('home_feeling',['Peace and quiet — a sanctuary from the world','Energy and warmth — a place where people gather','Pride and accomplishment — something I built or earned','Safety and security — a place where my household feels protected','Freedom and space — room to breathe, create, and grow',prefer],false)}</div></div>
<div class="group"><span class="label">Which description fits your daily life best? <span class="hint">Optional</span></span><div class="choices">${radioChoices('lifestyle_pace',['Always on the go — home is mainly a base','Balanced — active, but I value downtime','Home-centered — home is a major part of how I live','Work-from-home life — the space has to function for living and working',prefer],false)}</div></div>
<div class="group"><span class="label">If you had to choose, which tradeoff feels most acceptable? <span class="hint">Optional</span></span><div class="choices">${radioChoices('space_priority',['More indoor space, even if location or lot is less ideal','More outdoor space, even if the house is smaller','Better location, even if the home is smaller','Higher quality / condition, even if I get less space',prefer],false)}</div></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
</section>

<section class="step" data-title="Practical boundaries">
<div class="eyebrow">Part 7</div><h1>What constraints are real right now?</h1>
<p class="intro">These can be useful starting points, but you do not need to know them yet.</p>
<div class="group"><span class="label">What timing best fits right now? <span class="hint">Optional</span></span><select name="timeline"><option value="">Choose one if helpful</option><option>Immediately / within 30 days</option><option>1–3 months</option><option>3–6 months</option><option>6–12 months</option><option>More than a year</option><option>Just exploring / unsure</option></select></div>
<div class="group"><label><span class="label">Where are you hoping to live? <span class="hint">Optional — cities, neighborhoods, commute boundary, or “not sure yet.”</span></span><input type="text" name="location"></label></div>
<div class="group"><span class="label">Where does financing stand? <span class="hint">Optional</span></span><select name="financing"><option value="">Choose one if helpful</option><option>Haven’t started</option><option>Talking with lenders</option><option>Preapproved</option><option>Cash purchase</option><option>Not sure what I should do first</option></select></div>
<div class="group"><span class="label">What concerns you about the buying decision? <span class="hint">Optional — choose any that are useful.</span></span><div class="choices" id="concernChoices">${checkChoices('concerns',['Paying too much','Choosing the wrong area','Hidden property problems','Financing / monthly cost','Negotiating effectively','Timing / market conditions','Inspection issues','Making the wrong decision','I do not know what I do not know'])}</div></div>
<div class="group"><label><span class="label">What do you wish you understood better before making this decision? <span class="hint">Optional</span></span><textarea name="unknowns"></textarea></label></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><button class="btn primary next" type="button">Continue</button></div>
</section>

<section class="step" data-title="Your picture of success">
<div class="eyebrow">Part 8</div><h1>Give us the picture behind the purchase.</h1>
<div class="group"><label><span class="label">Imagine it’s a year from now. You’re sitting in your new home on a Saturday morning. What do you see, hear, and feel? <span class="hint">Optional, but often revealing.</span></span><textarea name="saturday_morning_vision"></textarea></label></div>
<div class="group"><label><span class="label">If we only accomplish one thing during our consultation, what would make you leave feeling the time was well spent? <span class="hint">Optional</span></span><textarea name="consultation_success"></textarea></label></div>
<div class="group"><label><span class="label">Anything else you want HBE to understand before we meet? <span class="hint">Optional</span></span><textarea name="notes"></textarea></label></div>
<label class="choice group"><input type="checkbox" name="remember_device" value="yes"><span><strong>Remember this device</strong><br><span class="hint">Keep the Buyer Portal signed in for up to 30 days. Sensitive contracts and financial documents will still require extra verification.</span></span></label>
<div class="submitbox"><strong>Nothing has been sent yet.</strong><p>Review exactly what HomeBuyer Experts will receive before you choose to send it. HBE will store what you actually send; unanswered reflective questions remain unanswered.</p><button class="btn primary" id="review-before-send" type="button">Review &amp; Send to HomeBuyer Experts</button></div>
<div class="navrow"><button class="btn secondary back" type="button">Back</button><span></span></div>
</section>

</form>
</main>
<script>
(()=>{
const form=document.querySelector('#buyerExperienceForm');
const steps=[...document.querySelectorAll('.step')];
const fill=document.querySelector('#progressFill');
const stepName=document.querySelector('#stepName');
const stepCount=document.querySelector('#stepCount');
const priorityCount=document.querySelector('#priorityCount');
let current=0;

function show(i){current=Math.max(0,Math.min(steps.length-1,i));steps.forEach((s,n)=>s.classList.toggle('active',n===current));stepName.textContent=steps[current].dataset.title;stepCount.textContent=(current+1)+' of '+steps.length;fill.style.width=((current+1)/steps.length*100)+'%';window.scrollTo({top:0,behavior:'smooth'});}
function priorities(){const selected=[...form.querySelectorAll('[name="priorities"]:checked')];priorityCount.textContent=selected.length+' selected · choose up to 3 if helpful';priorityCount.classList.toggle('good',selected.length>0);}
function validate(step){const fields=[...step.querySelectorAll('input,textarea,select')].filter(el=>!el.disabled);for(const el of fields){if(!el.checkValidity()){el.reportValidity();return false;}}return true;}
function save(){try{const data={};new FormData(form).forEach((v,k)=>{if(k==='remember_device')return;(data[k]??=[]).push(String(v));});sessionStorage.setItem('${DRAFT_KEY}',JSON.stringify(data));}catch{}}
function restore(){try{const data=JSON.parse(sessionStorage.getItem('${DRAFT_KEY}')||'{}');Object.entries(data).forEach(([name,vals])=>{const list=[...form.querySelectorAll('[name="'+name+'"]')];list.forEach(el=>{if(el.type==='radio'||el.type==='checkbox')el.checked=vals.includes(el.value);else if(vals.length)el.value=vals[0];});});}catch{}priorities();}

document.querySelectorAll('.next').forEach(b=>b.addEventListener('click',()=>{if(validate(steps[current]))show(current+1);}));
document.querySelectorAll('.back').forEach(b=>b.addEventListener('click',()=>show(current-1)));
document.querySelectorAll('.skip-deeper').forEach(b=>b.addEventListener('click',()=>{if(!validate(steps[current]))return;const target=Number(b.dataset.skipTo||5);show(target);}));
form.addEventListener('change',e=>{if(e.target.name==='priorities'){const selected=[...form.querySelectorAll('[name="priorities"]:checked')];if(selected.length>3){e.target.checked=false;}priorities();}save();});
form.addEventListener('input',save);
form.addEventListener('submit',e=>{for(let i=0;i<steps.length;i++){if(!validate(steps[i])){e.preventDefault();show(i);return;}}});
restore();show(0);
})();
</script>
</body></html>`;
}

const GLOBAL_SECURE_CSS = `<style id="buyer-portal-language">.secure-site-context{font-weight:600}.portal-label{color:#6b6b6b}</style>`;
const PORTAL_CSS = `<style id="buyer-portal-refresh">
body{background:#fff!important}.wrap{max-width:1200px!important;padding:3rem 2rem 5rem!important}.wrap>section{background:linear-gradient(180deg,#faf9f6 0,#fff 300px)!important;border:1px solid #e8e5e0!important;border-radius:14px!important;padding:clamp(1.5rem,4vw,3rem)!important;box-shadow:0 12px 40px rgba(26,26,46,.05)!important}.status{display:inline-flex!important;flex-direction:column!important;min-width:250px!important;margin:1rem 0 2rem!important;background:#fff!important;border:1px solid #e8e5e0!important;border-left:3px solid #c9a84c!important}.map{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:1rem!important}.mapstop{min-height:105px!important;background:#fff!important;border:1px solid #e8e5e0!important;border-radius:12px!important;text-align:left!important}.mapstop.current{border-color:#2d5a3d!important;box-shadow:0 6px 22px rgba(45,90,61,.10)!important}.vault{margin-top:2rem!important;background:#faf9f6!important;border:1px solid #e8e5e0!important;border-radius:12px!important;padding:1.2rem!important}.eyebrow{color:#2d5a3d!important}h1,h2,h3{color:#1a1a2e!important}@media(max-width:850px){.map{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:560px){.wrap{padding:1.5rem 1rem 3rem!important}.map{grid-template-columns:1fr!important}}
</style>`;

function radioChoices(name, options, required) {
  return options.map((option, i) => `<label class="choice"><input type="radio" name="${esc(name)}" value="${esc(option)}" ${required && i===0 ? 'required' : ''}><span>${esc(option)}</span></label>`).join('');
}

function checkChoices(name, options) {
  return options.map(option => `<label class="choice"><input type="checkbox" name="${esc(name)}" value="${esc(option)}"><span>${esc(option)}</span></label>`).join('');
}

function values(form, name) {
  return form.getAll(name).map(v => clean(v)).filter(Boolean);
}

function clean(value) {
  return String(value || '').trim().slice(0, 5000);
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function htmlHeaders() {
  return new Headers({
    'content-type':'text/html; charset=utf-8',
    'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
}

function page(body, status = 200) {
  return new Response(body, { status, headers: htmlHeaders() });
}

function redirect(location) {
  const headers = htmlHeaders();
  headers.set('location', location);
  return new Response(null, { status: 303, headers });
}
