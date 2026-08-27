import hbeWorker from './hbe-worker.js';

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await hbeWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (!type.includes('text/html')) return response;

    let text = await response.text();
    text = addHeaderPortalNav(text);

    if (request.method === 'GET' && url.pathname === '/portal' && response.status === 200) {
      try {
        const buyerId = await sessionBuyerId(request, env);
        if (buyerId) {
          const [tasksResult, notesResult] = await Promise.all([
            env.BUYER_DB.prepare("SELECT title,due_at,priority,status,stage FROM buyer_tasks WHERE buyer_id=? AND visible_to_buyer=1 AND status='open' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, due_at ASC, created_at DESC").bind(buyerId).all(),
            env.BUYER_DB.prepare("SELECT created_at,body FROM buyer_notes WHERE buyer_id=? AND visibility='buyer' ORDER BY created_at DESC LIMIT 8").bind(buyerId).all()
          ]);

          const tasks = tasksResult.results || [];
          const notes = notesResult.results || [];
          if (tasks.length || notes.length) {
            const panel = portalPanel(tasks, notes);
            const marker = '</section>';
            const index = text.lastIndexOf(marker);
            if (index >= 0) text = `${text.slice(0,index)}${panel}${text.slice(index)}`;
            else text = text.replace('</main>', `${panel}</main>`);
          }
        }
      } catch (err) {
        console.error('Buyer Portal HBE sync failed', err);
      }
    }

    text = text.replace('</head>', `${HEADER_NAV_CSS}${url.pathname === '/portal' ? PORTAL_SYNC_CSS : ''}</head>`);
    return new Response(text,{status:response.status,statusText:response.statusText,headers});
  }
};

function addHeaderPortalNav(text) {
  const nav = '<nav class="portal-header-nav" aria-label="Portal navigation"><a href="/portal">Buyer Portal</a></nav>';
  text = text.replace('<span class="context">Buyer Journey</span>', nav);
  text = text.replace('<span class="secure-site-context">Buyer Journey</span>', nav);
  return text;
}

async function sessionBuyerId(request, env) {
  const token = getCookie(request,'hbe_session');
  if (!token) return null;
  const row = await env.BUYER_DB.prepare('SELECT buyer_id FROM buyer_sessions WHERE token_hash=? AND expires_at>? LIMIT 1').bind(await sha256(token),new Date().toISOString()).first();
  return row?.buyer_id || null;
}

function portalPanel(tasks, notes) {
  return `<div class="from-hbe"><div class="from-hbe-head"><div><div class="portal-eyebrow">FROM YOUR HBE TEAM</div><h2>Things worth keeping in view</h2></div></div>
    ${tasks.length ? `<div class="portal-task-list">${tasks.map(t=>`<div class="portal-task ${t.priority==='critical'?'critical':''}"><span class="portal-dot"></span><div><strong>${esc(t.title)}</strong><small>${t.due_at?fmtDate(t.due_at):'No date attached'}${t.stage?` · ${esc(stageLabel(t.stage))}`:''}</small></div></div>`).join('')}</div>` : ''}
    ${notes.length ? `<div class="portal-notes">${notes.map(n=>`<div class="portal-note"><small>${fmtDateTime(n.created_at)}</small><p>${esc(n.body)}</p></div>`).join('')}</div>` : ''}
  </div>`;
}

function stageLabel(id){const map={buyerExperience:'Buyer Experience',consultation:'Consultation',representation:'Hire HBE',search:'Build Your Home Search',market:'Learn the Market',possibilities:'Discover Possibilities',evaluation:'Evaluate Homes',offer:'Ready to Offer?',terms:'Build the Offer',negotiation:'Negotiate Wisely',diligence:'Learn What We Did Not Know',inspection:'Inspection Decision',value:'Value Check',loan:'Final Financing',commitment:'Final Decision',closing:'Get the Keys'};return map[id]||id}
function fmtDate(v){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(v+'T12:00:00'))}catch{return v}}
function fmtDateTime(v){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(v))}catch{return v}}
function getCookie(request,name){const raw=request.headers.get('cookie')||'';for(const part of raw.split(';')){const[k,...rest]=part.trim().split('=');if(k===name)return decodeURIComponent(rest.join('='))}return null}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',enc.encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}

const HEADER_NAV_CSS=`<style id="portal-header-nav-style">.portal-header-nav{display:flex;align-items:center;gap:1.15rem;font-size:.9rem;font-weight:600}.portal-header-nav a{color:#2d5a3d;text-decoration:none}.portal-header-nav a:hover,.portal-header-nav a:focus{text-decoration:underline;text-underline-offset:3px}@media(max-width:520px){.portal-header-nav{gap:.65rem;font-size:.78rem}}</style>`;
const PORTAL_SYNC_CSS=`<style id="hbe-portal-sync">.from-hbe{margin-top:2rem;padding:1.25rem;background:#faf9f6;border:1px solid #e8e5e0;border-radius:12px}.from-hbe h2{font:600 1.45rem Georgia,serif;color:#1a1a2e;margin:.25rem 0 1rem}.portal-eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.13em;color:#2d5a3d}.portal-task-list,.portal-notes{display:grid;gap:.65rem}.portal-task{display:grid;grid-template-columns:14px 1fr;gap:.6rem;align-items:start;background:#fff;border:1px solid #e8e5e0;border-radius:8px;padding:.75rem}.portal-task.critical{border-left:3px solid #9b3434}.portal-dot{width:9px;height:9px;border-radius:50%;background:#2d5a3d;margin-top:.4rem}.portal-task strong{display:block;color:#1a1a2e}.portal-task small{display:block;color:#6b6b6b;margin-top:.15rem}.portal-notes{margin-top:1rem}.portal-note{padding:.75rem;border-top:1px solid #e8e5e0}.portal-note:first-child{border-top:0}.portal-note small{color:#6b6b6b}.portal-note p{margin:.2rem 0 0;white-space:pre-wrap}</style>`;
