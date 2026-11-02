// Software passkey authenticator (ES256) for tests. Produces real WebAuthn byte structures.
import { webcrypto as wc, createHash } from 'node:crypto';
const b64u = b => Buffer.from(b).toString('base64url');
const sha = d => createHash('sha256').update(d).digest();
function cborHead(mt, n) { if (n < 24) return Buffer.from([mt << 5 | n]); if (n < 256) return Buffer.from([mt << 5 | 24, n]); return Buffer.from([mt << 5 | 25, n >> 8, n & 255]); }
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([cborHead(3, b.length), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([cborHead(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
}
function rawToDer(raw) {
  const enc = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([2, b.length]), b]); };
  const r = enc(Buffer.from(raw.slice(0, 32))), s = enc(Buffer.from(raw.slice(32)));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}
export async function makeAuthenticator({ rpId, origin, uv = true }) {
  const kp = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await wc.subtle.exportKey('jwk', kp.publicKey);
  const credId = wc.getRandomValues(new Uint8Array(16));
  let count = 0;
  const flags = () => 0x01 | (uv ? 0x04 : 0);
  return {
    id: b64u(credId), setUv(v) { uv = v; },
    async create(opts) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      const ad = Buffer.concat([sha(rpId), Buffer.from([flags() | 0x40]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credId.length]), Buffer.from(credId), cbor(cose)]);
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(ad)]]));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(cd), attestationObject: b64u(att) } };
    },
    async get(opts, { originOverride, challengeOverride } = {}) {
      count++;
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: challengeOverride || opts.challenge, origin: originOverride || origin }));
      const ad = Buffer.concat([sha(rpId), Buffer.from([flags()]), Buffer.from([0, 0, 0, count])]);
      const raw = new Uint8Array(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.concat([ad, sha(cd)])));
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(rawToDer(raw)), userHandle: null } };
    }
  };
}
