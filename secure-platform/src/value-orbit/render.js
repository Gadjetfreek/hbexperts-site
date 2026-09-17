/**
 * Generic VALUE orbit → service-area visual (no tenant hard-coding).
 * Decorative only — never blocks CTAs; respects prefers-reduced-motion.
 */

function esc(v = '') {
  return String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** @param {object} config validated tenant config */
export function renderOrbitLayer(config) {
  const stages = config.stages || {};
  const orbit = stages.orbit_label || 'Earth';
  const region = stages.region_label || config.fallback_region;
  const local = stages.local_label || config.public_label;
  const disclaimer = config.approx_disclaimer || '';
  const mode = config.service_area_mode;
  const hub = config.service_area?.hub_label || '';
  const minutes = config.service_area?.minutes;

  // Ellipse radii are visual only — derived from mode without implying survey precision.
  let rx = 38;
  let ry = 26;
  if (mode === 'radius' && config.service_area?.miles) {
    rx = Math.min(48, 18 + Number(config.service_area.miles) / 4);
    ry = rx * 0.68;
  } else if (mode === 'drive_time' && minutes) {
    rx = Math.min(48, 20 + Number(minutes) / 5);
    ry = rx * 0.7;
  }

  const cx = 50 + (Number(config.center?.lng) || 0) * 0.02;
  const cy = 48 - (Number(config.center?.lat) || 0) * 0.08;

  return `
<aside class="vo-orbit" id="value-orbit" data-brokerage="${esc(config.brokerage_id)}" aria-label="Service area orientation">
  <div class="vo-fallback">
    <p class="vo-kicker">${esc(config.display_name)}</p>
    <p class="vo-title">${esc(config.public_label)}</p>
    ${disclaimer ? `<p class="vo-note">${esc(disclaimer)}</p>` : ''}
  </div>
  <div class="vo-stage" aria-hidden="true">
    <div class="vo-sky"></div>
    <svg class="vo-globe" viewBox="0 0 100 100" focusable="false">
      <defs>
        <radialGradient id="voGlow" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#7eb6ff"/>
          <stop offset="55%" stop-color="#1a4a8c"/>
          <stop offset="100%" stop-color="#0b1c33"/>
        </radialGradient>
      </defs>
      <circle class="vo-earth" cx="50" cy="50" r="36" fill="url(#voGlow)" stroke="#9ec5ff" stroke-width="0.4"/>
      <ellipse class="vo-land vo-land-a" cx="42" cy="46" rx="10" ry="14" fill="#2d5a3d" opacity="0.55"/>
      <ellipse class="vo-land vo-land-b" cx="58" cy="52" rx="8" ry="11" fill="#3a6b48" opacity="0.45"/>
      <ellipse class="vo-area" cx="${esc(cx.toFixed(1))}" cy="${esc(cy.toFixed(1))}" rx="${esc(rx.toFixed(1))}" ry="${esc(ry.toFixed(1))}" fill="rgba(201,168,76,0.28)" stroke="#c9a84c" stroke-width="0.6"/>
      <circle class="vo-hub" cx="${esc(cx.toFixed(1))}" cy="${esc(cy.toFixed(1))}" r="1.4" fill="#c9a84c"/>
    </svg>
    <ol class="vo-labels">
      <li data-step="orbit">${esc(orbit)}</li>
      <li data-step="region">${esc(region)}</li>
      <li data-step="local">${esc(local)}${hub ? ` · ${esc(hub)}` : ''}</li>
    </ol>
  </div>
</aside>`;
}

export const ORBIT_CSS = `<style id="value-orbit-css">
.vo-orbit{position:relative;width:min(40rem,100%);margin:0 auto 1rem;border:1px solid #e8e5e0;border-radius:14px;overflow:hidden;background:#0b1c33;color:#f4f7fb;text-align:center}
.vo-fallback{position:relative;z-index:2;padding:1rem 1.1rem .35rem}
.vo-kicker{margin:0;font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#9ec5ff}
.vo-title{margin:.35rem 0 0;font:600 1.05rem Georgia,serif;color:#fff}
.vo-note{margin:.45rem auto 0;max-width:32rem;font-size:.82rem;line-height:1.45;color:#c9d6e8}
.vo-stage{position:relative;height:11.5rem;pointer-events:none}
.vo-sky{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,#1a4a8c 0%,#0b1c33 55%,#050b14 100%)}
.vo-globe{position:absolute;left:50%;top:42%;width:13rem;height:13rem;transform:translate(-50%,-50%) scale(1.35);transform-origin:50% 50%}
.vo-labels{list-style:none;margin:0;padding:.25rem 0 .9rem;display:flex;justify-content:center;gap:.55rem;flex-wrap:wrap;position:relative;z-index:2}
.vo-labels li{font-size:.72rem;font-weight:700;letter-spacing:.04em;padding:.25rem .55rem;border-radius:999px;background:rgba(255,255,255,.08);color:#d7e6ff}
.vo-orbit[data-phase="orbit"] .vo-globe{transform:translate(-50%,-50%) scale(1.35)}
.vo-orbit[data-phase="region"] .vo-globe{transform:translate(-50%,-50%) scale(1.05)}
.vo-orbit[data-phase="local"] .vo-globe{transform:translate(-50%,-50%) scale(.82)}
.vo-orbit[data-phase="orbit"] .vo-area,.vo-orbit[data-phase="orbit"] .vo-hub{opacity:0}
.vo-orbit[data-phase="region"] .vo-area{opacity:.45}
.vo-orbit[data-phase="local"] .vo-area,.vo-orbit[data-phase="local"] .vo-hub{opacity:1}
.vo-globe,.vo-area,.vo-hub{transition:transform 1.1s ease,opacity .8s ease}
@media (prefers-reduced-motion:reduce){
  .vo-globe,.vo-area,.vo-hub{transition:none}
  .vo-orbit .vo-globe{transform:translate(-50%,-50%) scale(.82)}
  .vo-orbit .vo-area,.vo-orbit .vo-hub{opacity:1}
}
@media (max-width:600px){
  .vo-stage{height:10rem}
  .vo-globe{width:11rem;height:11rem}
}
</style>`;

export const ORBIT_JS = `<script id="value-orbit-js">
(()=>{
  const root=document.getElementById('value-orbit');
  if(!root)return;
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){root.setAttribute('data-phase','local');return;}
  const phases=['orbit','region','local'];
  let i=0;
  root.setAttribute('data-phase',phases[0]);
  const tick=()=>{i=Math.min(i+1,phases.length-1);root.setAttribute('data-phase',phases[i]);if(i<phases.length-1)setTimeout(tick,1600);};
  setTimeout(tick,900);
})();
</script>`;
