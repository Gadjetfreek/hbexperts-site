import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const passthrough = require('./ads-click-passthrough.js');

const SYNTH_GCLID = 'TeSt_GcLiD-0123456789abcXYZ';
const SYNTH_GBRAID = '0AAAAA-synthetic_1';
const SYNTH_WBRAID = 'CkSynthetic_wbraid1';
const JOURNEY = 'https://buyer.hbexperts.com/';

test('readAllowedClickIds keeps only valid gclid, gbraid, and wbraid', () => {
  const ids = passthrough.readAllowedClickIds(
    `?gclid=${SYNTH_GCLID}&gbraid=${SYNTH_GBRAID}&wbraid=${SYNTH_WBRAID}&email=buyer@example.com&utm_campaign=paid&_gl=1*abc*_gcl_aw*xyz`
  );
  assert.deepEqual(ids, {
    gclid: SYNTH_GCLID,
    gbraid: SYNTH_GBRAID,
    wbraid: SYNTH_WBRAID
  });
  assert.deepEqual(Object.keys(ids), ['gclid', 'gbraid', 'wbraid']);
  assert.deepEqual(passthrough.readAllowedClickIds('?gclid=short&email=buyer@example.com'), {});
  assert.deepEqual(passthrough.readAllowedClickIds(`?gclid=${encodeURIComponent('abc<script>12345')}`), {});
  assert.deepEqual(passthrough.readAllowedClickIds(''), {});
});

test('decorateJourneyUrl forwards exactly the allowlisted params onto the journey entry URL', () => {
  const ids = { gclid: SYNTH_GCLID, gbraid: SYNTH_GBRAID };
  const out = passthrough.decorateJourneyUrl(JOURNEY, ids);
  const url = new URL(out);
  assert.equal(url.origin + url.pathname, 'https://buyer.hbexperts.com/');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['gbraid', 'gclid']);
  assert.equal(url.searchParams.get('gclid'), SYNTH_GCLID);
  assert.equal(url.searchParams.get('gbraid'), SYNTH_GBRAID);
  assert.equal(url.searchParams.get('email'), null);
  assert.equal(url.searchParams.get('_gl'), null);

  const withExisting = passthrough.decorateJourneyUrl(`${JOURNEY}?hbe_ch=paid`, { gclid: SYNTH_GCLID });
  const kept = new URL(withExisting);
  assert.deepEqual([...kept.searchParams.keys()].sort(), ['gclid', 'hbe_ch']);
  assert.equal(kept.searchParams.get('hbe_ch'), 'paid');

  assert.equal(passthrough.decorateJourneyUrl('https://hbexperts.com/start/', ids), 'https://hbexperts.com/start/');
  assert.equal(passthrough.decorateJourneyUrl('https://buyer.hbexperts.com/questionnaire', ids), 'https://buyer.hbexperts.com/questionnaire');
  assert.equal(passthrough.decorateJourneyUrl('https://example.com/', ids), 'https://example.com/');
  assert.equal(passthrough.decorateJourneyUrl(JOURNEY, {}), JOURNEY);
});

test('decorateLinks updates journey entry anchors and ignores every other href', () => {
  const anchors = [
    { href: JOURNEY, attr: JOURNEY },
    { href: 'https://buyer.hbexperts.com/portal', attr: 'https://buyer.hbexperts.com/portal' },
    { href: 'https://hbexperts.com/privacy/', attr: 'https://hbexperts.com/privacy/' },
    { href: `${JOURNEY}?hbe_ch=paid`, attr: `${JOURNEY}?hbe_ch=paid` }
  ].map(item => ({
    href: item.href,
    getAttribute(name) { return name === 'href' ? item.attr : null; },
    setAttribute(name, value) { if (name === 'href') item.attr = value; }
  }));
  const doc = { querySelectorAll(sel) { assert.equal(sel, 'a[href]'); return anchors; } };
  const count = passthrough.decorateLinks(doc, `?gclid=${SYNTH_GCLID}&email=buyer@example.com`);
  assert.equal(count, 2);
  assert.match(anchors[0].getAttribute('href'), new RegExp(`gclid=${SYNTH_GCLID}`));
  assert.equal(anchors[1].getAttribute('href'), 'https://buyer.hbexperts.com/portal');
  assert.equal(anchors[2].getAttribute('href'), 'https://hbexperts.com/privacy/');
  const kept = new URL(anchors[3].getAttribute('href'));
  assert.equal(kept.searchParams.get('hbe_ch'), 'paid');
  assert.equal(kept.searchParams.get('gclid'), SYNTH_GCLID);
  assert.equal(kept.searchParams.get('email'), null);
});
