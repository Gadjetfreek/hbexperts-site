import portalWorker from './portal-worker.js';

const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/intake') {
      const copy = request.clone();
      const form = await copy.formData();
      const email = clean(form.get('email')).toLowerCase();

      const response = await portalWorker.fetch(request, env, ctx);
      if (response.status < 200 || response.status >= 300 || !email) {
        return rewriteCodeFormat(response);
      }

      const headers = new Headers(response.headers);
      const type = headers.get('content-type') || '';
      if (!type.includes('text/html')) return response;

      try {
        const buyer = await env.BUYER_DB.prepare(
          'SELECT id FROM buyers WHERE email=? ORDER BY submitted_at DESC LIMIT 1'
        ).bind(email).first();

        if (!buyer?.id) return rewriteCodeFormat(response);

        const code = readableAccessCode();
        const hash = await sha256(`${email}:${normalizeAccessCode(code)}`);
        await env.BUYER_DB.prepare(
          'UPDATE buyers SET access_code_hash=?, updated_at=? WHERE id=?'
        ).bind(hash, new Date().toISOString(), buyer.id).run();

        let text = await response.text();
        text = text.replace(
          /(<div class="code"><small>Your cross-device access code<\/small><strong>)([^<]+)(<\/strong>)/,
          `$1${code}$3`
        );
        text = text.replaceAll('XXXX-XXXX-XXXX-XXXX', 'XXXX-XXXX');

        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch (err) {
        console.error('Short access-code update failed', err);
        return rewriteCodeFormat(response);
      }
    }

    return rewriteCodeFormat(await portalWorker.fetch(request, env, ctx));
  }
};

async function rewriteCodeFormat(response) {
  const headers = new Headers(response.headers);
  const type = headers.get('content-type') || '';
  if (!type.includes('text/html')) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  let text = await response.text();
  text = text.replaceAll('XXXX-XXXX-XXXX-XXXX', 'XXXX-XXXX');
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function readableAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const raw = Array.from(bytes, b => alphabet[b & 31]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function normalizeAccessCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clean(value) {
  return String(value || '').trim().slice(0, 5000);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
