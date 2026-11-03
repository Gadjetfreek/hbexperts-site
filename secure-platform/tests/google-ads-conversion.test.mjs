import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOOGLE_ADS_CONVERSION_FRAME_URL,
  __test,
  addGoogleAdsConversionFrame,
  allowGoogleAdsConversionFrame,
  claimGoogleAdsSubmissionConversion,
  ensureGoogleAdsSubmissionNonce
} from '../src/google-ads-conversion.js';

const root = join(import.meta.dirname, '..', '..');
const successHtml = '<!doctype html><html><head></head><body><h1>Thanks, Private Buyer</h1><div>SECRET-CODE</div></body></html>';

function sourceFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

function fakeDb() {
  const rows = new Map();
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...nextArgs) { return statement(sql, nextArgs); },
    async run() {
      if (/DELETE FROM google_ads_conversion_nonces/i.test(sql)) {
        for (const [key, row] of rows) if (row.expires_at < args[0]) rows.delete(key);
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO google_ads_conversion_nonces/i.test(sql)) {
        rows.set(args[0], { issued_at: args[1], expires_at: args[2], converted_at: null });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE google_ads_conversion_nonces/i.test(sql)) {
        const [convertedAt, nonceHash, minimumExpiry] = args;
        const row = rows.get(nonceHash);
        if (!row || row.converted_at || row.expires_at < minimumExpiry) return { meta: { changes: 0 } };
        row.converted_at = convertedAt;
        return { meta: { changes: 1 } };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  });
  return {
    rows,
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      const out = [];
      for (const item of statements) out.push(await item.run());
      return out;
    }
  };
}

function cookieValue(headers) {
  const raw = headers.get('set-cookie') || '';
  const match = raw.match(/hbe_submission_nonce=([^;]+)/);
  return match?.[1] || '';
}

test('public base tag remains scoped to the buyer representation landing page', () => {
  const layout = readFileSync(join(root, 'themes/hbe/layouts/_default/baseof.html'), 'utf8');
  assert.match(layout, /if eq \.RelPermalink "\/buyer-representation\/"/);
  assert.equal((layout.match(/AW-18500305800/g) || []).length, 2);
  assert.ok(layout.indexOf('AW-18500305800') < layout.indexOf('<meta charset="utf-8">'));
});

test('isolated public frame sends the exact conversion only after a trusted fixed message', () => {
  const layout = readFileSync(join(root, 'themes/hbe/layouts/_default/google-ads-conversion.html'), 'utf8');
  assert.match(layout, /event\.origin !== 'https:\/\/buyer\.hbexperts\.com'/);
  assert.match(layout, /event\.source !== window\.parent/);
  assert.match(layout, /event\.data !== 'hbe:buyer-experience-submitted'/);
  assert.match(layout, /send_to: 'AW-18500305800\/_HR6CNKd55QdEIiH0fVE'/);
  assert.equal((layout.match(/gtag\('event', 'conversion'/g) || []).length, 1);
  assert.match(layout, /send_page_view: false/);
  assert.match(layout, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(layout, /no-referrer/);
  assert.doesNotMatch(layout, /first_name|last_name|email|phone|access.?code|household.?id|buyer.?id|questionnaire|nonce/i);
});

test('secure platform never embeds Google code, identifiers, or third-party endpoints', () => {
  const secureSource = sourceFiles(join(root, 'secure-platform/src'))
    .filter(path => path.endsWith('.js'))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(secureSource, /googletagmanager|googleadservices|AW-18500305800|_HR6CNKd55QdEIiH0fVE|send_to/i);
});

test('questionnaire visit issues an opaque HttpOnly nonce stored only as a hash', async () => {
  const db = fakeDb();
  const headers = new Headers();
  const now = new Date('2026-10-08T12:00:00.000Z');
  const issued = await ensureGoogleAdsSubmissionNonce(new Request('https://buyer.hbexperts.com/questionnaire'), { BUYER_DB: db }, headers, now);
  const nonce = cookieValue(headers);
  assert.equal(issued, true);
  assert.match(nonce, __test.NONCE_RE);
  assert.match(headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.has(nonce), false);
  assert.equal([...db.rows.keys()][0], await __test.sha256Hex(nonce));
});

test('successful submission nonce is consumed atomically at most once', async () => {
  const db = fakeDb();
  const issuedHeaders = new Headers();
  const now = new Date('2026-10-08T12:00:00.000Z');
  await ensureGoogleAdsSubmissionNonce(new Request('https://buyer.hbexperts.com/questionnaire'), { BUYER_DB: db }, issuedHeaders, now);
  const nonce = cookieValue(issuedHeaders);
  const request = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_submission_nonce=${nonce}` } });
  const firstHeaders = new Headers();
  const retryHeaders = new Headers();
  assert.equal(await claimGoogleAdsSubmissionConversion(request, { BUYER_DB: db }, firstHeaders, now), true);
  assert.equal(await claimGoogleAdsSubmissionConversion(request, { BUYER_DB: db }, retryHeaders, now), false);
  assert.match(firstHeaders.get('set-cookie'), /Max-Age=0/);
  assert.match(retryHeaders.get('set-cookie'), /Max-Age=0/);
});

test('concurrent claims for the same submission permit only one conversion', async () => {
  const db = fakeDb();
  const issuedHeaders = new Headers();
  const now = new Date('2026-10-08T12:00:00.000Z');
  await ensureGoogleAdsSubmissionNonce(new Request('https://buyer.hbexperts.com/questionnaire'), { BUYER_DB: db }, issuedHeaders, now);
  const nonce = cookieValue(issuedHeaders);
  const request = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_submission_nonce=${nonce}` } });
  const results = await Promise.all([
    claimGoogleAdsSubmissionConversion(request, { BUYER_DB: db }, new Headers(), now),
    claimGoogleAdsSubmissionConversion(request, { BUYER_DB: db }, new Headers(), now)
  ]);
  assert.deepEqual(results.sort(), [false, true]);
});

test('missing, forged, or expired nonce cannot produce a conversion claim', async () => {
  const db = fakeDb();
  const missing = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST' });
  assert.equal(await claimGoogleAdsSubmissionConversion(missing, { BUYER_DB: db }, new Headers()), false);
  const forged = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_submission_nonce=${'A'.repeat(43)}` } });
  assert.equal(await claimGoogleAdsSubmissionConversion(forged, { BUYER_DB: db }, new Headers()), false);

  const issuedHeaders = new Headers();
  await ensureGoogleAdsSubmissionNonce(new Request('https://buyer.hbexperts.com/questionnaire'), { BUYER_DB: db }, issuedHeaders, new Date('2026-10-08T12:00:00.000Z'));
  const expired = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_submission_nonce=${cookieValue(issuedHeaders)}` } });
  assert.equal(await claimGoogleAdsSubmissionConversion(expired, { BUYER_DB: db }, new Headers(), new Date('2026-10-08T12:31:00.000Z')), false);
});

test('transient claim failure preserves the nonce for a safe retry', async () => {
  const nonce = 'A'.repeat(43);
  const request = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_submission_nonce=${nonce}` } });
  const headers = new Headers();
  const failingDb = {
    prepare() {
      return {
        bind() { return this; },
        async run() { throw new Error('temporary D1 failure'); }
      };
    }
  };
  await assert.rejects(claimGoogleAdsSubmissionConversion(request, { BUYER_DB: failingDb }, headers));
  assert.equal(headers.has('set-cookie'), false);
});

test('credential-bearing response receives only a fixed cross-origin frame trigger', () => {
  const out = addGoogleAdsConversionFrame(successHtml);
  assert.match(out, /https:\/\/hbexperts\.com\/google-ads-conversion\//);
  assert.match(out, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(out, /referrerpolicy="no-referrer"/);
  assert.match(out, /postMessage\('hbe:buyer-experience-submitted','https:\/\/hbexperts\.com'\)/);
  assert.doesNotMatch(out, /googletagmanager|googleadservices|AW-18500305800|send_to/i);
  assert.equal(addGoogleAdsConversionFrame(out), out);
  assert.equal(GOOGLE_ADS_CONVERSION_FRAME_URL, 'https://hbexperts.com/google-ads-conversion/');
});

test('successful response CSP allows only the public HBE frame, never Google endpoints', () => {
  const headers = new Headers({
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:;"
  });
  allowGoogleAdsConversionFrame(headers);
  const csp = headers.get('content-security-policy');
  assert.match(csp, /frame-src https:\/\/hbexperts\.com/);
  assert.doesNotMatch(csp, /googletagmanager|googleadservices|google\.com/);
  assert.match(csp, /default-src 'self'/);
});

test('production wrapper gates nonce issuance and conversion claim to exact successful routes', () => {
  const worker = readFileSync(join(root, 'secure-platform/src/issue33-production-worker.js'), 'utf8');
  assert.match(worker, /request\.method === 'GET' && url\.pathname === '\/questionnaire' && response\.status === 200/);
  assert.match(worker, /request\.method === 'POST' && url\.pathname === '\/api\/intake' && response\.status === 200/);
  assert.match(worker, /if \(claimed\) \{[\s\S]*addGoogleAdsConversionFrame\(text, click\)[\s\S]*allowGoogleAdsConversionFrame\(headers\)/);
});

test('schema stores only hashed, expiring, single-use nonce receipts', () => {
  const schema = readFileSync(join(root, 'secure-platform/schema-issue33.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS google_ads_conversion_nonces/);
  assert.match(schema, /nonce_hash TEXT PRIMARY KEY/);
  assert.match(schema, /expires_at TEXT NOT NULL/);
  assert.match(schema, /converted_at TEXT/);
});

test('privacy disclosure describes the isolated fixed-signal boundary', () => {
  const privacy = readFileSync(join(root, 'content/privacy.md'), 'utf8');
  assert.match(privacy, /separate, non-sensitive conversion frame/);
  assert.match(privacy, /fixed completion signal/);
  assert.match(privacy, /not loaded in the questionnaire, secure submission confirmation, or Buyer Portal/);
  assert.match(privacy, /does not receive Buyer Experience form fields, access codes, submission nonces/);
});

// --- Ad click id (gclid/gbraid/wbraid) passthrough ---
import {
  captureGoogleAdsClick,
  readGoogleAdsClick,
  clearGoogleAdsClick,
  googleAdsConversionFrameUrl,
  validClickId
} from '../src/google-ads-conversion.js';

const SYNTH_GCLID = 'TeSt_GcLiD-0123456789abcXYZ';

test('click id validation is strict', () => {
  assert.equal(validClickId('gclid', SYNTH_GCLID), true);
  assert.equal(validClickId('gbraid', '0AAAAA-synthetic_1'), true);
  assert.equal(validClickId('wbraid', 'CkSynthetic_wbraid1'), true);
  for (const bad of ['', 'short', 'a'.repeat(201), 'abc<script>xyz1', 'abc def ghij1', 'abc%27xyz12345', "abc'xyz12345", 'abc"xyz12345', 'a.b.c.d.e.f.g.h', 'buyer@example.com']) {
    assert.equal(validClickId('gclid', bad), false, bad);
  }
  assert.equal(validClickId('email', SYNTH_GCLID), false);
  assert.equal(validClickId('utm_source', SYNTH_GCLID), false);
});

test('landing capture stores only a valid click id in a first-party Lax cookie', () => {
  const headers = new Headers();
  const click = captureGoogleAdsClick(new Request(`https://buyer.hbexperts.com/questionnaire?gclid=${SYNTH_GCLID}&email=buyer%40example.com&name=Test`), headers);
  assert.deepEqual(click, { key: 'gclid', value: SYNTH_GCLID });
  const cookie = headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^hbe_ad_click=gclid\\.${SYNTH_GCLID};`));
  assert.match(cookie, /Max-Age=7776000/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.doesNotMatch(cookie, /example\.com|Test/);
  assert.ok(__test.CLICK_TTL_SECONDS <= 90 * 24 * 60 * 60);
});

test('invalid or missing click ids are ignored and set no cookie', () => {
  for (const q of ['', '?gclid=bad<>value12345', '?gclid=short', '?utm_source=google', `?fbclid=${SYNTH_GCLID}`]) {
    const headers = new Headers();
    assert.equal(captureGoogleAdsClick(new Request(`https://buyer.hbexperts.com/${q}`), headers), null);
    assert.equal(headers.has('set-cookie'), false, q);
  }
});

test('click id survives navigation: read back from cookie on any later request', () => {
  const req = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `other=1; hbe_ad_click=wbraid.CkSynthetic_wbraid1` } });
  assert.deepEqual(readGoogleAdsClick(req), { key: 'wbraid', value: 'CkSynthetic_wbraid1' });
  const tampered = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_ad_click=gclid.abc<script>12345` } });
  assert.equal(readGoogleAdsClick(tampered), null);
  const wrongKey = new Request('https://buyer.hbexperts.com/api/intake', { method: 'POST', headers: { cookie: `hbe_ad_click=email.${SYNTH_GCLID}` } });
  assert.equal(readGoogleAdsClick(wrongKey), null);
  const h = new Headers();
  clearGoogleAdsClick(h);
  assert.match(h.get('set-cookie'), /^hbe_ad_click=; .*Max-Age=0/);
});

test('success frame carries only the click id, never buyer data', () => {
  assert.equal(googleAdsConversionFrameUrl(null), 'https://hbexperts.com/google-ads-conversion/');
  assert.equal(googleAdsConversionFrameUrl({ key: 'gclid', value: 'bad<>' }), 'https://hbexperts.com/google-ads-conversion/');
  const out = addGoogleAdsConversionFrame(successHtml, { key: 'gclid', value: SYNTH_GCLID });
  assert.match(out, new RegExp(`frame\\.src='https://hbexperts\\.com/google-ads-conversion/\\?gclid=${SYNTH_GCLID}'`));
  const src = /frame\.src='([^']+)'/.exec(out)[1];
  const params = [...new URL(src).searchParams.keys()];
  assert.deepEqual(params, ['gclid']);
  assert.doesNotMatch(src, /Private|Buyer|SECRET|@/);
  assert.doesNotMatch(out, /googletagmanager|googleadservices|AW-18500305800|send_to/i);
});

test('public frame sends explicit value and currency once', () => {
  const layout = readFileSync(join(root, 'themes/hbe/layouts/_default/google-ads-conversion.html'), 'utf8');
  assert.match(layout, /value: 1\.0, currency: 'USD'/);
  assert.equal((layout.match(/gtag\('event', 'conversion'/g) || []).length, 1);
});

test('production worker wires capture on GET and passthrough only inside the successful claim', () => {
  const src = readFileSync(join(root, 'secure-platform/src/issue33-production-worker.js'), 'utf8');
  const claimBlock = src.slice(src.indexOf("url.pathname === '/api/intake' && response.status === 200"));
  assert.ok(claimBlock.indexOf('if (claimed)') < claimBlock.indexOf('readGoogleAdsClick'));
  assert.match(src, /try \{ captureGoogleAdsClick\(request, headers\); \} catch/);
});
