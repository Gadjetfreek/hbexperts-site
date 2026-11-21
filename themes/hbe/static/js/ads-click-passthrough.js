/**
 * Carry Google Ads click IDs from this public landing page onto the
 * Start Here link to buyer.hbexperts.com/, so the #108 Worker
 * passthrough can still store them. Allowlists only gclid, gbraid,
 * and wbraid. Does not add a _gl linker or copy any other params.
 */
(function (root) {
  'use strict';

  var KEYS = ['gclid', 'gbraid', 'wbraid'];
  var VALUE_RE = /^[A-Za-z0-9_-]{10,200}$/;
  var JOURNEY_HOST = 'buyer.hbexperts.com';
  var JOURNEY_PATH = '/';

  function readAllowedClickIds(search) {
    var params = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      if (!params.has(key)) continue;
      var value = params.get(key);
      if (typeof value === 'string' && VALUE_RE.test(value)) out[key] = value;
    }
    return out;
  }

  function isJourneyEntryUrl(url) {
    return url.protocol === 'https:'
      && url.hostname === JOURNEY_HOST
      && (url.pathname === JOURNEY_PATH || url.pathname === '');
  }

  function decorateJourneyUrl(href, clickIds) {
    if (!href || !clickIds || !Object.keys(clickIds).length) return href;
    var url;
    try { url = new URL(href, 'https://hbexperts.com/'); } catch (e) { return href; }
    if (!isJourneyEntryUrl(url)) return href;
    var changed = false;
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(clickIds, key)) continue;
      url.searchParams.set(key, clickIds[key]);
      changed = true;
    }
    return changed ? url.toString() : href;
  }

  function decorateLinks(doc, search) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
    var clickIds = readAllowedClickIds(search);
    if (!Object.keys(clickIds).length) return 0;
    var links = doc.querySelectorAll('a[href]');
    var count = 0;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var next = decorateJourneyUrl(link.getAttribute('href') || link.href, clickIds);
      if (next && next !== (link.getAttribute('href') || link.href)) {
        link.setAttribute('href', next);
        count += 1;
      }
    }
    return count;
  }

  var api = {
    KEYS: KEYS,
    VALUE_RE: VALUE_RE,
    readAllowedClickIds: readAllowedClickIds,
    decorateJourneyUrl: decorateJourneyUrl,
    decorateLinks: decorateLinks
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.HBEAdsClickPassthrough = api;

  var isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (isBrowser && !root.__HBE_ADS_CLICK_NOAUTO__) {
    var run = function () { api.decorateLinks(document, window.location.search); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
