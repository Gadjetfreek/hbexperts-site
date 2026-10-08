const NONCE_COOKIE = 'hbe_submission_nonce';
const NONCE_TTL_SECONDS = 30 * 60;
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;

export const GOOGLE_ADS_CONVERSION_FRAME_URL = 'https://hbexperts.com/google-ads-conversion/';

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function nonceCookie(value, maxAge) {
  return `${NONCE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export async function ensureGoogleAdsSubmissionNonce(request, env, headers, now = new Date()) {
  const existing = getCookie(request, NONCE_COOKIE);
  if (NONCE_RE.test(existing)) return false;

  const nonce = randomNonce();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000).toISOString();
  const nonceHash = await sha256Hex(nonce);

  await env.BUYER_DB.batch([
    env.BUYER_DB.prepare('DELETE FROM google_ads_conversion_nonces WHERE expires_at < ?').bind(issuedAt),
    env.BUYER_DB.prepare(`INSERT INTO google_ads_conversion_nonces
      (nonce_hash, issued_at, expires_at, converted_at) VALUES (?, ?, ?, NULL)`).bind(nonceHash, issuedAt, expiresAt)
  ]);
  headers.append('set-cookie', nonceCookie(nonce, NONCE_TTL_SECONDS));
  return true;
}

export async function claimGoogleAdsSubmissionConversion(request, env, headers, now = new Date()) {
  const nonce = getCookie(request, NONCE_COOKIE);
  if (!NONCE_RE.test(nonce)) {
    headers.append('set-cookie', nonceCookie('', 0));
    return false;
  }

  const nonceHash = await sha256Hex(nonce);
  const claimedAt = now.toISOString();
  const result = await env.BUYER_DB.prepare(`UPDATE google_ads_conversion_nonces
    SET converted_at = ?
    WHERE nonce_hash = ? AND converted_at IS NULL AND expires_at >= ?`)
    .bind(claimedAt, nonceHash, claimedAt)
    .run();
  headers.append('set-cookie', nonceCookie('', 0));
  return Number(result?.meta?.changes || 0) === 1;
}

export function allowGoogleAdsConversionFrame(headers) {
  const current = headers.get('content-security-policy') || '';
  if (!current) return;
  const directives = current.split(';').map(part => part.trim()).filter(Boolean);
  const index = directives.findIndex(part => part === 'frame-src' || part.startsWith('frame-src '));
  if (index < 0) directives.push('frame-src https://hbexperts.com');
  else {
    const tokens = new Set(directives[index].split(/\s+/));
    tokens.add('https://hbexperts.com');
    directives[index] = [...tokens].join(' ');
  }
  headers.set('content-security-policy', `${directives.join('; ')};`);
}

export function addGoogleAdsConversionFrame(html) {
  if (!html || typeof html !== 'string' || !html.includes('</body>')) return html;
  if (html.includes('id="hbe-google-ads-conversion-frame"')) return html;

  const frame = `<iframe id="hbe-google-ads-conversion-frame" title="" aria-hidden="true" tabindex="-1" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" style="position:absolute;width:1px;height:1px;border:0;clip-path:inset(50%);overflow:hidden"></iframe><script id="hbe-google-ads-conversion-trigger">(()=>{const frame=document.getElementById('hbe-google-ads-conversion-frame');if(!frame)return;frame.addEventListener('load',()=>frame.contentWindow.postMessage('hbe:buyer-experience-submitted','https://hbexperts.com'),{once:true});frame.src='${GOOGLE_ADS_CONVERSION_FRAME_URL}';})();</script>`;
  return html.replace('</body>', `${frame}</body>`);
}

export const __test = { NONCE_COOKIE, NONCE_RE, NONCE_TTL_SECONDS, sha256Hex };
