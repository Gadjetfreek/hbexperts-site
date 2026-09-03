import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const acq = require('./acquisition.js');

const PII_KEYS = [
  'email', 'phone', 'name', 'first_name', 'last_name', 'full_name',
  'household', 'household_id', 'questionnaire', 'answers', 'ssn',
  'address', 'buyer_id', 'utm_term', 'utm_content'
];

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}

function fakeDocument() {
  const emitter = new EventEmitter();
  const headChildren = [];
  const doc = {
    referrer: '',
    readyState: 'complete',
    documentElement: { getAttribute: () => null },
    head: {
      appendChild(node) { headChildren.push(node); return node; }
    },
    createElement(tag) {
      return { tagName: tag, defer: false, src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    },
    querySelector() { return null; },
    addEventListener(type, fn) { emitter.on(type, fn); },
    dispatchEvent(evt) { emitter.emit(evt.type, evt); return true; },
    _headChildren: headChildren,
    _emitter: emitter
  };
  return doc;
}

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
    this.bubbles = !!(init && init.bubbles);
  }
}

test('classifyChannel: paid from utm_medium', () => {
  assert.equal(acq.classifyChannel({ utm_medium: 'cpc' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_medium: 'ppc' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_medium: 'paid_social' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_medium: 'display' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_medium: 'ads' }, ''), 'paid');
});

test('classifyChannel: paid from ad-platform utm_source', () => {
  assert.equal(acq.classifyChannel({ utm_source: 'googleads' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_source: 'fb' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_source: 'meta' }, ''), 'paid');
  assert.equal(acq.classifyChannel({ utm_source: 'bing' }, ''), 'paid');
});

test('classifyChannel: organic from search referrer or utm_medium', () => {
  assert.equal(acq.classifyChannel({}, 'www.google.com'), 'organic');
  assert.equal(acq.classifyChannel({}, 'www.google.co.uk'), 'organic');
  assert.equal(acq.classifyChannel({}, 'www.bing.com'), 'organic');
  assert.equal(acq.classifyChannel({}, 'duckduckgo.com'), 'organic');
  assert.equal(acq.classifyChannel({ utm_medium: 'organic', utm_source: 'google' }, ''), 'organic');
});

test('classifyChannel: referral from external non-search host', () => {
  assert.equal(acq.classifyChannel({}, 'news.example.com'), 'referral');
  assert.equal(acq.classifyChannel({}, 'facebook.com'), 'referral');
});

test('classifyChannel: direct when no utm and no referrer', () => {
  assert.equal(acq.classifyChannel({}, ''), 'direct');
  assert.equal(acq.classifyChannel({}, null), 'direct');
});

test('classifyChannel: local and relocation only from explicit campaign tokens', () => {
  assert.equal(acq.classifyChannel({ utm_campaign: 'local-awareness' }, ''), 'local');
  assert.equal(acq.classifyChannel({ utm_content: 'local' }, 'www.google.com'), 'local');
  assert.equal(acq.classifyChannel({ utm_campaign: 'relocation-neohio' }, ''), 'relocation');
  assert.equal(acq.classifyChannel({ utm_content: 'relocation' , utm_medium: 'cpc' }, ''), 'relocation');
  assert.equal(acq.classifyChannel({ utm_campaign: 'allocate-budget' }, ''), 'unknown');
  assert.equal(acq.classifyChannel({ utm_campaign: 'locale-guide' }, ''), 'unknown');
});

test('classifyChannel: explicit local token precedes paid', () => {
  assert.equal(acq.classifyChannel({ utm_medium: 'cpc', utm_campaign: 'local' }, ''), 'local');
});

test('classifyChannel: unknown leftover utm without paid/organic/referral signal', () => {
  assert.equal(acq.classifyChannel({ utm_medium: 'email', utm_source: 'newsletter' }, ''), 'unknown');
});

test('sanitizeUtm drops email-like and phone-like values', () => {
  assert.equal(acq.sanitizeUtm('buyer@example.com'), '');
  assert.equal(acq.sanitizeUtm('Contact me@site.org today'), '');
  assert.equal(acq.sanitizeUtm('202-555-0100'), '');
  assert.equal(acq.sanitizeUtm('+1 (202) 555-0100'), '');
  assert.equal(acq.sanitizeUtm('google'), 'google');
  assert.equal(acq.sanitizeUtm('  cpc  '), 'cpc');
});

test('sanitizeUtm drops URL-like values and caps length', () => {
  assert.equal(acq.sanitizeUtm('https://evil.example/path?x=1'), '');
  const long = 'a'.repeat(80);
  assert.equal(acq.sanitizeUtm(long).length, 64);
});

test('readUtms keeps only sanitized known keys', () => {
  const utms = acq.readUtms('?utm_source=google&utm_medium=cpc&utm_campaign=buyer@x.com&utm_term=2025550100&utm_content=local&extra=nope');
  assert.equal(utms.utm_source, 'google');
  assert.equal(utms.utm_medium, 'cpc');
  assert.equal(utms.utm_content, 'local');
  assert.equal(utms.utm_campaign, undefined);
  assert.equal(utms.utm_term, undefined);
  assert.equal(utms.extra, undefined);
});

test('discovery_view payload has no PII keys', () => {
  const payload = acq.buildPayload('discovery_view', {
    page_path: '/strategy-session/?email=a@b.com',
    channel: 'organic',
    utm_source: 'google',
    utm_medium: 'organic',
    utm_campaign: 'buyer@example.com',
    referrer_host: 'www.google.com',
    ts: '2026-09-03T20:00:00.000Z',
    email: 'should-not-copy',
    household_id: 'nope'
  });
  assert.equal(payload.event, 'discovery_view');
  assert.equal(payload.page_path, '/strategy-session/');
  assert.equal(payload.channel, 'organic');
  assert.equal(payload.utm_source, 'google');
  assert.equal(payload.utm_medium, 'organic');
  assert.equal(payload.referrer_host, 'www.google.com');
  assert.equal(payload.utm_campaign, undefined);
  for (const key of Object.keys(payload)) {
    assert.equal(acq.PAYLOAD_KEYS.includes(key), true, 'unexpected key ' + key);
    assert.equal(PII_KEYS.includes(key), false, 'pii key ' + key);
  }
  assert.equal(payload.email, undefined);
  assert.equal(payload.household_id, undefined);
});

test('annotateJourneyUrl is a no-op and leaves journey URLs clean', () => {
  const original = 'https://buyer.hbexperts.com/questionnaire';
  const href = acq.annotateJourneyUrl(original, {
    channel: 'organic',
    first_touch: 'organic',
    landing_path: '/strategy-session/',
    email: 'buyer@example.com'
  });
  assert.equal(href, original);
  const url = new URL(href);
  assert.equal(url.origin, 'https://buyer.hbexperts.com');
  assert.equal(url.pathname, '/questionnaire');
  assert.equal(url.searchParams.get('hbe_ch'), null);
  assert.equal(url.searchParams.get('hbe_ft'), null);
  assert.equal(url.searchParams.get('hbe_lp'), null);
  assert.equal(url.searchParams.get('email'), null);
  assert.equal([...url.searchParams.keys()].length, 0);
});

test('shouldAnnotateJourneyLink only for buyer.hbexperts.com http(s)', () => {
  assert.equal(acq.shouldAnnotateJourneyLink('https://buyer.hbexperts.com/'), true);
  assert.equal(acq.shouldAnnotateJourneyLink('https://buyer.hbexperts.com/questionnaire'), true);
  assert.equal(acq.shouldAnnotateJourneyLink('https://hbexperts.com/strategy-session/'), false);
  assert.equal(acq.shouldAnnotateJourneyLink('mailto:buyers@hbexperts.com'), false);
  assert.equal(acq.shouldAnnotateJourneyLink('tel:2025550100'), false);
});

test('annotateJourneyUrl leaves non-journey links unchanged', () => {
  const original = 'https://hbexperts.com/strategy-session/';
  assert.equal(acq.annotateJourneyUrl(original, { channel: 'direct' }), original);
});

test('isConsultationCta matches public strategy-session and contact paths', () => {
  assert.equal(acq.isConsultationCta('https://hbexperts.com/strategy-session/', 'hbexperts.com'), true);
  assert.equal(acq.isConsultationCta('https://hbexperts.com/contact/', 'hbexperts.com'), true);
  assert.equal(acq.isConsultationCta('https://hbexperts.com/about/', 'hbexperts.com'), false);
  assert.equal(acq.isConsultationCta('https://buyer.hbexperts.com/', 'hbexperts.com'), false);
});

test('referrerHost keeps host only and strips same-site', () => {
  assert.equal(acq.referrerHost('https://www.google.com/search?q=homebuyer+email@x.com', 'hbexperts.com'), 'www.google.com');
  assert.equal(acq.referrerHost('https://hbexperts.com/about/?email=a@b.com', 'hbexperts.com'), '');
  assert.equal(acq.referrerHost('https://www.hbexperts.com/', 'hbexperts.com'), '');
});

test('client emits discovery_view, CustomEvent, ring buffer, and optional sink', () => {
  const storage = memoryStorage();
  const doc = fakeDocument();
  const win = { __HBE_ACQ_EVENTS__: [], __HBE_ACQ__: { send(p) { win._sent = (win._sent || []).concat([p]); } } };
  const seen = [];
  doc.addEventListener('hbe:acquisition', (evt) => seen.push(evt.detail));
  const client = acq.createClient({
    window: win,
    document: doc,
    location: { href: 'https://hbexperts.com/?utm_source=google&utm_medium=organic', pathname: '/', search: '?utm_source=google&utm_medium=organic', hostname: 'hbexperts.com' },
    sessionStorage: storage,
    referrer: 'https://www.google.com/search?q=secret',
    now: () => '2026-09-03T20:00:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  client.boot();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event, 'discovery_view');
  assert.equal(seen[0].channel, 'organic');
  assert.equal(seen[0].page_path, '/');
  assert.equal(seen[0].utm_source, 'google');
  assert.equal(seen[0].referrer_host, 'www.google.com');
  assert.equal(win.__HBE_ACQ_EVENTS__.length, 1);
  assert.equal(win._sent.length, 1);
  const stored = JSON.parse(storage.getItem(acq.STORAGE_KEY));
  assert.equal(stored.v, 1);
  assert.equal(stored.channel, 'organic');
  assert.equal(stored.landing_path, '/');
});

test('journey click fires journey_entry_click without mutating href', () => {
  const storage = memoryStorage();
  storage.setItem(acq.STORAGE_KEY, JSON.stringify({
    v: 1, channel: 'referral', landing_path: '/about/', ts: '2026-09-03T19:00:00.000Z', referrer_host: 'news.example.com'
  }));
  const doc = fakeDocument();
  const win = { __HBE_ACQ_EVENTS__: [] };
  const client = acq.createClient({
    window: win,
    document: doc,
    location: { href: 'https://hbexperts.com/about/', pathname: '/about/', search: '', hostname: 'hbexperts.com' },
    sessionStorage: storage,
    referrer: 'https://hbexperts.com/',
    now: () => '2026-09-03T20:00:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  const originalHref = 'https://buyer.hbexperts.com/questionnaire';
  const anchor = {
    href: originalHref,
    getAttribute(name) { return name === 'href' ? originalHref : null; }
  };
  client.handleAnchor(anchor);
  assert.equal(anchor.href, originalHref);
  assert.equal(new URL(anchor.href).search, '');
  assert.equal(win.__HBE_ACQ_EVENTS__.length, 1);
  const evt = win.__HBE_ACQ_EVENTS__[0];
  assert.equal(evt.event, 'journey_entry_click');
  assert.equal(evt.dest_path, '/questionnaire');
  assert.equal(evt.channel, 'referral');
  assert.equal(evt.page_path, '/about/');
  for (const key of Object.keys(evt)) {
    assert.equal(PII_KEYS.includes(key), false, 'pii key ' + key);
  }
});

test('consultation CTA fires consultation_cta_click without annotating', () => {
  const storage = memoryStorage();
  const doc = fakeDocument();
  const win = { __HBE_ACQ_EVENTS__: [] };
  const client = acq.createClient({
    window: win,
    document: doc,
    location: { href: 'https://hbexperts.com/', pathname: '/', search: '', hostname: 'hbexperts.com' },
    sessionStorage: storage,
    referrer: '',
    now: () => '2026-09-03T20:00:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  const href = 'https://hbexperts.com/strategy-session/';
  const anchor = {
    href,
    getAttribute(name) { return name === 'href' ? href : null; }
  };
  client.handleAnchor(anchor);
  assert.equal(anchor.href, href);
  assert.equal(win.__HBE_ACQ_EVENTS__[0].event, 'consultation_cta_click');
  assert.equal(win.__HBE_ACQ_EVENTS__[0].dest_path, '/strategy-session/');
});

test('first-touch is not overwritten on later internal navigation', () => {
  const storage = memoryStorage();
  const win = { __HBE_ACQ_EVENTS__: [] };
  const first = acq.createClient({
    window: win,
    document: fakeDocument(),
    location: { href: 'https://hbexperts.com/?utm_medium=cpc&utm_source=googleads', pathname: '/', search: '?utm_medium=cpc&utm_source=googleads', hostname: 'hbexperts.com' },
    sessionStorage: storage,
    referrer: '',
    now: () => '2026-09-03T20:00:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  first.recordDiscoveryView();
  assert.equal(JSON.parse(storage.getItem(acq.STORAGE_KEY)).channel, 'paid');
  const later = acq.createClient({
    window: win,
    document: fakeDocument(),
    location: { href: 'https://hbexperts.com/about/', pathname: '/about/', search: '', hostname: 'hbexperts.com' },
    sessionStorage: storage,
    referrer: 'https://hbexperts.com/',
    now: () => '2026-09-03T20:01:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  const payload = later.recordDiscoveryView();
  assert.equal(payload.channel, 'paid');
  assert.equal(JSON.parse(storage.getItem(acq.STORAGE_KEY)).channel, 'paid');
  assert.equal(JSON.parse(storage.getItem(acq.STORAGE_KEY)).landing_path, '/');
});

test('CF beacon stays off without a token', () => {
  const doc = fakeDocument();
  const client = acq.createClient({
    window: { __HBE_ACQ_EVENTS__: [] },
    document: doc,
    location: { href: 'https://hbexperts.com/', pathname: '/', search: '', hostname: 'hbexperts.com' },
    sessionStorage: memoryStorage(),
    referrer: '',
    now: () => '2026-09-03T20:00:00.000Z',
    CustomEvent: FakeCustomEvent
  });
  client.boot();
  assert.equal(doc._headChildren.length, 0);
});
