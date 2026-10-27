// Owner-only "Build buyer's journey" drafts for HBEUI.
// Never log answers or story text: only event names and error codes.
import { STAGES, STAGE_CHECKLISTS } from './journey-stages.js';
import { requireOwner } from './hbe-push.js';

export const JOURNEY_PATH = '/api/hbe/journey';
export const JOURNEY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const ORIGIN = 'https://buyer.hbexperts.com';
const MAX_BODY = 20000;
const PER_BUYER_COOLDOWN_MS = 20000;
const HOURLY_LIMIT = 20;

const FIELDS = [
  ['why', 'Why they are considering a home'], ['success_definition', 'Definition of success'],
  ['decision_style', 'Decision style'], ['info_preference', 'Information style'],
  ['uncertainty_style', 'How they handle uncertainty'], ['offer_pressure', 'Under time pressure'],
  ['head_heart', 'Head vs. heart'], ['advisor_preference', 'Guidance they find useful'],
  ['priorities', 'Top priorities'], ['non_negotiables', 'Non-negotiables'],
  ['home_feeling', 'Home should feel like'], ['lifestyle_pace', 'Daily-life pace'],
  ['space_priority', 'Acceptable tradeoff'], ['timeline', 'Timing'], ['location', 'Location'],
  ['financing', 'Financing'], ['concerns', 'Concerns'], ['unknowns', 'What they want to understand better'],
  ['saturday_morning_vision', 'Saturday morning vision'], ['consultation_success', 'What would make the consultation a success']
];
const STYLE_KEYS = ['decision_style', 'info_preference', 'uncertainty_style', 'offer_pressure', 'head_heart', 'advisor_preference'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (v, n = 1200) => String(Array.isArray(v) ? v.join(', ') : (v ?? '')).replace(/\s+/g, ' ').trim().slice(0, n);
const lc = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const trimDot = s => s.replace(/[.\s]+$/, '');

export function journeyFacts(buyer) {
  let a = {}; try { a = JSON.parse(buyer.answers_json || '{}') || {}; } catch {}
  let done = []; try { const p = JSON.parse(buyer.completed_stages || '[]'); if (Array.isArray(p)) done = p; } catch {}
  const answers = FIELDS.map(([k, label]) => ({ key: k, label, value: clean(a[k]) })).filter(x => x.value);
  const coBuyer = a.co_buyer && a.co_buyer.name ? clean(a.co_buyer.name, 80) : '';
  const idx = buyer.stage === 'complete' ? STAGES.length : Math.max(0, STAGES.findIndex(s => s[0] === buyer.stage));
  const stage = (s, i) => ({ id: s[0], number: i + 1, title: s[1], promise: s[2], steps: s[3] || [], checklist: (STAGE_CHECKLISTS[s[0]] || []).map(c => c.title) });
  return {
    firstName: clean(buyer.first_name, 60) || 'This buyer', coBuyer, answers,
    past: STAGES.slice(0, idx).map(stage).filter(s => buyer.stage === 'complete' || done.includes(s.id) || s.number <= idx),
    current: idx < STAGES.length ? stage(STAGES[idx], idx) : null,
    ahead: STAGES.slice(idx + 1).map((s, j) => stage(s, idx + 1 + j)),
    stageId: buyer.stage || STAGES[0][0]
  };
}

export function templateJourney(f) {
  const get = k => f.answers.find(x => x.key === k)?.value || '';
  const who = f.coBuyer ? `${f.firstName} (deciding together with ${f.coBuyer})` : f.firstName;
  const out = [];
  const story = [];
  story.push(get('why') ? `${who} is considering a home because ${lc(trimDot(get('why')))}.` : `${who} has started the HBE Buyer Experience; their reason for buying was not shared yet.`);
  if (get('success_definition')) story.push(`Success, in their words, looks like this: ${trimDot(get('success_definition'))}.`);
  if (get('home_feeling')) story.push(`They want home to feel ${lc(trimDot(get('home_feeling')))}.`);
  if (get('saturday_morning_vision')) story.push(`They picture a Saturday morning like this: ${trimDot(get('saturday_morning_vision'))}.`);
  const pri = ['priorities', 'non_negotiables', 'location', 'timeline'].map(k => get(k) && `${FIELDS.find(x => x[0] === k)[1].toLowerCase()}: ${trimDot(get(k))}`).filter(Boolean);
  if (pri.length) story.push(`What they have named so far — ${pri.join('; ')}.`);
  out.push('Their story', story.join(' '), '');
  const style = STYLE_KEYS.map(k => f.answers.find(x => x.key === k)).filter(Boolean);
  out.push('Based on their style', style.length ? style.map(x => `• ${x.label}: ${trimDot(x.value)}.`).join('\n') + '\nGuide them the way they described above, and confirm anything not yet covered in conversation.' : 'They have not yet described how they make decisions or like to receive information. Ask about this in conversation rather than assuming.', '');
  if (f.past.length) out.push('Where they have been', f.past.map(s => `• ${s.title}: they completed this stage — ${lc(trimDot(s.promise))}.`).join('\n'), '');
  if (f.current) out.push('Where they are now', `${f.firstName} is in Stage ${f.current.number}, ${f.current.title}. Right now the focus is to ${lc(trimDot(f.current.promise))}.` + (f.current.checklist.length ? ` What this stage asks for: ${f.current.checklist.join('; ')}.` : ''), '');
  else out.push('Where they are now', `${f.firstName} has completed all ${STAGES.length} stages of the journey.`, '');
  if (f.ahead.length) {
    const concerns = get('concerns'), unknowns = get('unknowns'), fin = get('financing'), pressure = get('offer_pressure');
    const hurdles = [concerns && `their stated concerns (${trimDot(concerns)}) will need attention`, unknowns && `they will want clarity on ${lc(trimDot(unknowns))}`, fin && `financing (${trimDot(fin)}) will shape what is possible`, pressure && `when an offer moment arrives, they will lean on how they described handling pressure: ${lc(trimDot(pressure))}`].filter(Boolean);
    out.push("What's ahead", f.ahead.slice(0, 4).map(s => `• Stage ${s.number}, ${s.title}: they will ${lc(trimDot(s.promise))}.`).join('\n') + (f.ahead.length > 4 ? `\n• After that, ${f.ahead.length - 4} more stages will carry them through to ${f.ahead[f.ahead.length - 1].title}.` : '') + '\n' + (hurdles.length ? `Likely hurdles: ${hurdles.join('; ')}.` : 'Likely hurdles have not surfaced in their answers yet; they will become clearer in consultation.'));
  }
  return out.join('\n').trim();
}

export function journeyPrompt(f) {
  const lines = f.answers.map(x => `- ${x.label}: ${x.value}`).join('\n') || '- (no answers provided)';
  const st = s => `Stage ${s.number} ${s.title}: ${s.promise}. Checklist: ${s.checklist.join('; ') || s.steps.join(' ')}`;
  return [
    { role: 'system', content: "You write private planning notes for a buyer's real-estate advisor. Warm, professional, plain language. Use ONLY facts in the buyer answers; never invent names, numbers, places, family members, jobs, or preferences. Where something is unknown, say it has not been shared yet. Output plain text with exactly these headings on their own lines, in order: Their story / Based on their style / Where they have been (omit if no past stages) / Where they are now / What's ahead. Their story: 1-2 narrative paragraphs about who they are and what they want. Based on their style: how they decide, communicate, and what matters, inferred only from their answers. Where they have been: past tense. Where they are now: present tense for the current stage. What's ahead: future tense, upcoming stages and likely hurdles drawn from their answers. Under 600 words. No markdown symbols other than '•' bullets." },
    { role: 'user', content: `Buyer first name: ${f.firstName}${f.coBuyer ? `\nDeciding together with: ${f.coBuyer}` : ''}\nBuyer answers:\n${lines}\nPast stages:\n${f.past.map(st).join('\n') || '(none)'}\nCurrent stage:\n${f.current ? st(f.current) : 'Journey complete'}\nUpcoming stages:\n${f.ahead.map(st).join('\n') || '(none)'}` }
  ];
}

export async function generateJourney(env, f, { timeoutMs = 25000 } = {}) {
  if (env.AI && typeof env.AI.run === 'function') {
    try {
      const r = await Promise.race([env.AI.run(JOURNEY_MODEL, { messages: journeyPrompt(f), max_tokens: 1100, temperature: 0.4 }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
      const text = String(r?.response ?? '').trim();
      if (text.length > 200 && /Where they are now/i.test(text)) return { body: text.slice(0, MAX_BODY), source: 'ai', model: JOURNEY_MODEL };
      console.log(JSON.stringify({ event: 'journey_ai_unusable' }));
    } catch (e) { console.log(JSON.stringify({ event: 'journey_ai_failed', error_code: String(e?.message || 'error').slice(0, 40).replace(/[^\w :-]/g, '') })); }
  }
  return { body: templateJourney(f), source: 'template', model: null };
}

export async function handleJourney(request, env, url, opts = {}) {
  const owner = await requireOwner(request, env, opts);
  if (!owner.ok) return owner.response;
  const db = env.BUYER_DB;
  if (request.method === 'GET') {
    const id = clean(url.searchParams.get('buyer'), 100);
    if (!id) return json({ ok: false, error: 'buyer_required' }, 400);
    const row = await db.prepare('SELECT buyer_id,body,source,model,stage_at_generation,generated_at,edited_at FROM hbe_buyer_journeys WHERE buyer_id=?').bind(id).first();
    return json({ ok: true, journey: row ? { ...row, stage_label: stageTitle(row.stage_at_generation) } : null });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (request.headers.get('origin') !== ORIGIN) return json({ ok: false, error: 'bad_origin' }, 403);
  let input; try { input = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  const id = clean(input?.buyer, 100);
  if (!id) return json({ ok: false, error: 'buyer_required' }, 400);
  const now = new Date();
  if (input.action === 'save') {
    const body = String(input.body ?? '').slice(0, MAX_BODY);
    const r = await db.prepare("UPDATE hbe_buyer_journeys SET body=?,source=CASE WHEN source LIKE '%edited' THEN source ELSE source||'+edited' END,edited_at=? WHERE buyer_id=?").bind(body, now.toISOString(), id).run();
    if (!r?.meta?.changes) return json({ ok: false, error: 'not_found' }, 404);
    return handleJourney(new Request(`${ORIGIN}${JOURNEY_PATH}?buyer=${encodeURIComponent(id)}`, { headers: request.headers }), env, new URL(`${ORIGIN}${JOURNEY_PATH}?buyer=${encodeURIComponent(id)}`), opts);
  }
  if (input.action !== 'generate') return json({ ok: false, error: 'bad_action' }, 400);
  const buyer = await db.prepare('SELECT id,first_name,stage,completed_stages,answers_json FROM buyers WHERE id=?').bind(id).first();
  if (!buyer) return json({ ok: false, error: 'not_found' }, 404);
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  const recent = await db.prepare('SELECT COUNT(*) AS n, MAX(CASE WHEN buyer_id=? THEN created_at END) AS last FROM hbe_buyer_journey_generations WHERE created_at>?').bind(id, hourAgo).first();
  if (Number(recent?.n || 0) >= HOURLY_LIMIT) return json({ ok: false, error: 'rate_limited', retry_after_s: 600 }, 429);
  if (recent?.last && now.getTime() - Date.parse(recent.last) < PER_BUYER_COOLDOWN_MS) return json({ ok: false, error: 'rate_limited', retry_after_s: 20 }, 429);
  await db.prepare('INSERT INTO hbe_buyer_journey_generations (buyer_id,created_at) VALUES (?,?)').bind(id, now.toISOString()).run();
  const f = journeyFacts(buyer);
  const g = await generateJourney(env, f, opts);
  await db.prepare(`INSERT INTO hbe_buyer_journeys (buyer_id,body,source,model,stage_at_generation,generated_at,edited_at,created_by) VALUES (?,?,?,?,?,?,NULL,?)
    ON CONFLICT(buyer_id) DO UPDATE SET body=excluded.body,source=excluded.source,model=excluded.model,stage_at_generation=excluded.stage_at_generation,generated_at=excluded.generated_at,edited_at=NULL,created_by=excluded.created_by`)
    .bind(id, g.body, g.source, g.model, f.stageId, now.toISOString(), owner.email).run();
  console.log(JSON.stringify({ event: 'journey_generated', source: g.source }));
  return json({ ok: true, journey: { buyer_id: id, body: g.body, source: g.source, model: g.model, stage_at_generation: f.stageId, stage_label: stageTitle(f.stageId), generated_at: now.toISOString(), edited_at: null } });
}

function stageTitle(id) {
  if (id === 'complete') return 'Journey complete';
  const i = STAGES.findIndex(s => s[0] === id);
  return i < 0 ? String(id || '') : `Stage ${i + 1} · ${STAGES[i][1]}`;
}

// Panel rendered directly below the buyer's answers in HBEUI. Owner-only page; draft is never shown to buyers.
export function journeyPanelHtml(buyerId) {
  const b = JSON.stringify(String(buyerId || '')).replace(/</g, '\\u003c');
  return `<article class="panel" id="hbe-journey"><div class="panel-head"><div><div class="eyebrow">PRIVATE DRAFT · NOT VISIBLE TO BUYER</div><h3>Buyer's journey</h3></div></div>
<p><button type="button" id="journey-build">Build buyer's journey</button> <button type="button" id="journey-copy" hidden>Copy</button> <button type="button" id="journey-save" hidden>Save edits</button></p>
<p id="journey-meta" role="status" aria-live="polite"><small>Turns this buyer's answers and current stage into a story draft you can edit.</small></p>
<textarea id="journey-body" hidden rows="18" style="width:100%;font:inherit;line-height:1.5;padding:.7rem;border:1px solid #e8e5e0;border-radius:10px"></textarea>
<script>(()=>{const buyer=${b};const $=i=>document.getElementById(i);const build=$('journey-build'),copy=$('journey-copy'),save=$('journey-save'),meta=$('journey-meta'),body=$('journey-body');
const fmt=v=>{try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v))}catch{return v}};
const show=j=>{if(!j){return}body.hidden=false;copy.hidden=false;save.hidden=false;body.value=j.body||'';build.textContent="Regenerate buyer's journey";meta.textContent='Generated '+fmt(j.generated_at)+' at '+(j.stage_label||j.stage_at_generation)+' · '+(String(j.source).startsWith('ai')?'AI draft':'template draft')+(j.edited_at?' · edited '+fmt(j.edited_at):'');};
const call=async(o)=>{const r=await fetch('${JOURNEY_PATH}',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({buyer},o))});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||('HTTP '+r.status));return d.journey;};
fetch('${JOURNEY_PATH}?buyer='+encodeURIComponent(buyer),{credentials:'same-origin'}).then(r=>r.json()).then(d=>d&&d.ok&&show(d.journey)).catch(()=>{});
build.addEventListener('click',async()=>{if(!body.hidden&&body.value&&!confirm('Replace the current draft with a new one?'))return;build.disabled=true;meta.textContent='Building… this can take up to 30 seconds.';try{show(await call({action:'generate'}))}catch(e){meta.textContent=e.message==='rate_limited'?'Please wait a moment before regenerating.':'Could not build the journey ('+e.message+').'}finally{build.disabled=false}});
save.addEventListener('click',async()=>{save.disabled=true;try{show(await call({action:'save',body:body.value}))}catch(e){meta.textContent='Could not save ('+e.message+').'}finally{save.disabled=false}});
copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(body.value);copy.textContent='Copied'}catch{body.select();document.execCommand('copy');copy.textContent='Copied'}setTimeout(()=>copy.textContent='Copy',1500)});})();</script>
</article>`;
}
