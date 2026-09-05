import appWorker from './issue29-convergence-worker.js';

// Production presentation wrapper for Issue #29.
// The convergence worker owns product behavior and persistence. This wrapper is
// intentionally limited to final copy/presentation refinements that do not
// change authorization, data boundaries, or journey state.
const MOBILE_UX_CSS = `<style id="hbe-mobile-ux-pass">
/* Keep future stages quieter without making their popovers translucent. */
.i29-stop.future{opacity:1!important}
.i29-stop.future>.i29-num,.i29-stop.future>div:not(.i29-peek){opacity:.62}

/* Popovers need to read like solid information cards, especially on phones. */
.i29-peek{
  background:#fff!important;
  color:#1a1a2e!important;
  border:2px solid rgba(26,26,46,.24)!important;
  box-shadow:0 18px 50px rgba(26,26,46,.28)!important;
}
.i29-peek li{color:#2c2c2c}

/* A single directional cue: do What's Next first; details stay optional. */
.i29-guide{
  display:flex;
  gap:.65rem;
  align-items:flex-start;
  margin:.9rem 0 1rem;
  padding:.8rem .9rem;
  border:1px solid #d8d4ca;
  border-left:4px solid #2d5a3d;
  border-radius:10px;
  background:#faf9f6;
  color:#2c2c2c;
  line-height:1.4;
}
.i29-guide strong{flex:0 0 auto;color:#1a1a2e}
.i29-guide span{font-size:.92rem}

@media(max-width:560px), (pointer:coarse){
  .i29-stop{min-height:auto}
  .i29-peek{
    position:relative!important;
    left:auto!important;
    bottom:auto!important;
    grid-column:1/-1;
    width:100%!important;
    margin-top:.7rem;
    transform:none!important;
    box-shadow:0 10px 28px rgba(26,26,46,.24)!important;
    display:none!important;
    opacity:1!important;
    visibility:visible!important;
    pointer-events:auto!important;
  }
  /* On touch/coarse-pointer devices, explicit .open is the only visibility state. */
  .i29-stop:hover .i29-peek,
  .i29-stop:focus .i29-peek,
  .i29-stop:focus-visible .i29-peek,
  .i29-stop:focus-within .i29-peek{display:none!important}
  .i29-stop.open .i29-peek{display:block!important}
  .i29-guide{display:block;padding:.75rem .8rem}
  .i29-guide strong{display:block;margin-bottom:.15rem}
}
</style>`;

const PUBLIC_JOURNEY_CSS = `<style id="hbe-public-journey-refine">
.value-context.hbe-value-public{
  justify-content:center;
  align-items:center;
  flex-direction:column;
  gap:.15rem;
  text-align:center;
  padding:.85rem 1rem;
}
.value-context.hbe-value-public .hbe-value-word{display:block;font-weight:900}
.value-context.hbe-value-public span{font-size:.9rem}
.value-context.hbe-value-public span b{font-weight:900;color:#2d5a3d}
.public-journey-stages{margin:1.25rem 0 0}
.public-journey-stages>summary{
  cursor:pointer;
  list-style:none;
  font-weight:850;
  color:#1a1a2e;
  padding:1rem 1.05rem;
  border:1px solid #e8e5e0;
  border-radius:12px;
  background:#fff;
}
.public-journey-stages>summary::-webkit-details-marker{display:none}
.public-journey-stages>summary:focus-visible{outline:3px solid rgba(45,90,61,.28);outline-offset:2px}
.public-journey-stages>summary:after{content:'+';float:right;color:#2d5a3d;font-size:1.2rem}
.public-journey-stages[open]>summary{border-radius:12px 12px 0 0;border-bottom-color:transparent}
.public-journey-stages[open]>summary:after{content:'–'}
.public-journey-stages .buyer-more-body{
  border:1px solid #e8e5e0;
  border-top:0;
  border-radius:0 0 12px 12px;
  padding:.25rem 1rem 1rem;
  background:#faf9f6;
}
@media(max-width:560px){
  .public-journey-stages>summary{padding:.9rem .85rem}
}
</style>`;

const MOBILE_UX_JS = `<script id="hbe-mobile-popup-stability">
(()=>{
  const coarse = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 560px)').matches;
  if(!coarse) return;

  const stops=[...document.querySelectorAll('[data-i29-stop]')];
  let lastTapAt=0;
  let lastTapStop=null;

  const sync = () => stops.forEach(s => s.setAttribute('aria-expanded', s.classList.contains('open') ? 'true' : 'false'));
  const closeOthers = current => stops.forEach(s => { if(s!==current) s.classList.remove('open'); });

  stops.forEach(stop => {
    stop.addEventListener('click', e => {
      if(e.target.closest('[data-open-checklist]')) return;
      if(e.target.closest('.i29-peek')) {
        e.stopImmediatePropagation();
        return;
      }

      const now=Date.now();
      if(lastTapStop===stop && now-lastTapAt<350){
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      lastTapAt=now;
      lastTapStop=stop;

      e.preventDefault();
      e.stopImmediatePropagation();
      const wasOpen=stop.classList.contains('open');
      closeOthers(stop);
      stop.classList.toggle('open', !wasOpen);
      sync();
    }, true);
  });

  document.addEventListener('click', e => {
    if(e.target.closest('[data-i29-stop]')) return;
    stops.forEach(s=>s.classList.remove('open'));
    sync();
  }, true);

  sync();
})();
</script>`;

const START_HERE = `<div class="i29-guide" role="note"><strong>Start here.</strong><span>Do the What’s Next item first. Open your current stage when you want the details. Everything else is context, not homework.</span></div>`;
const PUBLIC_VALUE = `<div class="value-context hbe-value-public"><strong class="hbe-value-word">VALUE</strong><span><b>V</b>alues · <b>A</b>lternatives · <b>L</b>earning · <b>U</b>ncertainty · <b>E</b>vidence</span></div>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';

    if (!type.includes('text/html')) return response;

    let text = await response.text();

    // Remove stale invitation wording after the buyer-mail-app flow shipped.
    text = text.replace(
      'Email delivery of this invitation is an architecture blocker until a verified sending domain and the HBE_ALERT Send Email binding are enabled. Until then, share the copyable link. Do not enter the other buyer’s email here.',
      'Create the private invitation, then email the secure link from your own mail app or copy it to share another way. HBE does not collect the other buyer’s email here.'
    );

    // Reduce repeated explanatory language while preserving the deeper detail.
    text = text
      .replace('Highest priority right now', 'Do this next')
      .replace('Empty-state fallback is still a useful HBE action', 'Best next HBE action')
      .replace('Empty-state fallback is still a useful buyer action', 'Best next step')
      .replace('From a checklist item that created this action', 'From your current checklist')
      .replace('Highest-priority open task', 'Highest priority');

    if (request.method === 'GET' && url.pathname === '/') {
      text = refinePublicJourney(text);
    }

    // Put one clear directional cue immediately before the primary action area.
    if (text.includes('<section class="i29-next" id="whats-next">') && !text.includes('class="i29-guide"')) {
      text = text.replace('<section class="i29-next" id="whats-next">', `${START_HERE}<section class="i29-next" id="whats-next">`);
    }

    if (!text.includes('id="hbe-mobile-ux-pass"')) {
      text = text.replace('</head>', `${MOBILE_UX_CSS}</head>`);
    }
    if (request.method === 'GET' && url.pathname === '/' && !text.includes('id="hbe-public-journey-refine"')) {
      text = text.replace('</head>', `${PUBLIC_JOURNEY_CSS}</head>`);
    }
    if (!text.includes('id="hbe-mobile-popup-stability"')) {
      text = text.replace('</body>', `${MOBILE_UX_JS}</body>`);
    }

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

export function refinePublicJourney(text) {
  text = text
    .replaceAll('Begin the Buyer Experience', 'Start My Buyer Experience')
    .replaceAll('Start the Buyer Experience', 'Start My Buyer Experience')
    .replaceAll('Start the Experience', 'Start My Buyer Experience')
    .replaceAll('Open my BuyerUI', 'Open my Buyer Portal');

  text = text.replace(
    'Your HomeBuyer journey, from first questions to keys.',
    'You are here: Buyer Experience.'
  );
  text = text.replace(
    'Your HomeBuyer journey, from first questions to keys and beyond.',
    'You are here: Buyer Experience.'
  );
  text = text.replace(
    '<div class="value-context"><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div>',
    PUBLIC_VALUE
  );
  return wrapPublicRoadmapInDisclosure(text);
}

/** Keep the 17-stage map via progressive disclosure instead of deleting it. */
export function wrapPublicRoadmapInDisclosure(text) {
  const mapStart = text.indexOf('<div class="i29-map"');
  if (mapStart < 0) return text;

  // Already wrapped (idempotent).
  const before = text.slice(Math.max(0, mapStart - 280), mapStart);
  if (/public-journey-stages|See all 17 stages/i.test(before)) {
    return text;
  }

  const actionsStart = text.indexOf('<div class="actions">', mapStart);
  const searchLimit = actionsStart > 0 ? actionsStart : text.length;

  const divTag = /<\/?div\b[^>]*>/g;
  divTag.lastIndex = mapStart;
  let depth = 0;
  let mapEnd = -1;
  let match;

  while ((match = divTag.exec(text)) && match.index < searchLimit) {
    if (match[0].startsWith('</div')) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      mapEnd = divTag.lastIndex;
      break;
    }
  }

  if (mapEnd < 0) return text;

  const mapHtml = text.slice(mapStart, mapEnd);
  const wrapped = `<details class="buyer-more public-journey-stages" id="public-journey-stages"><summary>See all 17 stages</summary><div class="buyer-more-body">${mapHtml}</div></details>`;

  // Drop leftover legacy map fragments between i29-map and actions (or insert in place).
  const insertAt = actionsStart > 0 ? actionsStart : mapEnd;
  return `${text.slice(0, mapStart)}${wrapped}${text.slice(insertAt)}`;
}

