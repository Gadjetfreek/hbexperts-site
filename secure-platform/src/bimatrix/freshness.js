import { assertMutationCsrf, caseIdForBuyer } from '../household-state.js';

const enc = new TextEncoder();
export const BIMATRIX_CANONICAL_UPDATED = 'September 1, 2026';

export const CURRENT_PROGRAM_SOURCES = [
  {
    source_id: 'eandc-akron-dreams',
    label: 'Akron Dreams',
    url: 'https://www.eandc.org/akrondreams',
    markers: ['akron dreams', '7,500']
  },
  {
    source_id: 'ohfa-dpa-lender-updates',
    label: 'OHFA Down Payment Assistance',
    url: 'https://www.ohiohome.org/partners/lenders.aspx',
    markers: ['down payment assistance', '3%', '3.5%']
  }
];

export function evaluateSourceText(source, status, text) {
  if (!(status >= 200 && status < 400)) {
    return { source_id: source.source_id, label: source.label, outcome: 'unavailable', http_status: status || 0 };
  }
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const missing = source.markers.filter(marker => !normalized.includes(marker.toLowerCase()));
  return {
    source_id: source.source_id,
    label: source.label,
    outcome: missing.length ? 'review_pending' : 'current',
    http_status: status,
    missing_markers: missing
  };
}

export function summarizeFreshness(results) {
  if (results.some(r => r.outcome === 'unavailable')) return 'unavailable';
  if (results.some(r => r.outcome === 'review_pending')) return 'review_pending';
  return 'current';
}

export async function handleBuyerBimatrixRefresh(request, env) {
  if (!env?.BUYER_DB) return unavailable();
  const auth = await getBuyerSession(request, env);
  if (!auth) return redirect('/login');

  const sessionToken = getCookie(request, 'hbe_session');
  const form = await request.formData();
  if (!await assertMutationCsrf(request, form.get('csrf'), sessionToken)) return forbidden('CSRF rejected.');

  const caseId = await caseIdForBuyer(env, auth.buyer.id);
  if (!caseId) return redirect('/portal');

  const recent = await env.BUYER_DB.prepare(`
    SELECT checked_at,result FROM bimatrix_freshness_checks
    WHERE case_id=? ORDER BY checked_at DESC LIMIT 1`).bind(caseId).first();
  if (recent?.checked_at && (Date.now() - Date.parse(recent.checked_at)) < 5 * 60 * 1000) {
    return redirect('/portal#possible-assistance');
  }

  const checkedAt = new Date().toISOString();
  const details = [];
  for (const source of CURRENT_PROGRAM_SOURCES) {
    try {
      const response = await fetch(source.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5',
          'User-Agent': 'HomeBuyer-Experts-BIMatrix-Freshness/1.0'
        }
      });
      const text = await response.text();
      details.push(evaluateSourceText(source, response.status, text));
    } catch (err) {
      details.push({ source_id: source.source_id, label: source.label, outcome: 'unavailable', http_status: 0, error: String(err?.message || 'fetch failed').slice(0, 240) });
    }
  }

  const result = summarizeFreshness(details);
  const id = crypto.randomUUID();
  await env.BUYER_DB.prepare(`
    INSERT INTO bimatrix_freshness_checks
      (id,case_id,requested_by_buyer_id,checked_at,result,details_json)
    VALUES (?,?,?,?,?,?)`).bind(
      id,
      caseId,
      auth.buyer.id,
      checkedAt,
      result,
      JSON.stringify(details)
    ).run();

  return redirect('/portal#possible-assistance');
}

export async function buyerBimatrixPanel(request, env, csrfField = '') {
  if (!env?.BUYER_DB) return renderBimatrixPanel({ csrfField });
  const auth = await getBuyerSession(request, env);
  if (!auth) return '';
  const caseId = await caseIdForBuyer(env, auth.buyer.id);
  let latest = null;
  if (caseId) {
    latest = await env.BUYER_DB.prepare(`
      SELECT checked_at,result FROM bimatrix_freshness_checks
      WHERE case_id=? ORDER BY checked_at DESC LIMIT 1`).bind(caseId).first();
  }
  return renderBimatrixPanel({ csrfField, latest });
}

export function renderBimatrixPanel({ csrfField = '', latest = null } = {}) {
  let status = '';
  if (latest?.result === 'current') {
    status = `<p class="bimatrix-check current">Current sources checked: <strong>${escapeHtml(formatTimestamp(latest.checked_at))}</strong> ✓</p>`;
  } else if (latest?.result === 'review_pending') {
    status = '<p class="bimatrix-check pending">New information found — HBE review pending</p>';
  } else if (latest?.result === 'unavailable') {
    status = '<p class="bimatrix-check pending">Some sources could not be verified — HBE review pending</p>';
  }

  return `<section class="bimatrix-panel" id="possible-assistance" aria-labelledby="bimatrix-title">
    <div class="bimatrix-head">
      <div>
        <p class="bimatrix-kicker">Possible Assistance</p>
        <h2 id="bimatrix-title">Buyer Incentive Matrix</h2>
        <p>Browse possible assistance without answering additional financial or eligibility questions. Final eligibility is determined by each program, lender, or administrator.</p>
      </div>
      <form method="post" action="/api/portal/bimatrix-refresh" class="bimatrix-update-form">
        ${csrfField}
        <span><strong>Last updated:</strong> ${BIMATRIX_CANONICAL_UPDATED}</span>
        <button type="submit">Update now</button>
      </form>
    </div>
    ${status}
    <div class="bimatrix-grid">
      <article class="bimatrix-card">
        <h3>Akron Dreams 2026</h3>
        <p><strong>Potential benefit:</strong> up to $7,500 in forgivable down-payment/closing-cost assistance.</p>
        <p><strong>General fit:</strong> first-time buyer, owner-occupied property inside Akron, plus published income, credit, financing, education, asset and property requirements.</p>
        <p class="bimatrix-tradeoff"><strong>Consider:</strong> five-year deed restriction, second-mortgage lien, buyer contribution and first-come funding.</p>
        <a href="https://www.eandc.org/akrondreams" target="_blank" rel="noopener noreferrer">More details</a>
      </article>
      <article class="bimatrix-card">
        <h3>OHFA Down Payment Assistance</h3>
        <p><strong>Potential benefit:</strong> 3% for conventional loans or 3.5% for FHA, VA and USDA government loans under current OHFA terms.</p>
        <p><strong>General fit:</strong> available through qualifying OHFA mortgage pathways, subject to income, purchase-price, credit, lender and program requirements.</p>
        <p class="bimatrix-tradeoff"><strong>Consider:</strong> assistance can affect mortgage pricing. Compare rate, payment, cash required, forgiveness/repayment and long-term cost.</p>
        <a href="https://www.ohiohome.org/partners/lenders.aspx" target="_blank" rel="noopener noreferrer">More details</a>
      </article>
    </div>
    <p class="bimatrix-optin"><strong>Want to see what you may qualify for?</strong> Eligibility screening will remain a separate, optional step and will reuse information HBE already has before asking anything new.</p>
  </section>`;
}

export const BIMATRIX_CSS = `<style id="issue33-bimatrix-css">
.bimatrix-panel{margin:1.25rem 0;padding:1.1rem;border:1px solid #d8d4ca;border-radius:14px;background:#fffdf8;color:#2c2c2c}
.bimatrix-head{display:flex;gap:1rem;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.bimatrix-kicker{margin:0 0 .15rem;text-transform:uppercase;letter-spacing:.08em;font-size:.74rem;font-weight:700;color:#2d5a3d}
.bimatrix-panel h2{margin:.1rem 0 .45rem;color:#1a1a2e}.bimatrix-panel h3{margin:.1rem 0 .45rem;color:#1a1a2e}
.bimatrix-update-form{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;padding:.65rem .75rem;border:1px solid #d8d4ca;border-radius:10px;background:#faf9f6}
.bimatrix-update-form button{border:0;border-radius:8px;background:#2d5a3d;color:#fff;padding:.58rem .8rem;font-weight:700;cursor:pointer}
.bimatrix-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.85rem;margin-top:.9rem}
.bimatrix-card{border:1px solid #e0ddd5;border-radius:12px;padding:.9rem;background:#fff}.bimatrix-card p{line-height:1.45}.bimatrix-card a{font-weight:700}
.bimatrix-tradeoff{background:#faf6eb;border-left:3px solid #9b7a32;padding:.55rem .65rem}
.bimatrix-check{margin:.75rem 0 0;padding:.55rem .7rem;border-radius:8px}.bimatrix-check.current{background:#eef7f0}.bimatrix-check.pending{background:#fff5dc}
.bimatrix-optin{margin:1rem 0 0;padding-top:.8rem;border-top:1px solid #e0ddd5}
@media(max-width:560px){.bimatrix-update-form{width:100%;justify-content:space-between}.bimatrix-update-form button{width:100%}}
</style>`;

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(date);
}

async function getBuyerSession(request, env) {
  const token = getCookie(request, 'hbe_session');
  if (!token) return null;
  const now = new Date().toISOString();
  const row = await env.BUYER_DB.prepare(`SELECT s.id AS session_id,s.buyer_id,s.expires_at,b.*
    FROM buyer_sessions s JOIN buyers b ON b.id=s.buyer_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token), now).first();
  if (!row) return null;
  return { session: { id: row.session_id, buyer_id: row.buyer_id }, buyer: row };
}

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function securityHeaders(contentType) {
  return new Headers({
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
}
function redirect(location) {
  const headers = securityHeaders('text/plain; charset=utf-8');
  headers.set('location', location);
  return new Response('', { status: 303, headers });
}
function forbidden(message) { return new Response(message, { status: 403, headers: securityHeaders('text/plain; charset=utf-8') }); }
function unavailable() { return new Response('Buyer database is not bound in this environment.', { status: 503, headers: securityHeaders('text/plain; charset=utf-8') }); }
