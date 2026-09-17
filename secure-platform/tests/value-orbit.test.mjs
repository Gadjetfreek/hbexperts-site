import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  enhanceJourneyForTenant,
  enhanceJourneyWithOrbit,
  listBundledTenants,
  loadTenantConfig,
  validateTenantConfig
} from '../src/value-orbit/index.js';
import { renderOrbitLayer } from '../src/value-orbit/render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('HBE tenant config validates and is the only bundled tenant for now', () => {
  const cfg = loadTenantConfig('hbe');
  assert.equal(cfg.brokerage_id, 'hbe');
  assert.equal(cfg.service_area_mode, 'drive_time');
  assert.match(cfg.approx_disclaimer, /approximate/i);
  assert.deepEqual(listBundledTenants(), ['hbe']);
});

test('renderer core does not hard-code Akron/Ohio — only tenant config does', () => {
  const src = readFileSync(join(root, 'src/value-orbit/render.js'), 'utf8');
  assert.doesNotMatch(src, /Akron|Ohio|41\.0814/);
  const fake = validateTenantConfig({
    brokerage_id: 'demo',
    display_name: 'Demo Brokerage',
    center: { lat: 33.75, lng: -84.39 },
    service_area_mode: 'radius',
    service_area: { miles: 25 },
    public_label: 'Metro Demo service region',
    fallback_region: 'Demo Metro',
    stages: { orbit_label: 'Earth', region_label: 'Southeast', local_label: 'Demo hub' }
  });
  const html = renderOrbitLayer(fake);
  assert.match(html, /Demo Brokerage/);
  assert.match(html, /Metro Demo service region/);
  assert.doesNotMatch(html, /Akron|Northeast Ohio/);
});

test('enhanceJourneyWithOrbit inserts layer without removing Start CTA', () => {
  const page = `<!doctype html><html><head></head><body>
  <section class="hero journey-hero"><h1>Buyer Journey</h1></section>
  <main class="wrap journey-landing">
    <div class="journey-action"><a class="btn primary" href="/questionnaire">Start My Buyer Experience</a>
    <p class="journey-trust">Nothing is sent until you review and send it.</p>
    <a class="btn ghost" href="/login">Open my Buyer Portal</a></div>
  </main></body></html>`;
  const out = enhanceJourneyForTenant(page, 'hbe');
  assert.match(out, /id="value-orbit"/);
  assert.match(out, /data-brokerage="hbe"/);
  assert.match(out, /Start My Buyer Experience/);
  assert.match(out, /prefers-reduced-motion/);
  assert.match(out, /approximate/i);
  assert.doesNotMatch(out, /geolocation|getCurrentPosition/i);
  // idempotent
  assert.equal(enhanceJourneyForTenant(out, 'hbe'), out);
});

test('JSON tenant file stays aligned with JS registry for HBE', () => {
  const json = JSON.parse(readFileSync(join(root, 'src/value-orbit/tenants/hbe.json'), 'utf8'));
  const js = loadTenantConfig('hbe');
  assert.equal(json.brokerage_id, js.brokerage_id);
  assert.equal(json.center.lat, js.center.lat);
  assert.equal(json.service_area.minutes, js.service_area.minutes);
});

test('issue33 wires orbit enhance on Journey root only', () => {
  const src = readFileSync(join(root, 'src/issue33-production-worker.js'), 'utf8');
  assert.match(src, /enhanceJourneyForTenant/);
  assert.match(src, /value-orbit/);
});
