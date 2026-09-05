import { ORBIT_CSS, ORBIT_JS, renderOrbitLayer } from './render.js';
import hbe from './tenants/hbe.js';

const MODE = new Set(['drive_time', 'counties', 'radius', 'custom_polygon']);

/** Registry of bundled tenants. Next brokerage = add a module + registry entry. */
const TENANTS = Object.freeze({
  hbe
});

export function listBundledTenants() {
  return Object.keys(TENANTS);
}

/** Load a bundled tenant config by brokerage_id. */
export function loadTenantConfig(brokerageId) {
  const id = String(brokerageId || '').trim();
  const config = TENANTS[id];
  if (!config) throw new Error(`unknown brokerage_id: ${id}`);
  return validateTenantConfig(config);
}

/** Validate minimal schema (full JSON Schema in schema.json). */
export function validateTenantConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('config required');
  for (const key of ['brokerage_id', 'display_name', 'service_area_mode', 'public_label', 'fallback_region']) {
    if (!String(config[key] || '').trim()) throw new Error(`missing ${key}`);
  }
  if (!MODE.has(config.service_area_mode)) throw new Error('invalid service_area_mode');
  const { lat, lng } = config.center || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('center.lat/lng required');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('center out of range');
  if (config.service_area == null) throw new Error('service_area required');
  return config;
}

/**
 * Inject orbit layer into Buyer Journey HTML for one tenant.
 * Idempotent. Does not alter CTA markup.
 */
export function enhanceJourneyWithOrbit(html, config) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('id="value-orbit"')) return html;
  const cfg = validateTenantConfig(config);
  const layer = renderOrbitLayer(cfg);

  let out = html;
  if (!out.includes('id="value-orbit-css"')) {
    out = out.includes('</head>')
      ? out.replace('</head>', `${ORBIT_CSS}</head>`)
      : `${ORBIT_CSS}${out}`;
  }

  if (/<main\b[^>]*journey-landing[^>]*>/i.test(out)) {
    out = out.replace(/(<main\b[^>]*journey-landing[^>]*>)/i, `$1${layer}`);
  } else if (/class="[^"]*hero[^"]*"/i.test(out)) {
    out = out.replace(/(<section\b[^>]*class="[^"]*hero[^"]*"[^>]*>[\s\S]*?<\/section>)/i, `$1${layer}`);
  } else if (out.includes('<main')) {
    out = out.replace(/(<main\b[^>]*>)/i, `$1${layer}`);
  } else {
    return html;
  }

  if (!out.includes('id="value-orbit-js"')) {
    out = out.includes('</body>')
      ? out.replace('</body>', `${ORBIT_JS}</body>`)
      : `${out}${ORBIT_JS}`;
  }
  return out;
}

/** Convenience: enhance with a bundled tenant id (default hbe). */
export function enhanceJourneyForTenant(html, brokerageId = 'hbe') {
  return enhanceJourneyWithOrbit(html, loadTenantConfig(brokerageId));
}
