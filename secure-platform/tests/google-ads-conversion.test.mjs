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
  assert.match(worker, /if \(claimed\) \{[\s\S]*addGoogleAdsConversionFrame\(text\)[\s\S]*allowGoogleAdsConversionFrame\(headers\)/);
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
