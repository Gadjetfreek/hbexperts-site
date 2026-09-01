import appWorker from './issue29-production-worker.js';
import { mutationCsrfToken } from './household-state.js';
import { BIMATRIX_CSS, buyerBimatrixPanel, handleBuyerBimatrixRefresh } from './bimatrix/freshness.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/portal/bimatrix-refresh') {
      return handleBuyerBimatrixRefresh(request, env);
    }

    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (request.method === 'GET' && url.pathname === '/health' && type.includes('application/json')) {
      try {
        const body = await response.json();
        body.issue33 = { bimatrix: true, buyer_refresh: true, canonical_review: 'monthly' };
        return new Response(JSON.stringify(body), { status: response.status, headers });
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
