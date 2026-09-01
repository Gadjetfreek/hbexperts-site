import appWorker from './access-code-worker.js';

const STAGES = [
  ['buyerExperience','Buyer Experience'],['consultation','Consultation'],['representation','Hire HBE'],['search','Build Your Home Search'],['market','Learn the Market'],['possibilities','Discover Possibilities'],['evaluation','Evaluate Homes'],['offer','Ready to Offer?'],['terms','Build the Offer'],['negotiation','Negotiate Wisely'],['diligence','Learn What We Did Not Know'],['inspection','Inspection Decision'],['value','Value Check'],['loan','Final Financing'],['commitment','Final Decision'],['closing','Get the Keys'],['afterKeys','After the Keys']
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/hbe' && request.method === 'GET') {
      if (!isHbe(request, env)) return forbidden();
      return hbeDashboard(request, env, url);
    }

    if (url.pathname === '/api/hbe/task' && request.method === 'POST') {
      if (!isHbe(request, env)) return forbidden();
      return createTask(request, env);
    }

    if (/^\/api\/hbe\/task\/[^/]+\/toggle$/.test(url.pathname) && request.method === 'POST') {
      if (!isHbe(request, env)) return forbidden();
      return toggleTask(request, env, url);
    }

    if (url.pathname === '/api/hbe/note' && request.method === 'POST') {
      if (!isHbe(request, env)) return forbidden();
      return createNote(request, env);
    }

    if (/^\/api\/hbe\/buyer\/[^/]+\/stage$/.test(url.pathname) && request.method === 'POST') {
      if (!isHbe(request, env)) return forbidden();
      return updateStage(request, env, url);
    }

    return appWorker.fetch(request, env, ctx);
  }
};

async function hbeDashboard(request, env, url) {
  const buyerId = clean(url.searchParams.get('buyer'));
  const [buyerRows, taskRows, noteRows, notificationRows] = await Promise.all([
    env.BUYER_DB.prepare('SELECT id,created_at,submitted_at,updated_at,first_name,last_name,email,phone,stage,completed_stages,answers_json FROM buyers ORDER BY submitted_at DESC').all(),
    env.BUYER_DB.prepare("SELECT id,buyer_id,created_at,updated_at,title,due_at,priority,status,stage,visible_to_buyer FROM buyer_tasks ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, due_at ASC, created_at DESC").all(),
    env.BUYER_DB.prepare('SELECT id,buyer_id,created_at,author_email,visibility,body FROM buyer_notes ORDER BY created_at DESC').all(),
    env.BUYER_DB.prepare('SELECT id,buyer_id,type,created_at,read_at,payload_json FROM notifications ORDER BY created_at DESC LIMIT 100').all()
  ]);

  const buyers = buyerRows.results || [];
  const tasks = taskRows.results || [];
  const notes = noteRows.results || [];
  const notifications = notificationRows.results || [];
  const selected = buyers.find(b => b.id === buyerId) || buyers[0] || null;

  const body = dashboardHtml(buyers, selected, tasks, notes, notifications);
  return html(body);
}

async function createTask(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  const title = clean(form.get('title'));
  if (!buyerId || !title) return redirect('/hbe');
  const now = new Date().toISOString();
  await env.BUYER_DB.prepare(`INSERT INTO buyer_tasks (id,buyer_id,created_at,updated_at,title,due_at,priority,status,stage,visible_to_buyer) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), buyerId, now, now, title, clean(form.get('due_at')) || null, allowedPriority(form.get('priority')), 'open', clean(form.get('stage')) || null, form.get('visible_to_buyer') === 'yes' ? 1 : 0).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);
}

async function toggleTask(request, env, url) {
  const id = decodeURIComponent(url.pathname.match(/^\/api\/hbe\/task\/([^/]+)\/toggle$/)?.[1] || '');
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  const row = await env.BUYER_DB.prepare('SELECT status FROM buyer_tasks WHERE id=?').bind(id).first();
  if (row) {
    await env.BUYER_DB.prepare('UPDATE buyer_tasks SET status=?, updated_at=? WHERE id=?').bind(row.status === 'open' ? 'done' : 'open', new Date().toISOString(), id).run();
  }
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);
}

async function createNote(request, env) {
  const form = await request.formData();
  const buyerId = clean(form.get('buyer_id'));
  const body = clean(form.get('body'));
  if (!buyerId || !body) return redirect('/hbe');
  await env.BUYER_DB.prepare('INSERT INTO buyer_notes (id,buyer_id,created_at,author_email,visibility,body) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), buyerId, new Date().toISOString(), clean(request.headers.get('Cf-Access-Authenticated-User-Email')) || 'HBE', form.get('visibility') === 'buyer' ? 'buyer' : 'hbe', body).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);
}

async function updateStage(request, env, url) {
  const buyerId = decodeURIComponent(url.pathname.match(/^\/api\/hbe\/buyer\/([^/]+)\/stage$/)?.[1] || '');
  const form = await request.formData();
  const stage = clean(form.get('stage'));
  if (!STAGES.some(s => s[0] === stage) && stage !== 'complete') return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);
  const completed = stage === 'complete' ? STAGES.map(s => s[0]) : STAGES.slice(0, Math.max(0, STAGES.findIndex(s => s[0] === stage))).map(s => s[0]);
  await env.BUYER_DB.prepare('UPDATE buyers SET stage=?, completed_stages=?, updated_at=? WHERE id=?').bind(stage, JSON.stringify(completed), new Date().toISOString(), buyerId).run();
  return redirect(`/hbe?buyer=${encodeURIComponent(buyerId)}`);
}

function dashboardHtml(buyers, selected, tasks, notes, notifications) {
  const unreadByBuyer = Object.create(null);
  notifications.filter(n => !n.read_at).forEach(n => unreadByBuyer[n.buyer_id] = (unreadByBuyer[n.buyer_id] || 0) + 1);
  const openTasksByBuyer = Object.create(null);
  tasks.filter(t => t.status === 'open').forEach(t => (openTasksByBuyer[t.buyer_id] ||= []).push(t));

  const cards = buyers.map(b => {
    const bt = openTasksByBuyer[b.id] || [];
    const urgent = bt.filter(t => t.priority === 'critical' || isDueSoon(t.due_at)).length;
    return `<article class="i29-split-card ${selected?.id === b.id ? 'selected' : ''}">
      <header><div class="card-top"><span class="initials">${esc(initials(b))}</span>${unreadByBuyer[b.id] ? `<span class="badge">${unreadByBuyer[b.id]} new</span>` : ''}</div>
      <strong>${esc(b.first_name)} ${esc(b.last_name)}</strong>
      <small>${esc(stageLabel(b.stage))}</small>
      <div class="card-meta"><span>${bt.length} open task${bt.length === 1 ? '' : 's'}</span>${urgent ? `<span class="urgent">${urgent} date-critical</span>` : ''}</div></header>
      <a href="/hbe?buyer=${encodeURIComponent(b.id)}">HBE Dashboard<span>Workspace without leaving HBE</span></a>
      <a href="/hbe/preview?buyer=${encodeURIComponent(b.id)}">Buyer Dashboard<span>Preview buyer-facing UI</span></a>
    </article>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>HBE Workspace</title>${CSS}</head><body>
  <header class="site-header"><div class="header-inner"><a class="brand" href="https://hbexperts.com/">HomeBuyer Experts</a><div class="header-actions"><a href="/" target="_blank" rel="noopener">Buyer Journey</a><span>HBE Workspace</span></div></div></header>
  <main class="shell">
    <section class="top"><div><div class="eyebrow">HBE WORKSPACE</div><h1>What needs our attention?</h1><p>One shared buyer journey. HBE sees the work; buyers see the parts that help them choose wisely.</p></div>${priorityBubble(buyers, tasks)}</section>
    <section class="buyer-strip" aria-label="Active buyers">${cards || '<div class="empty">No submitted buyers yet.</div>'}</section>
    ${selected ? selectedBuyer(selected, tasks.filter(t => t.buyer_id === selected.id), notes.filter(n => n.buyer_id === selected.id), notifications.filter(n => n.buyer_id === selected.id)) : '<section class="empty main-empty">A submitted Buyer Experience will appear here.</section>'}
  </main></body></html>`;
}

function selectedBuyer(b, tasks, notes, notifications) {
  const answers = safeJson(b.answers_json);
  const stageIndex = STAGES.findIndex(s => s[0] === b.stage);
  const next = b.stage === 'complete' ? null : STAGES[Math.min(STAGES.length - 1, Math.max(0, stageIndex + 1))];
  const openTasks = tasks.filter(t => t.status === 'open');
  const dateCritical = openTasks.filter(t => t.due_at && (t.priority === 'critical' || isDueSoon(t.due_at))).sort(sortDue);
  const topTask = chooseTopTask(openTasks);
  return `<section class="buyer-main">
    <div class="buyer-heading"><div><div class="eyebrow">SELECTED BUYER</div><h2>${esc(b.first_name)} ${esc(b.last_name)}</h2><p><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? ` · <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : ''}${answers.co_buyer?.name ? ` · With ${esc(answers.co_buyer.name)}` : ''}</p></div><div class="stage-summary"><small>Current</small><strong>${esc(stageLabel(b.stage))}</strong>${next ? `<small>Next</small><strong>${esc(next[1])}</strong>` : ''}</div></div>
    ${dateCritical.length ? `<div class="critical-bar"><strong>Date-critical</strong>${dateCritical.slice(0,3).map(t => `<span>${esc(t.title)} · ${fmtDate(t.due_at)}</span>`).join('')}</div>` : ''}
    ${topTask ? `<div class="priority-task"><small>Highest priority right now</small><strong>${esc(topTask.title)}</strong>${topTask.due_at ? `<span>${fmtDate(topTask.due_at)}</span>` : ''}</div>` : ''}
    <div class="roadmap">${STAGES.map((s,i) => `<form method="post" action="/api/hbe/buyer/${encodeURIComponent(b.id)}/stage"><input type="hidden" name="stage" value="${s[0]}"><button class="stage ${s[0] === b.stage ? 'current' : i < stageIndex || b.stage === 'complete' ? 'done' : ''}" title="Set current stage to ${esc(s[1])}"><span>${i+1}</span><em>${esc(s[1])}</em></button></form>`).join('')}</div>
    <div class="workspace-grid">
      <div class="column">
        ${decisionProfile(answers)}
        ${experienceDetails(answers)}
      </div>
      <div class="column">
        ${taskPanel(b, tasks)}
        ${notesPanel(b, notes)}
      </div>
    </div>
  </section>`;
}

function decisionProfile(a) {
  const co = a.co_buyer;
  return `<article class="panel"><div class="panel-head"><div><div class="eyebrow">BUYER DECISION PROFILE</div><h3>How this buyer chooses</h3></div></div>
    <div class="profile-grid">
      ${profileItem('WHY', a.why)}${profileItem('Definition of success', a.success_definition)}${profileItem('Decision style', a.decision_style)}${profileItem('Information style', a.info_preference)}${profileItem('Uncertainty', a.uncertainty_style)}${profileItem('Under time pressure', a.offer_pressure)}${profileItem('Head vs. heart', a.head_heart)}${profileItem('Useful guidance', a.advisor_preference)}
    </div>
    ${co ? `<div class="co-buyer"><strong>Other buyer: ${esc(co.name)}</strong>${co.email ? ` · <a href="mailto:${esc(co.email)}">${esc(co.email)}</a>` : ''}${co.phone ? ` · ${esc(co.phone)}` : ''}</div>` : ''}
  </article>`;
}

function experienceDetails(a) {
  return `<article class="panel"><div class="eyebrow">WHAT MATTERS</div><h3>The life behind the purchase</h3>
    ${detail('Top priorities', arrayText(a.priorities))}${detail('Non-negotiables', a.non_negotiables)}${detail('Home should feel like', a.home_feeling)}${detail('Daily-life pace', a.lifestyle_pace)}${detail('Acceptable tradeoff', a.space_priority)}${detail('Timing', a.timeline)}${detail('Location', a.location)}${detail('Financing', a.financing)}${detail('Concerns', arrayText(a.concerns))}${detail('What they want to understand better', a.unknowns)}${detail('Saturday morning vision', a.saturday_morning_vision)}${detail('Consultation success', a.consultation_success)}
  </article>`;
}

function taskPanel(b, tasks) {
  const sorted = [...tasks].sort((a,z) => (a.status === z.status ? sortDue(a,z) : a.status === 'open' ? -1 : 1));
  return `<article class="panel"><div class="panel-head"><div><div class="eyebrow">WORK</div><h3>Tasks & deadlines</h3></div></div>
    <div class="task-list">${sorted.length ? sorted.map(t => `<div class="task ${t.status === 'done' ? 'done' : ''} ${t.priority === 'critical' ? 'critical' : ''}"><form method="post" action="/api/hbe/task/${encodeURIComponent(t.id)}/toggle"><input type="hidden" name="buyer_id" value="${esc(b.id)}"><button class="checkbtn" title="${t.status === 'open' ? 'Complete' : 'Reopen'}">${t.status === 'done' ? '✓' : '○'}</button></form><div><strong>${esc(t.title)}</strong><small>${t.due_at ? fmtDate(t.due_at) : 'No due date'} · ${esc(t.priority)}${t.visible_to_buyer ? ' · buyer-visible' : ''}</small></div></div>`).join('') : '<p class="muted">What’s Next is never empty — review the current-stage checklist or prepare next-stage evidence.</p>'}</div>
    <form class="composer" method="post" action="/api/hbe/task"><input type="hidden" name="buyer_id" value="${esc(b.id)}"><input name="title" placeholder="Add a task" required><div class="composer-row"><input type="date" name="due_at"><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select><select name="stage"><option value="">Any stage</option>${STAGES.map(s=>`<option value="${s[0]}">${esc(s[1])}</option>`).join('')}</select></div><label class="inline-check"><input type="checkbox" name="visible_to_buyer" value="yes"> Buyer can see this</label><button class="btn">Add task</button></form>
  </article>`;
}

function notesPanel(b, notes) {
  return `<article class="panel"><div class="eyebrow">NOTES & COMMUNICATION</div><h3>Keep the context with the buyer</h3>
    <div class="note-list">${notes.length ? notes.slice(0,12).map(n => `<div class="note"><div><strong>${n.visibility === 'buyer' ? 'Buyer-visible' : 'HBE only'}</strong><small>${fmtDateTime(n.created_at)}</small></div><p>${esc(n.body)}</p></div>`).join('') : '<p class="muted">No notes yet.</p>'}</div>
    <form class="composer" method="post" action="/api/hbe/note"><input type="hidden" name="buyer_id" value="${esc(b.id)}"><textarea name="body" placeholder="Add context, a decision note, or something to discuss..." required></textarea><select name="visibility"><option value="hbe">HBE only</option><option value="buyer">Buyer-visible</option></select><button class="btn">Add note</button></form>
  </article>`;
}

function priorityBubble(buyers, tasks) {
  const open = tasks.filter(t => t.status === 'open');
  const task = chooseTopTask(open);
  if (task) {
    const buyer = buyers.find(b => b.id === task.buyer_id);
    return `<a class="priority-bubble" href="/hbe?buyer=${encodeURIComponent(task.buyer_id)}"><small>Highest priority</small><strong>${esc(task.title)}</strong><span>${buyer ? `${esc(buyer.first_name)} ${esc(buyer.last_name)}` : ''}${task.due_at ? ` · ${fmtDate(task.due_at)}` : ''}</span></a>`;
  }
  const newest = buyers[0];
  return newest ? `<a class="priority-bubble" href="/hbe?buyer=${encodeURIComponent(newest.id)}"><small>Next useful action</small><strong>Review ${esc(newest.first_name)}’s Buyer Experience</strong><span>Turn answers into understanding</span></a>` : '';
}

function chooseTopTask(tasks) {
  return [...tasks].sort((a,b) => {
    const p = {critical:0,high:1,normal:2};
    if ((p[a.priority] ?? 3) !== (p[b.priority] ?? 3)) return (p[a.priority] ?? 3) - (p[b.priority] ?? 3);
    return sortDue(a,b);
  })[0] || null;
}
function sortDue(a,b){if(!a.due_at&&!b.due_at)return 0;if(!a.due_at)return 1;if(!b.due_at)return -1;return String(a.due_at).localeCompare(String(b.due_at))}
function isDueSoon(v){if(!v)return false;const d=new Date(v+'T23:59:59');return d.getTime()-Date.now() <= 3*86400000}
function allowedPriority(v){return ['normal','high','critical'].includes(String(v)) ? String(v) : 'normal'}
function stageLabel(id){return STAGES.find(s=>s[0]===id)?.[1] || (id==='complete'?'Journey complete':id)}
function profileItem(k,v){return v ? `<div class="profile-item"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>` : ''}
function detail(k,v){return v ? `<div class="detail"><strong>${esc(k)}</strong><p>${esc(v)}</p></div>` : ''}
function arrayText(v){return Array.isArray(v)?v.join(' · '):String(v||'')}
function initials(b){return `${String(b.first_name||'').slice(0,1)}${String(b.last_name||'').slice(0,1)}`.toUpperCase()}
function safeJson(v){try{return JSON.parse(v||'{}')}catch{return {}}}
function fmtDate(v){if(!v)return '';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v+'T12:00:00'))}catch{return v}}
function fmtDateTime(v){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v))}catch{return v}}
function clean(v){return String(v||'').trim().slice(0,5000)}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function isHbe(request,env){const email=clean(request.headers.get('Cf-Access-Authenticated-User-Email')).toLowerCase();return !!email && email === String(env.HBE_ADMIN_EMAIL||'').toLowerCase()}
function forbidden(){return new Response('HBE access required',{status:403,headers:securityHeaders()})}
function redirect(location){const h=securityHeaders();h.set('location',location);return new Response(null,{status:303,headers:h})}
function html(body){const h=securityHeaders();h.set('content-type','text/html; charset=utf-8');return new Response(body,{status:200,headers:h})}
function securityHeaders(){return new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})}

const CSS=`<style>
:root{--navy:#1a1a2e;--green:#2d5a3d;--green2:#3a7a52;--gold:#c9a84c;--text:#2c2c2c;--muted:#6b6b6b;--warm:#faf9f6;--section:#f5f3ef;--border:#e8e5e0;--red:#9b3434}*{box-sizing:border-box}body{margin:0;background:#f8f8f7;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.site-header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}.header-inner{max-width:1440px;margin:auto;padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center}.brand{font:700 1.3rem Georgia,serif;color:var(--navy);text-decoration:none}.header-actions{display:flex;gap:1rem;align-items:center;font-size:.9rem}.header-actions a{color:var(--green);text-decoration:none}.header-actions span{color:var(--muted)}.shell{max-width:1440px;margin:auto;padding:2rem 1.5rem 4rem}.top{display:flex;justify-content:space-between;gap:2rem;align-items:flex-start;margin-bottom:1.5rem}.eyebrow{color:var(--green);font-size:.74rem;letter-spacing:.14em;font-weight:800}.top h1{font:600 clamp(2rem,4vw,3rem)/1.05 Georgia,serif;color:var(--navy);margin:.35rem 0}.top p{color:var(--muted);margin:.3rem 0}.priority-bubble{display:flex;flex-direction:column;min-width:300px;max-width:440px;padding:1rem 1.15rem;border:1px solid var(--border);border-left:4px solid var(--gold);background:#fff;border-radius:12px;text-decoration:none;color:var(--text);box-shadow:0 4px 20px rgba(26,26,46,.04)}.priority-bubble small{color:var(--muted);text-transform:uppercase;font-weight:700}.priority-bubble strong{font:600 1.2rem Georgia,serif;color:var(--navy);margin:.15rem 0}.priority-bubble span{font-size:.88rem;color:var(--muted)}.buyer-strip{display:flex;gap:.9rem;overflow:auto;padding:.25rem 0 1.25rem}.buyer-card{flex:0 0 235px;display:block;background:#fff;border:1px solid var(--border);border-radius:12px;padding:1rem;color:var(--text);text-decoration:none;transition:.15s}.buyer-card:hover,.buyer-card.selected{border-color:var(--green);box-shadow:0 7px 24px rgba(45,90,61,.09);transform:translateY(-1px)}.card-top{display:flex;justify-content:space-between;align-items:center}.initials{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--green);color:#fff;font-weight:800;font-size:.8rem}.badge{font-size:.72rem;padding:.2rem .45rem;border-radius:999px;background:#edf6f0;color:var(--green);font-weight:800}.buyer-card>strong{display:block;font:600 1.08rem Georgia,serif;color:var(--navy);margin:.65rem 0 .1rem}.buyer-card>small{color:var(--muted)}.card-meta{display:flex;justify-content:space-between;gap:.5rem;margin-top:.7rem;font-size:.72rem;color:var(--muted)}.urgent{color:var(--red);font-weight:800}.buyer-main{background:#fff;border:1px solid var(--border);border-radius:16px;padding:clamp(1rem,2.5vw,2rem);box-shadow:0 12px 40px rgba(26,26,46,.04)}.buyer-heading{display:flex;justify-content:space-between;gap:2rem;align-items:flex-start}.buyer-heading h2{font:600 2.2rem Georgia,serif;color:var(--navy);margin:.25rem 0}.buyer-heading p{color:var(--muted)}.buyer-heading a{color:var(--green)}.stage-summary{display:grid;grid-template-columns:auto auto;gap:.2rem .7rem;align-items:baseline;background:var(--warm);padding:.8rem 1rem;border-radius:10px;border:1px solid var(--border)}.stage-summary small{color:var(--muted);text-transform:uppercase;font-size:.7rem;font-weight:700}.stage-summary strong{color:var(--navy)}.critical-bar{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;background:#fff5f5;border:1px solid #ead0d0;color:#6f2828;padding:.75rem 1rem;border-radius:10px;margin:1rem 0}.critical-bar span{font-size:.85rem}.priority-task{display:inline-flex;flex-direction:column;background:var(--warm);border-left:3px solid var(--gold);padding:.65rem .9rem;border-radius:8px;margin:.6rem 0 1rem}.priority-task small{color:var(--muted)}.priority-task strong{color:var(--navy)}.roadmap{display:flex;gap:.45rem;flex-wrap:wrap;padding:1.25rem 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:1rem 0 1.5rem}.roadmap form{margin:0}.stage{display:inline-flex;gap:.35rem;align-items:center;background:#f4f4f2;border:1px solid var(--border);border-radius:999px;padding:.38rem .65rem;color:var(--muted);cursor:pointer}.stage span{font-size:.72rem}.stage em{font-style:normal;font-size:.76rem}.stage.done{background:#edf4ef;color:var(--green)}.stage.current{background:var(--green);color:#fff;border-color:var(--green)}.workspace-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(330px,.8fr);gap:1.25rem}.column{display:grid;gap:1.25rem;align-content:start}.panel{border:1px solid var(--border);border-radius:12px;padding:1.25rem;background:#fff}.panel h3{font:600 1.45rem Georgia,serif;color:var(--navy);margin:.25rem 0 1rem}.profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.profile-item{padding:.75rem;background:var(--warm);border-radius:8px}.profile-item small{display:block;color:var(--muted);font-size:.72rem;text-transform:uppercase;font-weight:700}.profile-item strong{display:block;margin-top:.2rem;font-size:.92rem}.co-buyer{margin-top:1rem;padding:.75rem;border-top:1px solid var(--border);font-size:.9rem}.detail{border-top:1px solid var(--border);padding:.75rem 0}.detail:first-of-type{border-top:0}.detail strong{font-size:.85rem;color:var(--navy)}.detail p{margin:.2rem 0 0;color:var(--text)}.task-list,.note-list{display:grid;gap:.65rem}.task{display:grid;grid-template-columns:32px 1fr;gap:.5rem;align-items:start;padding:.65rem;background:var(--warm);border-radius:8px}.task.critical{border-left:3px solid var(--red)}.task.done{opacity:.55}.task.done strong{text-decoration:line-through}.task small{display:block;color:var(--muted);font-size:.77rem}.checkbtn{border:0;background:transparent;color:var(--green);font-size:1.3rem;cursor:pointer;padding:0}.note{padding:.75rem;background:var(--warm);border-radius:8px}.note>div{display:flex;justify-content:space-between;gap:.5rem}.note small{color:var(--muted)}.note p{margin:.35rem 0 0;white-space:pre-wrap}.composer{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)}.composer input,.composer textarea,.composer select{width:100%;padding:.7rem;border:1px solid var(--border);border-radius:7px;font:inherit;background:#fff}.composer textarea{min-height:90px;resize:vertical}.composer-row{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:.5rem;margin:.5rem 0}.inline-check{display:flex;gap:.45rem;align-items:center;font-size:.85rem;color:var(--muted);margin:.5rem 0}.inline-check input{width:auto}.btn{border:0;background:var(--green);color:#fff;border-radius:6px;padding:.65rem 1rem;font-weight:700;cursor:pointer}.muted,.empty{color:var(--muted)}.main-empty{background:#fff;border:1px solid var(--border);padding:2rem;border-radius:12px}@media(max-width:1000px){.workspace-grid{grid-template-columns:1fr}.top,.buyer-heading{display:block}.priority-bubble{margin-top:1rem;min-width:0}.stage-summary{margin-top:1rem;width:max-content}.profile-grid{grid-template-columns:1fr 1fr}}@media(max-width:620px){.shell{padding:1rem}.header-actions span{display:none}.profile-grid{grid-template-columns:1fr}.composer-row{grid-template-columns:1fr}.buyer-card{flex-basis:210px}.stage-summary{width:100%}.roadmap{gap:.35rem}.stage em{display:none}}
</style>`;
