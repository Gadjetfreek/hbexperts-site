import appWorker from './pilot-worker.js';

const OPTIONAL_REFLECTION_FIELDS = [
  'why',
  'success_definition',
  'decision_style',
  'info_preference',
  'uncertainty_style',
  'offer_pressure',
  'head_heart',
  'advisor_preference',
  'home_feeling',
  'lifestyle_pace',
  'space_priority',
  'consultation_success'
];

const OPTIONAL_RADIO_FIELDS = [
  'decision_style',
  'info_preference',
  'uncertainty_style',
  'offer_pressure',
  'head_heart',
  'advisor_preference',
  'home_feeling',
  'lifestyle_pace',
  'space_priority'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let downstreamRequest = request;
    let submittedBuyerExperience = null;

    if (request.method === 'POST' && url.pathname === '/api/intake') {
      submittedBuyerExperience = await request.clone().formData();
      downstreamRequest = makeOptionalReflectionCompatibleRequest(request, submittedBuyerExperience);
    }

    const response = await appWorker.fetch(downstreamRequest, env, ctx);

    if (
      submittedBuyerExperience &&
      response.status >= 200 &&
      response.status < 300
    ) {
      await restoreActualOptionalAnswers(env, submittedBuyerExperience);
    }

    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (!type.includes('text/html')) return response;

    let text = await response.text();

    if (
      (request.method === 'GET' && url.pathname === '/questionnaire') ||
      (request.method === 'POST' && url.pathname === '/api/intake' && response.status >= 400)
    ) {
      text = makeBuyerReflectionVoluntary(text);
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/questionnaire' || url.pathname === '/login')) {
      text = addValueContext(text);
    }

    if (request.method === 'GET' && url.pathname === '/portal' && response.status === 200) {
      text = addPortalValuePanel(text);
    }

    if (request.method === 'GET' && url.pathname === '/hbe' && response.status === 200) {
      text = addHbeValueStrip(text);
    }

    text = text.replace('</head>', `${VALUE_CSS}</head>`);
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }
};

function makeOptionalReflectionCompatibleRequest(request, originalForm) {
  const form = new FormData();
  originalForm.forEach((value, key) => form.append(key, value));

  for (const name of OPTIONAL_REFLECTION_FIELDS) {
    if (!clean(form.get(name))) form.set(name, 'Prefer not to answer');
  }

  const priorities = values(form, 'priorities');
  while (priorities.length < 3) {
    form.append('priorities', 'No additional priority selected');
    priorities.push('No additional priority selected');
  }

  if (values(form, 'concerns').length < 1) {
    form.append('concerns', 'Prefer not to answer');
  }

  const headers = new Headers(request.headers);
  headers.delete('content-type');
  headers.delete('content-length');

  return new Request(request.url, {
    method: 'POST',
    headers,
    body: form,
    redirect: 'manual'
  });
}

async function restoreActualOptionalAnswers(env, form) {
  const email = clean(form.get('email')).toLowerCase();
  if (!email || !env.BUYER_DB) return;

  try {
    const buyer = await env.BUYER_DB.prepare(
      'SELECT id, answers_json FROM buyers WHERE email=? ORDER BY submitted_at DESC LIMIT 1'
    ).bind(email).first();

    if (!buyer?.id) return;

    let answers = {};
    try {
      answers = JSON.parse(buyer.answers_json || '{}');
    } catch {
      answers = {};
    }

    answers.version = 'buyer-experience-2026-08-optional-reflections';
    for (const name of OPTIONAL_REFLECTION_FIELDS) {
      answers[name] = clean(form.get(name));
    }
    answers.priorities = values(form, 'priorities').slice(0, 3);
    answers.concerns = values(form, 'concerns');

    await env.BUYER_DB.prepare(
      'UPDATE buyers SET answers_json=?, updated_at=? WHERE id=?'
    ).bind(JSON.stringify(answers), new Date().toISOString(), buyer.id).run();
  } catch (err) {
    console.error('Optional Buyer Experience answer restore failed', err);
  }
}

function makeBuyerReflectionVoluntary(text) {
  text = text.replace(
    '<div class="privacy"><strong>Nothing is sent to HBE yet.</strong> Your draft stays only in this browser session until you deliberately press <strong>Submit to HBE</strong> at the end.</div>',
    '<div class="privacy"><strong>Nothing is sent to HBE yet.</strong> Your draft stays only in this browser session until you deliberately press <strong>Submit to HBE</strong> at the end.<br><br><strong>Reflective questions are optional.</strong> They can help HBE understand how to support your decision, but you may skip any of them or choose “Prefer not to answer.” Skipping them will not reduce the quality of representation or service you receive.</div>'
  );

  const labelReplacements = [
    ['What has you thinking about buying a home now? <span class="required">Required</span>', 'What has you thinking about buying a home now? <span class="hint">Optional — share only what feels useful.</span>'],
    ['Imagine it’s a year from now. What happened that made you say, “We made the right decision”? <span class="required">Required</span>', 'Imagine it’s a year from now. What happened that made you say, “We made the right decision”? <span class="hint">Optional</span>'],
    ['Choose your three highest priorities. <span class="required">Exactly 3 required</span>', 'Choose up to three priorities that matter most right now. <span class="hint">Optional — fewer is completely fine.</span>'],
    ['When making a major decision, which sounds most like you? <span class="required">Required</span>', 'When making a major decision, which sounds most like you? <span class="hint">Optional</span>'],
    ['How do you prefer important information? <span class="required">Required</span>', 'How do you prefer important information? <span class="hint">Optional</span>'],
    ['When important information is incomplete, what feels most natural? <span class="required">Required</span>', 'When important information is incomplete, what feels most natural? <span class="hint">Optional</span>'],
    ['You find a home you really like. There are three other offers and you have about 90 minutes to decide. What sounds most like you? <span class="required">Required</span>', 'You find a home you really like. There are three other offers and you have about 90 minutes to decide. What sounds most like you? <span class="hint">Optional</span>'],
    ['Two homes cost about the same. One checks 90% of your boxes but feels ordinary. The other checks 70%, but you immediately love being there. Where do you naturally lean? <span class="required">Required</span>', 'Two homes cost about the same. One checks 90% of your boxes but feels ordinary. The other checks 70%, but you immediately love being there. Where do you naturally lean? <span class="hint">Optional</span>'],
    ['What kind of guidance is most useful from HBE? <span class="required">Required</span>', 'What kind of guidance is most useful from HBE? <span class="hint">Optional</span>'],
    ['When you imagine walking into the right home, what is the first feeling you want? <span class="required">Required</span>', 'When you imagine walking into the right home, what is the first feeling you want? <span class="hint">Optional</span>'],
    ['Which description fits your daily life best? <span class="required">Required</span>', 'Which description fits your daily life best? <span class="hint">Optional</span>'],
    ['If you had to choose, which tradeoff feels most acceptable? <span class="required">Required</span>', 'If you had to choose, which tradeoff feels most acceptable? <span class="hint">Optional</span>'],
    ['What concerns you about the buying decision? <span class="required">Choose at least 1</span>', 'What concerns you about the buying decision? <span class="hint">Optional</span>'],
    ['If we only accomplish one thing during our consultation, what would make you leave feeling the time was well spent? <span class="required">Required</span>', 'If we only accomplish one thing during our consultation, what would make you leave feeling the time was well spent? <span class="hint">Optional</span>']
  ];

  for (const [before, after] of labelReplacements) text = text.replace(before, after);

  for (const name of OPTIONAL_REFLECTION_FIELDS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(`(<(?:input|textarea)[^>]*name="${escaped}"[^>]*?)\\srequired(?=[\\s>])`, 'g'),
      '$1'
    );
  }

  for (const name of OPTIONAL_RADIO_FIELDS) {
    text = addOptionalRadioChoice(text, name, 'Prefer not to answer');
  }

  text = text.replace(
    '<div class="priority-count" id="priorityCount">0 of 3 selected</div>',
    '<div class="priority-count" id="priorityCount">0 selected · choose up to 3 if helpful</div>'
  );

  text = text.replace(
    "function priorities(){const selected=[...form.querySelectorAll('[name=\"priorities\"]:checked')];priorityCount.textContent=selected.length+' of 3 selected';priorityCount.classList.toggle('good',selected.length===3);}",
    "function priorities(){const selected=[...form.querySelectorAll('[name=\"priorities\"]:checked')];priorityCount.textContent=selected.length+' selected · choose up to 3 if helpful';priorityCount.classList.toggle('good',selected.length>0);}" 
  );

  text = text.replace(
    "function validate(step){const priorityStep=step.querySelector('#priorityChoices');if(priorityStep&&form.querySelectorAll('[name=\"priorities\"]:checked').length!==3){priorityCount.textContent='Choose exactly 3 before continuing';priorityCount.classList.remove('good');return false;}const concernStep=step.querySelector('#concernChoices');if(concernStep&&form.querySelectorAll('[name=\"concerns\"]:checked').length<1){alert('Please choose at least one concern before continuing.');return false;}const fields=[...step.querySelectorAll('input,textarea,select')].filter(el=>!el.disabled);for(const el of fields){if(!el.checkValidity()){el.reportValidity();return false;}}return true;}",
    "function validate(step){const fields=[...step.querySelectorAll('input,textarea,select')].filter(el=>!el.disabled);for(const el of fields){if(!el.checkValidity()){el.reportValidity();return false;}}return true;}"
  );

  return text;
}

function addOptionalRadioChoice(text, name, label) {
  const token = `name="${name}"`;
  const pos = text.indexOf(token);
  if (pos < 0) return text;
  const start = text.lastIndexOf('<div class="choices">', pos);
  const end = text.indexOf('</div>', pos);
  if (start < 0 || end < 0) return text;
  if (text.slice(start, end).includes(`value="${label}"`)) return text;
  const option = `<label class="choice"><input type="radio" name="${name}" value="${label}"><span>${label}</span></label>`;
  return `${text.slice(0, end)}${option}${text.slice(end)}`;
}

function values(form, name) {
  return form.getAll(name).map(value => clean(value)).filter(Boolean);
}

function clean(value) {
  return String(value || '').trim().slice(0, 5000);
}

function addValueContext(text) {
  const line = '<div class="value-context"><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div>';
  if (text.includes('<main')) return text.replace(/(<main[^>]*>)/, `$1${line}`);
  return text.replace('<body>', `<body>${line}`);
}

function addPortalValuePanel(text) {
  const panel = `<section class="value-portal-panel"><div class="value-kicker">YOUR VALUE RECORD</div><h2>Price tells you what a home costs. VALUE helps you decide what that cost means to you.</h2><p><strong>Values · Alternatives · Learning · Uncertainty · Evidence</strong></p><p>This record is meant to evolve as you see homes, learn new facts, uncover uncertainty, and understand your own priorities more clearly. VALUE does not choose for you. It helps keep the choice visible.</p></section>`;
  return injectBeforeMainEnd(text, panel);
}

function addHbeValueStrip(text) {
  const panel = `<section class="value-hbe-strip"><div><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div><p>At consequential stages and after showings: what changed, what remains unknown, what alternatives remain, and what evidence should change our recommendation?</p></section>`;
  return injectBeforeMainEnd(text, panel);
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  if (i >= 0) return `${text.slice(0, i)}${panel}${text.slice(i)}`;
  return text.replace('</body>', `${panel}</body>`);
}

const VALUE_CSS = `<style id="value-system-language">
.value-context{max-width:1120px;margin:1rem auto 0;padding:.7rem 1rem;border:1px solid #e8e5e0;border-radius:10px;background:#faf9f6;display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap;color:#4b4b4b}.value-context strong,.value-kicker,.value-hbe-strip strong{color:#2d5a3d;letter-spacing:.1em}.value-context span{font-size:.86rem}.value-portal-panel{margin-top:1.5rem;padding:1.25rem;background:#fff;border:1px solid #e8e5e0;border-radius:12px}.value-portal-panel h2{margin:.25rem 0 .6rem;color:#1a1a2e;font-family:Georgia,serif;font-size:1.45rem}.value-portal-panel p{color:#555;line-height:1.6}.value-kicker{font-size:.72rem;font-weight:800}.value-hbe-strip{margin-top:1.25rem;padding:1rem 1.15rem;background:#faf9f6;border:1px solid #e8e5e0;border-radius:10px}.value-hbe-strip>div{display:flex;gap:.75rem;align-items:baseline;flex-wrap:wrap}.value-hbe-strip span{font-size:.82rem;color:#666}.value-hbe-strip p{margin:.5rem 0 0;color:#555;line-height:1.5;font-size:.9rem}@media(max-width:600px){.value-context,.value-hbe-strip{margin-left:.75rem;margin-right:.75rem}.value-portal-panel h2{font-size:1.25rem}}
</style>`;