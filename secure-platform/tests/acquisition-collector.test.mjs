import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCollectorPayload,
  incrementAggregate,
  listAggregates,
  handleCollectPost,
  handleCollectOptions,
  handleReport,
  handleAcquisitionRoutes,
  afterAcquisitionSideEffects,
  readAttributionParams,
  parseAcqCookie,
  isHbe,
  PAYLOAD_KEYS,
  PUBLIC_EVENTS,
  MAX_BODY_BYTES,
  COLLECT_PATH,
  REPORT_PATH,
  REPORT_JSON_PATH
} from '../src/acquisition-collector.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');

function createMemoryD1() {
  const tables = { acquisition_daily_counts: [] };
  function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }
  function matchFilters(row, filters) {
    return filters.every(f => {
      const v = row[f.col];
      if (f.op === '>=') return String(v) >= String(f.val);
      return v === f.val;
    });
  }
  function parseWhere(sql, args) {
    const filters = [];
    const where = sql.match(/\bwhere\s+(.+?)(?:\s+order\s+by|\s+limit|$)/i);
    if (!where) return filters;
    let i = 0;
    const parts = where[1].split(/\s+and\s+/i);
    for (const part of parts) {
      let m = part.match(/^(\w+)\s*=\s*\?$/i);
      if (m) { filters.push({ col: m[1], val: args[i++], op: '=' }); continue; }
      m = part.match(/^(\w+)\s*>=\s*\?$/i);
      if (m) { filters.push({ col: m[1], val: args[i++], op: '>=' }); continue; }
    }
    return filters;
  }
  const api = {
    _tables: tables,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      const bound = (args = []) => ({
        async run() {
          if (/insert\s+into\s+acquisition_daily_counts/i.test(normalized) && /on conflict/i.test(normalized)) {
            const day = args[0], event = args[1], channel = args[2], campaign = args[3], entry_page = args[4];
            const table = getTable('acquisition_daily_counts');
            const existing = table.find(r =>
              r.day === day && r.event === event && r.channel === channel &&
              r.campaign === campaign && r.entry_page === entry_page
            );
            if (existing) existing.count += 1;
            else table.push({ day, event, channel, campaign, entry_page, count: 1 });
            // Ensure no identity columns ever appear.
            for (const row of table) {
              assert.equal(row.buyer_id, undefined);
              assert.equal(row.household_id, undefined);
              assert.equal(row.email, undefined);
              assert.equal(row.ip, undefined);
            }
            return { success: true };
          }
          throw new Error('unsupported sql run: ' + normalized);
        },
        async all() {
          if (/select\s+day,\s*event,\s*channel,\s*campaign,\s*entry_page,\s*count/i.test(normalized)) {
            const filters = parseWhere(normalized, args);
            let rows = getTable('acquisition_daily_counts').filter(r => matchFilters(r, filters));
            rows = [...rows].sort((a, b) =>
              String(b.day).localeCompare(String(a.day)) ||
              String(a.event).localeCompare(String(b.event))
            );
            return { results: rows.map(r => ({ ...r })) };
          }
          return { results: [] };
        },
        async first() {
          const all = await this.all();
          return all.results[0] || null;
        }
      });
      return {
        bind(...args) { return bound(args); },
        run() { return bound([]).run(); },
        all() { return bound([]).all(); },
        first() { return bound([]).first(); }
      };
    }
  };
  return api;
}

function envWith({ db, email, limiter } = {}) {
  return {
    BUYER_DB: db || createMemoryD1(),
    HBE_ADMIN_EMAIL: 'cwhitehead@hbexperts.com',
    SUBMIT_RATE_LIMITER: limiter || {
      async limit() { return { success: true }; }
    },
    ...(email ? {} : {})
  };
}

function collectRequest(body, { origin = 'https://hbexperts.com', extraHeaders = {} } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://buyer.hbexperts.com' + COLLECT_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'content-length': String(Buffer.byteLength(payload)),
      ...extraHeaders
    },
    body: payload
  });
}

test('unknown event rejected', () => {
  const result = validateCollectorPayload({
    event: 'buyer_email_captured',
    page_path: '/',
    channel: 'direct'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown_event');
});

test('unknown field rejected', () => {
  const result = validateCollectorPayload({
    event: 'discovery_view',
    page_path: '/',
    channel: 'direct',
    extra_tracking_id: 'abc'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown_field');
});

test('PII/sensitive values rejected', () => {
  assert.equal(validateCollectorPayload({
    event: 'discovery_view', page_path: '/', channel: 'direct', utm_campaign: 'buyer@example.com'
  }).error, 'sensitive_value');
  assert.equal(validateCollectorPayload({
    event: 'discovery_view', page_path: '/', channel: 'direct', utm_source: '5551234567'
  }).error, 'sensitive_value');
  assert.equal(validateCollectorPayload({
    event: 'discovery_view', page_path: '/', channel: 'direct', email: 'x@y.com'
  }).error, 'unknown_field');
});

test('oversized body rejected', async () => {
  const big = { event: 'discovery_view', page_path: '/', channel: 'direct', utm_campaign: 'x'.repeat(MAX_BODY_BYTES) };
  const res = await handleCollectPost(collectRequest(big), envWith());
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.equal(body.error, 'oversized');
});

test('unapproved origin rejected', async () => {
  const res = await handleCollectPost(
    collectRequest({ event: 'discovery_view', page_path: '/', channel: 'direct' }, { origin: 'https://evil.example' }),
    envWith()
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'origin_rejected');
});

test('OPTIONS preflight only for approved origins', async () => {
  const ok = await handleCollectOptions(new Request('https://buyer.hbexperts.com' + COLLECT_PATH, {
    method: 'OPTIONS',
    headers: { origin: 'https://www.hbexperts.com' }
  }));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://www.hbexperts.com');

  const bad = await handleCollectOptions(new Request('https://buyer.hbexperts.com' + COLLECT_PATH, {
    method: 'OPTIONS',
    headers: { origin: 'https://tracker.example' }
  }));
  assert.equal(bad.status, 403);
});

test('aggregate persistence only — no identity fields stored', async () => {
  const db = createMemoryD1();
  const payload = {
    event: 'discovery_view',
    page_path: '/relocation/',
    channel: 'relocation',
    utm_campaign: 'relocation-neohio',
    utm_source: 'googleads',
    utm_medium: 'cpc',
    referrer_host: 'www.google.com',
    ts: '2026-09-16T12:00:00.000Z'
  };
  const validated = validateCollectorPayload(payload);
  assert.equal(validated.ok, true);
  await incrementAggregate(db, validated.record);
  await incrementAggregate(db, validated.record);
  const rows = await listAggregates(db, { days: 30 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].event, 'discovery_view');
  assert.equal(rows[0].channel, 'relocation');
  assert.equal(rows[0].campaign, 'relocation-neohio');
  assert.equal(rows[0].entry_page, '/relocation/');
  assert.equal(rows[0].buyer_id, undefined);
  assert.equal(rows[0].email, undefined);
  assert.equal(rows[0].household_id, undefined);
  assert.equal(rows[0].ip, undefined);
  assert.equal(rows[0].user_agent, undefined);
  for (const key of Object.keys(rows[0])) {
    assert.equal(['day', 'event', 'channel', 'campaign', 'entry_page', 'count'].includes(key), true);
  }
});

test('public allowlisted events accepted via collector POST', async () => {
  const db = createMemoryD1();
  for (const event of PUBLIC_EVENTS) {
    const res = await handleCollectPost(
      collectRequest({ event, page_path: '/', channel: 'organic', ts: '2026-09-16T12:00:00.000Z' }),
      envWith({ db })
    );
    assert.equal(res.status, 204, event);
  }
  const rows = await listAggregates(db, { days: 30 });
  assert.equal(rows.length, 3);
});

test('protected reporting inaccessible without auth', async () => {
  const db = createMemoryD1();
  await incrementAggregate(db, {
    event: 'discovery_view', page_path: '/', channel: 'direct', ts: '2026-09-16T12:00:00.000Z'
  });
  const env = envWith({ db });
  const unauth = await handleReport(
    new Request('https://buyer.hbexperts.com' + REPORT_PATH),
    env
  );
  assert.equal(unauth.status, 403);
  const text = await unauth.text();
  assert.match(text, /HBE access required/i);
  assert.doesNotMatch(text, /discovery_view/);

  const unauthJson = await handleReport(
    new Request('https://buyer.hbexperts.com' + REPORT_JSON_PATH),
    env,
    { json: true }
  );
  assert.equal(unauthJson.status, 403);

  const authReq = new Request('https://buyer.hbexperts.com' + REPORT_PATH, {
    headers: { 'Cf-Access-Authenticated-User-Email': 'cwhitehead@hbexperts.com' }
  });
  assert.equal(isHbe(authReq, env), true);
  const auth = await handleReport(authReq, env);
  assert.equal(auth.status, 200);
  const html = await auth.text();
  assert.match(html, /Acquisition funnel/);
  assert.match(html, /discovery_view/);
  assert.doesNotMatch(html, /buyer_id|household_id|@hbexperts\.com/);
});

test('public→secure attribution reads only approved tokens', () => {
  const url = new URL('https://buyer.hbexperts.com/?hbe_ch=organic&hbe_lp=/strategy-session/&hbe_ft=local-awareness&email=buyer@example.com&buyer_id=secret');
  const attrs = readAttributionParams(url);
  assert.equal(attrs.channel, 'organic');
  assert.equal(attrs.entry_page, '/strategy-session/');
  assert.equal(attrs.campaign, 'local-awareness');
  assert.equal(attrs.email, undefined);
  assert.equal(attrs.buyer_id, undefined);
});

test('public→secure does not expose BuyerUI/HBEUI data in report rows', async () => {
  const db = createMemoryD1();
  await incrementAggregate(db, {
    event: 'journey_start',
    channel: 'organic',
    page_path: '/strategy-session/',
    utm_campaign: 'local-awareness',
    ts: '2026-09-16T12:00:00.000Z'
  });
  await incrementAggregate(db, {
    event: 'experience_complete',
    channel: 'organic',
    page_path: '/strategy-session/',
    utm_campaign: 'local-awareness',
    ts: '2026-09-16T12:05:00.000Z'
  });
  const env = envWith({ db });
  const res = await handleReport(new Request('https://buyer.hbexperts.com' + REPORT_JSON_PATH, {
    headers: { 'Cf-Access-Authenticated-User-Email': 'cwhitehead@hbexperts.com' }
  }), env, { json: true });
  const body = await res.json();
  assert.equal(body.ok, true);
  for (const row of body.rows) {
    assert.equal(row.answers_json, undefined);
    assert.equal(row.first_name, undefined);
    assert.equal(row.email, undefined);
    assert.equal(row.buyer_id, undefined);
    assert.equal(row.case_id, undefined);
    for (const key of Object.keys(row)) {
      assert.equal(['day', 'event', 'channel', 'campaign', 'entry_page', 'count'].includes(key), true);
    }
  }
});

test('handleAcquisitionRoutes wires collect and report paths', async () => {
  const db = createMemoryD1();
  const env = envWith({ db });
  const collect = await handleAcquisitionRoutes(
    collectRequest({ event: 'consultation_cta_click', page_path: '/', channel: 'direct', dest_path: '/contact/' }),
    env,
    {}
  );
  assert.equal(collect.status, 204);

  const denied = await handleAcquisitionRoutes(
    new Request('https://buyer.hbexperts.com' + REPORT_PATH),
    env,
    {}
  );
  assert.equal(denied.status, 403);

  const passthrough = await handleAcquisitionRoutes(
    new Request('https://buyer.hbexperts.com/questionnaire'),
    env,
    {}
  );
  assert.equal(passthrough, null);
});

test('journey_start side effect sets aggregate cookie without identity', async () => {
  const db = createMemoryD1();
  const env = envWith({ db });
  const request = new Request('https://buyer.hbexperts.com/?hbe_ch=paid&hbe_lp=/&hbe_ft=spring-cpc');
  const base = new Response('<html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
  const out = await afterAcquisitionSideEffects(request, env, base, {});
  const cookie = out.headers.get('Set-Cookie') || '';
  assert.match(cookie, /hbe_acq=/);
  assert.doesNotMatch(cookie, /@|buyer_id|household/i);
  const rows = await listAggregates(db, { days: 1 });
  assert.equal(rows.some(r => r.event === 'journey_start' && r.channel === 'paid'), true);
});

test('experience_complete increments from coarse cookie only', async () => {
  const db = createMemoryD1();
  const env = envWith({ db });
  const cookie = 'hbe_acq=' + encodeURIComponent('ch=organic&lp=%2Fabout%2F&ft=partner-ref');
  const request = new Request('https://buyer.hbexperts.com/api/intake', {
    method: 'POST',
    headers: { cookie }
  });
  const parsed = parseAcqCookie(cookie);
  assert.equal(parsed.channel, 'organic');
  assert.equal(parsed.entry_page, '/about/');
  assert.equal(parsed.campaign, 'partner-ref');

  const response = new Response(null, { status: 302, headers: { location: '/portal' } });
  await afterAcquisitionSideEffects(request, env, response, {});
  // allow microtask
  await new Promise(r => setTimeout(r, 0));
  const rows = await listAggregates(db, { days: 1 });
  const done = rows.find(r => r.event === 'experience_complete');
  assert.ok(done);
  assert.equal(done.channel, 'organic');
  assert.equal(done.campaign, 'partner-ref');
  assert.equal(done.entry_page, '/about/');
  assert.equal(done.email, undefined);
});

test('rate limiter fail-closed returns 429', async () => {
  const env = envWith({
    limiter: { async limit() { return { success: false }; } }
  });
  const res = await handleCollectPost(
    collectRequest({ event: 'discovery_view', page_path: '/', channel: 'direct' }),
    env
  );
  assert.equal(res.status, 429);
});

test('PAYLOAD_KEYS match public acquisition.js allowlist', () => {
  const acqJs = readFileSync(join(repoRoot, 'themes/hbe/static/js/acquisition.js'), 'utf8');
  const match = acqJs.match(/var PAYLOAD_KEYS = \[([\s\S]*?)\];/);
  assert.ok(match);
  const fromClient = match[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(fromClient, [...PAYLOAD_KEYS]);
});

test('migration defines aggregate-only table without FKs', () => {
  const sql = readFileSync(join(root, 'migrations/acquisition-aggregate.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS acquisition_daily_counts/);
  assert.match(sql, /PRIMARY KEY \(day, event, channel, campaign, entry_page\)/);
  const ddl = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(ddl, /REFERENCES|buyer_id|household|FOREIGN KEY/i);
});

test('issue33 production worker wires acquisition routes', () => {
  const src = readFileSync(join(root, 'src/issue33-production-worker.js'), 'utf8');
  assert.match(src, /handleAcquisitionRoutes/);
  assert.match(src, /afterAcquisitionSideEffects/);
  assert.match(src, /acquisition-collector/);
});
