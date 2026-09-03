/**
 * HBE public-site acquisition instrumentation foundation (first-party, privacy-safe).
 *
 * This is a client-side instrumentation foundation, not completed acquisition
 * measurement. Coarse discovery and CTA events (pathname, channel, sanitized
 * UTM tokens, referrer host) stay session/in-memory only: CustomEvent
 * `hbe:acquisition`, sessionStorage first-touch, and an in-memory ring buffer.
 * No network collector ships here; a later gated collector may subscribe.
 * Optional Cloudflare Web Analytics is a separate pageview product and does
 * not receive these custom events.
 *
 * No names, emails, phones, questionnaire answers, household IDs, cookies,
 * or localStorage. Journey URLs are left clean (no hbe_ch / hbe_lp / hbe_ft)
 * until a secure-side consumer exists.
 *
 * Channel heuristics (see docs/ACQUISITION_MEASUREMENT.md):
 *   relocation / local — ONLY when utm_campaign or utm_content contains that
 *     token (explicit coarse tagging). Never inferred from geo or copy.
 *   paid — utm_medium in cpc/ppc/paid/paid_social/display/ads (and close
 *     variants) OR utm_source looks like an ad platform (googleads, fb,
 *     meta, bing, ...)
 *   organic — referrer host is a known search engine OR utm_medium=organic
 *   referral — external referrer host that is not a search engine
 *   direct — no surviving UTM tokens and no external referrer
 *   unknown — fallback
 *
 * Explicit local/relocation tokens take precedence over paid/organic/referral.
 * Same-site referrers are ignored. First-touch is stored in sessionStorage
 * key hbe_acq_v1 and is not overwritten during the session.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'hbe_acq_v1';
  var MAX_EVENTS = 20;
  var MAX_UTM_LEN = 64;
  var MAX_PATH_LEN = 128;
  var MAX_HOST_LEN = 253;
  var CHANNELS = ['paid', 'referral', 'local', 'relocation', 'organic', 'direct', 'unknown'];
  var PAYLOAD_KEYS = [
    'event', 'page_path', 'channel', 'utm_source', 'utm_medium',
    'utm_campaign', 'referrer_host', 'ts', 'dest_path'
  ];
  var JOURNEY_HOST = 'buyer.hbexperts.com';
  var CONSULTATION_PATHS = { '/strategy-session': 1, '/contact': 1 };

  var PAID_MEDIUMS = {
    cpc: 1, ppc: 1, paid: 1, paid_social: 1, 'paid-social': 1, paidsocial: 1,
    display: 1, ads: 1, cpm: 1, cpa: 1, paidsearch: 1, 'paid-search': 1,
    'paid search': 1
  };
  var PAID_SOURCES = {
    googleads: 1, google_ads: 1, 'google-ads': 1, adwords: 1, gads: 1,
    fb: 1, facebook: 1, meta: 1, instagram: 1, ig: 1,
    bing: 1, bingads: 1, 'bing-ads': 1,
    tiktok: 1, linkedin: 1, twitter: 1, pinterest: 1
  };

  function looksLikeEmail(value) {
    return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(value || ''));
  }

  function looksLikePhone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  function sanitizeUtm(value) {
    if (value == null) return '';
    var s = String(value).trim();
    if (!s) return '';
    if (/@/.test(s) || looksLikeEmail(s)) return '';
    if (looksLikePhone(s)) return '';
    if (/^https?:\/\//i.test(s)) return '';
    if (/[\u0000-\u001f]/.test(s)) return '';
    if (s.length > MAX_UTM_LEN) s = s.slice(0, MAX_UTM_LEN);
    return s;
  }

  function sanitizePath(value) {
    if (value == null) return '';
    var s = String(value).split('?')[0].split('#')[0].trim();
    if (!s) return '';
    if (s.charAt(0) !== '/') s = '/' + s;
    if (s.length > MAX_PATH_LEN) s = s.slice(0, MAX_PATH_LEN);
    if (s.indexOf('..') !== -1) return '';
    if (!/^\/[A-Za-z0-9/_\-.~]*$/.test(s)) return '';
    return s;
  }

  function pagePath(value) {
    var s = sanitizePath(value);
    return s || '/';
  }

  function normalizeChannel(value) {
    var c = String(value || '').toLowerCase();
    for (var i = 0; i < CHANNELS.length; i++) {
      if (CHANNELS[i] === c) return c;
    }
    return 'unknown';
  }

  function sameSite(host, siteHost) {
    if (!host || !siteHost) return false;
    host = String(host).toLowerCase();
    siteHost = String(siteHost).toLowerCase();
    if (host === siteHost) return true;
    if (host === 'www.' + siteHost || siteHost === 'www.' + host) return true;
    return false;
  }

  function referrerHost(referrer, siteHost) {
    if (!referrer) return '';
    try {
      var u = new URL(String(referrer));
      var host = (u.hostname || '').toLowerCase();
      if (!host) return '';
      if (sameSite(host, siteHost)) return '';
      if (host.length > MAX_HOST_LEN) host = host.slice(0, MAX_HOST_LEN);
      return host;
    } catch (err) {
      return '';
    }
  }

  function isSearchEngineHost(host) {
    if (!host) return false;
    var h = String(host).toLowerCase();
    if (/(^|\.)google\.[a-z.]+$/.test(h)) return true;
    if (/(^|\.)bing\.com$/.test(h)) return true;
    if (/(^|\.)yahoo\.[a-z.]+$/.test(h)) return true;
    if (/(^|\.)duckduckgo\.com$/.test(h)) return true;
    if (/(^|\.)baidu\.[a-z.]+$/.test(h)) return true;
    if (/(^|\.)yandex\.[a-z.]+$/.test(h)) return true;
    if (/(^|\.)brave\.com$/.test(h)) return true;
    if (/(^|\.)ecosia\.org$/.test(h)) return true;
    if (/(^|\.)startpage\.com$/.test(h)) return true;
    return false;
  }

  function tokenList(value) {
    return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function hasCampaignToken(utms, token) {
    var fields = [(utms && utms.utm_campaign) || '', (utms && utms.utm_content) || ''];
    for (var i = 0; i < fields.length; i++) {
      var tokens = tokenList(fields[i]);
      for (var j = 0; j < tokens.length; j++) {
        if (tokens[j] === token) return true;
      }
    }
    return false;
  }

  function hasAnyUtm(utms) {
    if (!utms) return false;
    return !!(utms.utm_source || utms.utm_medium || utms.utm_campaign || utms.utm_content || utms.utm_term);
  }

  function classifyChannel(utms, host) {
    utms = utms || {};
    host = host || '';
    if (hasCampaignToken(utms, 'relocation')) return 'relocation';
    if (hasCampaignToken(utms, 'local')) return 'local';
    var medium = String(utms.utm_medium || '').toLowerCase();
    var source = String(utms.utm_source || '').toLowerCase();
    if (PAID_MEDIUMS[medium] || PAID_SOURCES[source]) return 'paid';
    if (medium === 'organic' || isSearchEngineHost(host)) return 'organic';
    if (host && !isSearchEngineHost(host)) return 'referral';
    if (!hasAnyUtm(utms) && !host) return 'direct';
    return 'unknown';
  }

  function readUtms(search) {
    var params;
    try {
      params = new URLSearchParams(search || '');
    } catch (err) {
      return {};
    }
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var clean = sanitizeUtm(params.get(keys[i]));
      if (clean) out[keys[i]] = clean;
    }
    return out;
  }

  function buildPayload(eventName, ctx) {
    ctx = ctx || {};
    var payload = {
      event: String(eventName || ''),
      page_path: pagePath(ctx.page_path),
      channel: normalizeChannel(ctx.channel),
      ts: ctx.ts || new Date().toISOString()
    };
    var source = sanitizeUtm(ctx.utm_source);
    var medium = sanitizeUtm(ctx.utm_medium);
    var campaign = sanitizeUtm(ctx.utm_campaign);
    var host = ctx.referrer_host ? String(ctx.referrer_host).toLowerCase().slice(0, MAX_HOST_LEN) : '';
    if (source) payload.utm_source = source;
    if (medium) payload.utm_medium = medium;
    if (campaign) payload.utm_campaign = campaign;
    if (host && host.indexOf('..') === -1) payload.referrer_host = host;
    if (ctx.dest_path) {
      var dest = sanitizePath(ctx.dest_path);
      if (dest) payload.dest_path = dest;
    }
    var allowed = {};
    for (var i = 0; i < PAYLOAD_KEYS.length; i++) {
      var k = PAYLOAD_KEYS[i];
      if (Object.prototype.hasOwnProperty.call(payload, k) && payload[k] !== '' && payload[k] != null) {
        allowed[k] = payload[k];
      }
    }
    return allowed;
  }

  function shouldAnnotateJourneyLink(url) {
    if (!url) return false;
    var parsed = url;
    if (typeof url === 'string') {
      try { parsed = new URL(url, 'https://' + JOURNEY_HOST); } catch (err) { return false; }
    }
    var protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return String(parsed.hostname || '').toLowerCase() === JOURNEY_HOST;
  }

  function normalizeHrefPath(url) {
    var path = (url && url.pathname) ? url.pathname : '/';
    return path.replace(/\/+$/, '') || '/';
  }

  function isConsultationCta(url, siteHost) {
    if (!url) return false;
    var parsed = url;
    if (typeof url === 'string') {
      try { parsed = new URL(url, 'https://' + (siteHost || 'hbexperts.com')); } catch (err) { return false; }
    }
    var protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    var host = String(parsed.hostname || '').toLowerCase();
    if (siteHost && host && !sameSite(host, siteHost)) return false;
    return !!CONSULTATION_PATHS[normalizeHrefPath(parsed)];
  }

  function annotateJourneyUrl(href) {
    // No-op: leave buyer.hbexperts.com URLs clean until a secure-side
    // consumer exists. Custom events stay session/in-memory only.
    return href;
  }

  function readFirstTouch(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      parsed.channel = normalizeChannel(parsed.channel);
      parsed.landing_path = sanitizePath(parsed.landing_path) || '/';
      if (parsed.utm_source) parsed.utm_source = sanitizeUtm(parsed.utm_source);
      if (parsed.utm_medium) parsed.utm_medium = sanitizeUtm(parsed.utm_medium);
      if (parsed.utm_campaign) parsed.utm_campaign = sanitizeUtm(parsed.utm_campaign);
      if (parsed.referrer_host) parsed.referrer_host = String(parsed.referrer_host).toLowerCase();
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeFirstTouch(storage, record) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (err) { /* private mode / quota — do not break the page */ }
  }

  function pushRing(win, payload) {
    if (!win) return;
    var buf = win.__HBE_ACQ_EVENTS__;
    if (!Array.isArray(buf)) buf = [];
    buf.push(payload);
    while (buf.length > MAX_EVENTS) buf.shift();
    win.__HBE_ACQ_EVENTS__ = buf;
  }

  function cfTokenLooksSafe(token) {
    var s = String(token || '').trim();
    if (!s || s.length < 16 || s.length > 64) return '';
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return '';
    return s;
  }

  function readCfToken(doc) {
    if (!doc) return '';
    try {
      var meta = doc.querySelector && doc.querySelector('meta[name="hbe-cf-wa-token"]');
      if (meta && meta.getAttribute) {
        var fromMeta = cfTokenLooksSafe(meta.getAttribute('content'));
        if (fromMeta) return fromMeta;
      }
      var el = doc.documentElement;
      if (el && el.getAttribute) {
        var fromData = cfTokenLooksSafe(el.getAttribute('data-cf-wa-token'));
        if (fromData) return fromData;
      }
    } catch (err) { /* ignore */ }
    return '';
  }

  function maybeLoadCfBeacon(doc, token) {
    if (!doc || !token) return false;
    try {
      if (doc.querySelector && doc.querySelector('script[data-cf-beacon], script[src*="cloudflareinsights.com/beacon"]')) {
        return false;
      }
      if (!doc.head || !doc.createElement) return false;
      var s = doc.createElement('script');
      s.defer = true;
      s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      s.setAttribute('data-cf-beacon', JSON.stringify({ token: token }));
      doc.head.appendChild(s);
      return true;
    } catch (err) {
      return false;
    }
  }

  function nowIso(clock) {
    if (typeof clock === 'function') return clock();
    return new Date().toISOString();
  }

  function createClient(env) {
    env = env || {};
    var win = env.window || (typeof window !== 'undefined' ? window : root);
    var doc = env.document || (typeof document !== 'undefined' ? document : null);
    var loc = env.location || (win && win.location) || null;
    var storage = env.sessionStorage;
    if (storage == null && win && win.sessionStorage) storage = win.sessionStorage;
    var clock = env.now;

    function emit(payload) {
      pushRing(win, payload);
      if (doc && typeof doc.dispatchEvent === 'function') {
        try {
          var Evt = (env.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null));
          if (Evt) doc.dispatchEvent(new Evt('hbe:acquisition', { detail: payload, bubbles: true }));
        } catch (err) { /* ignore */ }
      }
      try {
        var sink = win && win.__HBE_ACQ__;
        if (sink && typeof sink.send === 'function') sink.send(payload);
      } catch (err) { /* ignore */ }
      return payload;
    }

    function currentContext() {
      var search = (loc && loc.search) || '';
      var path = pagePath((loc && loc.pathname) || '/');
      var siteHost = (loc && loc.hostname) || '';
      var utms = readUtms(search);
      var ref = referrerHost(env.referrer != null ? env.referrer : (doc && doc.referrer) || '', siteHost);
      var channel = classifyChannel(utms, ref);
      var first = readFirstTouch(storage);
      var weak = (channel === 'direct') || (channel === 'unknown' && !hasAnyUtm(utms) && !ref);
      if (first && weak) channel = first.channel || channel;
      if (!first) {
        first = {
          v: 1,
          channel: channel,
          landing_path: path,
          ts: nowIso(clock)
        };
        if (utms.utm_source) first.utm_source = utms.utm_source;
        if (utms.utm_medium) first.utm_medium = utms.utm_medium;
        if (utms.utm_campaign) first.utm_campaign = utms.utm_campaign;
        if (ref) first.referrer_host = ref;
        writeFirstTouch(storage, first);
      }
      return {
        page_path: path,
        channel: channel,
        utm_source: utms.utm_source,
        utm_medium: utms.utm_medium,
        utm_campaign: utms.utm_campaign,
        referrer_host: ref,
        first_touch: first,
        siteHost: siteHost
      };
    }

    function recordDiscoveryView() {
      var ctx = currentContext();
      return emit(buildPayload('discovery_view', {
        page_path: ctx.page_path,
        channel: ctx.channel,
        utm_source: ctx.utm_source,
        utm_medium: ctx.utm_medium,
        utm_campaign: ctx.utm_campaign,
        referrer_host: ctx.referrer_host,
        ts: nowIso(clock)
      }));
    }

    function handleAnchor(anchor) {
      if (!anchor || !anchor.getAttribute) return;
      var href = anchor.getAttribute('href');
      if (!href) return;
      var parsed;
      try {
        parsed = new URL(href, (loc && loc.href) || ('https://' + ((loc && loc.hostname) || 'hbexperts.com') + '/'));
      } catch (err) {
        return;
      }
      var ctx = currentContext();
      var eventName = null;
      if (shouldAnnotateJourneyLink(parsed)) {
        eventName = 'journey_entry_click';
      } else if (isConsultationCta(parsed, ctx.siteHost)) {
        eventName = 'consultation_cta_click';
      }
      if (!eventName) return;
      emit(buildPayload(eventName, {
        page_path: ctx.page_path,
        channel: ctx.channel,
        utm_source: ctx.utm_source,
        utm_medium: ctx.utm_medium,
        utm_campaign: ctx.utm_campaign,
        referrer_host: ctx.referrer_host,
        dest_path: parsed.pathname,
        ts: nowIso(clock)
      }));
    }

    function onClick(e) {
      var t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      var a = t.closest('a[href]');
      if (a) handleAnchor(a);
    }

    function boot() {
      if (win && !Array.isArray(win.__HBE_ACQ_EVENTS__)) win.__HBE_ACQ_EVENTS__ = [];
      maybeLoadCfBeacon(doc, readCfToken(doc));
      recordDiscoveryView();
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('click', onClick, false);
      }
    }

    return {
      boot: boot,
      recordDiscoveryView: recordDiscoveryView,
      handleAnchor: handleAnchor,
      currentContext: currentContext,
      emit: emit
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_EVENTS: MAX_EVENTS,
    CHANNELS: CHANNELS,
    PAYLOAD_KEYS: PAYLOAD_KEYS,
    looksLikeEmail: looksLikeEmail,
    looksLikePhone: looksLikePhone,
    sanitizeUtm: sanitizeUtm,
    sanitizePath: sanitizePath,
    pagePath: pagePath,
    referrerHost: referrerHost,
    isSearchEngineHost: isSearchEngineHost,
    classifyChannel: classifyChannel,
    readUtms: readUtms,
    buildPayload: buildPayload,
    shouldAnnotateJourneyLink: shouldAnnotateJourneyLink,
    isConsultationCta: isConsultationCta,
    annotateJourneyUrl: annotateJourneyUrl,
    readFirstTouch: readFirstTouch,
    createClient: createClient,
    boot: function (env) { return createClient(env).boot(); }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.HBEAcquisition = api;

  var isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (isBrowser && !root.__HBE_ACQ_NOAUTO__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { api.boot(); });
    } else {
      api.boot();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
