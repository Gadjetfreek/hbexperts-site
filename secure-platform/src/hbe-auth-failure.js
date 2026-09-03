/**
 * Branded HBE Access failure pages. Presentation only — callers must still
 * fail closed via authenticateHbeProfessional() outcomes.
 */

const SAFE_RETURN_RE = /^\/hbe(?:\/[\w./-]*)?(?:\?[\w&=%.+-]*)?$/i;

export function safeHbeReturnPath(requestUrl) {
  try {
    const u = new URL(requestUrl);
    if (u.pathname !== '/hbe' && !u.pathname.startsWith('/hbe/')) return '/hbe';
    if (u.pathname.includes('..')) return '/hbe';
    const candidate = `${u.pathname}${u.search}`;
    if (candidate.length > 512) return '/hbe';
    if (/[\u0000-\u001f]/.test(candidate)) return '/hbe';
    if (/\/\/|https?:|javascript:|%2f|%3a/i.test(candidate)) return '/hbe';
    if (!SAFE_RETURN_RE.test(candidate.split('#')[0])) return '/hbe';
    return candidate.split('#')[0];
  } catch {
    return '/hbe';
  }
}

export function hbeAuthFailurePage({ kind, requestUrl, teamDomain = '' }) {
  const ret = safeHbeReturnPath(requestUrl);
  const encRet = encodeURIComponent(ret);
  const signInHref = teamDomain
    ? `${String(teamDomain).replace(/\/$/, '')}/cdn-cgi/access/login/${'buyer.hbexperts.com'}?redirect_url=${encRet}`
    : ret;
  const logoutHref = teamDomain
    ? `${String(teamDomain).replace(/\/$/, '')}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(`https://buyer.hbexperts.com${ret}`)}`
    : ret;

  const copy = {
    config: {
      title: 'HBE access is temporarily unavailable',
      lead: 'Your buyer data remains protected. Please retry in a moment or return to HBE.',
      primary: { label: 'Retry', href: ret },
      secondary: { label: 'Return to HBE', href: '/hbe' },
      code: 'HBE_ACCESS_CONFIG'
    },
    auth_required: {
      title: 'Your HBE session has ended',
      lead: 'Sign in again to continue where you left off.',
      primary: { label: 'Sign in to HBE', href: signInHref },
      secondary: { label: 'Return to HBE home', href: '/hbe' },
      code: 'HBE_ACCESS_AUTH'
    },
    unauthorized: {
      title: 'This account is not authorized for HBE',
      lead: 'Sign in with a different account, or return to HBE.',
      primary: { label: 'Sign in with a different account', href: logoutHref },
      secondary: { label: 'Return to HBE', href: '/hbe' },
      code: 'HBE_ACCESS_UNAUTHORIZED'
    },
    jwt_invalid: {
      title: 'We could not verify your HBE session',
      lead: 'Try signing in again. Your buyer data remains protected.',
      primary: { label: 'Try signing in again', href: signInHref },
      secondary: { label: 'Return to HBE', href: '/hbe' },
      code: 'HBE_ACCESS_JWT'
    }
  }[kind] || {
    title: 'HBE access required',
    lead: 'Your buyer data remains protected.',
    primary: { label: 'Return to HBE', href: '/hbe' },
    secondary: null,
    code: 'HBE_ACCESS_DENIED'
  };

  const secondary = copy.secondary
    ? `<p class="hbe-auth-secondary"><a class="btn ghost" href="${esc(copy.secondary.href)}">${esc(copy.secondary.label)}</a></p>`
    : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(copy.title)} | HomeBuyer Experts</title>
<style>
:root{color-scheme:light;--ink:#1a2332;--muted:#5b6575;--line:#d7dde7;--bg:#f6f8fb;--card:#fff;--accent:#1f4b7a;--accent-ink:#fff}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
.card{width:100%;max-width:28rem;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.75rem;box-shadow:0 8px 28px rgba(26,35,50,.06)}
.eyebrow{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 .75rem}
h1{font-size:1.45rem;line-height:1.25;margin:0 0 .75rem}
p{margin:0 0 1rem;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:3rem;padding:.75rem 1.1rem;border-radius:10px;font-weight:600;text-decoration:none;width:100%}
.btn.primary{background:var(--accent);color:var(--accent-ink)}
.btn.ghost{background:transparent;color:var(--accent);border:1px solid var(--line)}
.hbe-auth-secondary{margin-top:.75rem}
.code{margin-top:1.25rem;font-size:.7rem;color:#8a93a3}
</style></head><body><main class="wrap"><section class="card" role="alert">
<p class="eyebrow">HomeBuyer Experts · HBE Access</p>
<h1>${esc(copy.title)}</h1>
<p>${esc(copy.lead)}</p>
<p><a class="btn primary" href="${esc(copy.primary.href)}">${esc(copy.primary.label)}</a></p>
${secondary}
<p class="code" data-hbe-access-state="${esc(copy.code)}">${esc(copy.code)}</p>
</section></main></body></html>`;

  return new Response(html, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    }
  });
}

function esc(v = '') {
  return String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}
