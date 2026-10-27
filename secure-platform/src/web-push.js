// Workers-compatible Web Push (RFC 8291 aes128gcm payload + RFC 8292 VAPID ES256).
// Web Crypto only; no Node-only libraries.
const te = new TextEncoder();

export function b64uEncode(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Encrypt a payload for one subscription. Returns the aes128gcm body.
export async function encryptPayload(subscriptionKeys, plaintext, { salt, serverKeys } = {}) {
  const uaPublic = b64uDecode(subscriptionKeys.p256dh);
  const authSecret = b64uDecode(subscriptionKeys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid_p256dh');
  if (authSecret.length < 16) throw new Error('invalid_auth');
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const as = serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const data = concat(te.encode(plaintext), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = b64uDecode(publicKey);
  if (pub.length !== 65) throw new Error('invalid_vapid_public_key');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64uEncode(sig)}, k=${publicKey}`;
}

export async function sendWebPush(subscription, payload, vapid, { fetchImpl = fetch, ttl = 86400, topic } = {}) {
  const body = await encryptPayload(subscription.keys, typeof payload === 'string' ? payload : JSON.stringify(payload));
  const headers = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: 'high',
    Authorization: await vapidAuthorization(subscription.endpoint, vapid)
  };
  if (topic) headers.Topic = topic;
  const res = await fetchImpl(subscription.endpoint, { method: 'POST', headers, body });
  let reason = null;
  if (!res.ok) {
    try { const j = JSON.parse(await res.text()); if (/^[A-Za-z]{1,40}$/.test(String(j?.reason || ''))) reason = j.reason; } catch {}
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, reason };
}
