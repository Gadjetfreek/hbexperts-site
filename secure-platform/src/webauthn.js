// Minimal, dependency-free WebAuthn (passkey) verification for Cloudflare Workers.
// Web Crypto only. Supports ES256 (-7) and RS256 (-257), attestation "none" (we request none).
// User verification (Face ID / Touch ID / device PIN) is REQUIRED on every ceremony.
import { b64uEncode, b64uDecode } from './web-push.js';

const te = new TextEncoder();
const td = new TextDecoder();

export { b64uEncode, b64uDecode };

export async function sha256Bytes(data) {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
export async function sha256Hex(data) {
  return [...await sha256Bytes(data)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomChallenge() { return b64uEncode(crypto.getRandomValues(new Uint8Array(32))); }

// --- tiny CBOR decoder (enough for attestationObject + COSE keys) ---
export function cborDecode(bytes) {
  let o = 0;
  const u = bytes;
  function len(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return u[o++];
    if (ai === 25) { const v = (u[o] << 8) | u[o + 1]; o += 2; return v; }
    if (ai === 26) { const v = ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3]; o += 4; return v; }
    throw new Error('cbor_len');
  }
  function item() {
    const b = u[o++]; const mt = b >> 5; const ai = b & 31;
    if (mt === 0) return len(ai);
    if (mt === 1) return -1 - len(ai);
    if (mt === 2) { const n = len(ai); const v = u.slice(o, o + n); o += n; return v; }
    if (mt === 3) { const n = len(ai); const v = td.decode(u.slice(o, o + n)); o += n; return v; }
    if (mt === 4) { const n = len(ai); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
    if (mt === 5) { const n = len(ai); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
    if (mt === 7) { if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; }
    throw new Error('cbor_type');
  }
  const value = item();
  return { value, length: o };
}

export function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authdata_short');
  const flags = ad[32];
  const out = {
    rpIdHash: ad.slice(0, 32), flags,
    up: !!(flags & 0x01), uv: !!(flags & 0x04), be: !!(flags & 0x08), bs: !!(flags & 0x10), at: !!(flags & 0x40),
    signCount: ((ad[33] << 24) >>> 0) + (ad[34] << 16) + (ad[35] << 8) + ad[36]
  };
  if (out.at) {
    const credLen = (ad[53] << 8) | ad[54];
    out.credentialId = ad.slice(55, 55 + credLen);
    const { value } = cborDecode(ad.slice(55 + credLen));
    out.coseKey = value;
  }
  return out;
}

export function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64uEncode(cose.get(-2)), y: b64uEncode(cose.get(-3)), ext: true } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64uEncode(cose.get(-1)), e: b64uEncode(cose.get(-2)), alg: 'RS256', ext: true } };
  throw new Error('unsupported_alg');
}

function derToRaw(der) {
  // ECDSA DER SEQUENCE{INTEGER r, INTEGER s} -> 64-byte r||s
  let o = 2; if (der[1] & 0x80) o += der[1] & 0x7f;
  const read = () => { if (der[o++] !== 2) throw new Error('der'); const n = der[o++]; let v = der.slice(o, o + n); o += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const p = new Uint8Array(32); p.set(v, 32 - v.length); return p; };
  const r = read(), s = read(); const out = new Uint8Array(64); out.set(r); out.set(s, 32); return out;
}

function checkClientData(clientDataJSON, { type, challenge, origin }) {
  const cd = JSON.parse(td.decode(clientDataJSON));
  if (cd.type !== type) throw new Error('bad_type');
  if (cd.challenge !== challenge) throw new Error('bad_challenge');
  if (cd.origin !== origin) throw new Error('bad_origin');
  if (cd.crossOrigin === true) throw new Error('cross_origin');
  return cd;
}
function eq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

export function registrationOptions({ rpId, rpName, userHandle, userName, displayName, challenge, excludeIds = [] }) {
  return {
    rp: { id: rpId, name: rpName },
    user: { id: userHandle, name: userName, displayName },
    challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 300000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: excludeIds.map(id => ({ type: 'public-key', id }))
  };
}

export function assertionOptions({ rpId, challenge, allowIds = [] }) {
  return { rpId, challenge, timeout: 300000, userVerification: 'required', allowCredentials: allowIds.map(id => ({ type: 'public-key', id })) };
}

export async function verifyRegistration({ response, expectedChallenge, origin, rpId }) {
  const clientDataJSON = b64uDecode(response.clientDataJSON);
  checkClientData(clientDataJSON, { type: 'webauthn.create', challenge: expectedChallenge, origin });
  const { value: att } = cborDecode(b64uDecode(response.attestationObject));
  const authData = parseAuthData(att.get('authData'));
  if (!eq(authData.rpIdHash, await sha256Bytes(rpId))) throw new Error('bad_rp');
  if (!authData.up) throw new Error('no_user_presence');
  if (!authData.uv) throw new Error('no_user_verification');
  if (!authData.at || !authData.credentialId) throw new Error('no_credential');
  const { alg, jwk } = coseToJwk(authData.coseKey);
  return { credentialId: b64uEncode(authData.credentialId), alg, jwk, signCount: authData.signCount, backedUp: authData.bs };
}

export async function verifyAssertion({ response, expectedChallenge, origin, rpId, credential }) {
  const clientDataJSON = b64uDecode(response.clientDataJSON);
  checkClientData(clientDataJSON, { type: 'webauthn.get', challenge: expectedChallenge, origin });
  const authDataBytes = b64uDecode(response.authenticatorData);
  const authData = parseAuthData(authDataBytes);
  if (!eq(authData.rpIdHash, await sha256Bytes(rpId))) throw new Error('bad_rp');
  if (!authData.up) throw new Error('no_user_presence');
  if (!authData.uv) throw new Error('no_user_verification');
  const signed = new Uint8Array(authDataBytes.length + 32);
  signed.set(authDataBytes); signed.set(await sha256Bytes(clientDataJSON), authDataBytes.length);
  const sig = b64uDecode(response.signature);
  const jwk = typeof credential.public_key_jwk === 'string' ? JSON.parse(credential.public_key_jwk) : credential.public_key_jwk;
  let ok;
  if (Number(credential.alg) === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), signed);
  } else if (Number(credential.alg) === -257) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
  } else throw new Error('unsupported_alg');
  if (!ok) throw new Error('bad_signature');
  const prev = Number(credential.sign_count || 0);
  if (authData.signCount !== 0 || prev !== 0) { if (authData.signCount <= prev) throw new Error('counter_regressed'); }
  return { signCount: authData.signCount, userVerified: authData.uv };
}

// Challenge bound to an exact document: sha256("hbe-esign-v1|" + docSha256 + "|" + signerId + "|" + nonce)
export async function boundChallenge(docSha256, signerId, nonce) {
  return b64uEncode(await sha256Bytes(`hbe-esign-v1|${docSha256}|${signerId}|${nonce}`));
}

// Browser helper (inlined into pages): JSON <-> WebAuthn ArrayBuffers.
export const WEBAUTHN_BROWSER_JS = `
const b64u={enc:b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''),dec:s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');const bin=atob(s+'='.repeat((4-s.length%4)%4));return Uint8Array.from(bin,c=>c.charCodeAt(0))}};
async function hbePasskeyCreate(o){o.challenge=b64u.dec(o.challenge);o.user.id=b64u.dec(o.user.id);o.excludeCredentials=(o.excludeCredentials||[]).map(c=>({...c,id:b64u.dec(c.id)}));const c=await navigator.credentials.create({publicKey:o});return{id:c.id,rawId:b64u.enc(c.rawId),type:c.type,response:{clientDataJSON:b64u.enc(c.response.clientDataJSON),attestationObject:b64u.enc(c.response.attestationObject)}}}
async function hbePasskeyGet(o){o.challenge=b64u.dec(o.challenge);o.allowCredentials=(o.allowCredentials||[]).map(c=>({...c,id:b64u.dec(c.id)}));const c=await navigator.credentials.get({publicKey:o});return{id:c.id,rawId:b64u.enc(c.rawId),type:c.type,response:{clientDataJSON:b64u.enc(c.response.clientDataJSON),authenticatorData:b64u.enc(c.response.authenticatorData),signature:b64u.enc(c.response.signature),userHandle:c.response.userHandle?b64u.enc(c.response.userHandle):null}}}
async function hbePasskeySupported(){try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())}catch{return false}}
`;
