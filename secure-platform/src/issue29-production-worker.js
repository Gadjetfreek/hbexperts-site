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

export default {
  async fetch(request, env, ctx) {
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

    // Put one clear directional cue immediately before the primary action area.
    if (text.includes('<section class="i29-next" id="whats-next">') && !text.includes('class="i29-guide"')) {
      text = text.replace('<section class="i29-next" id="whats-next">', `${START_HERE}<section class="i29-next" id="whats-next">`);
    }

    if (!text.includes('id="hbe-mobile-ux-pass"')) {
      text = text.replace('</head>', `${MOBILE_UX_CSS}</head>`);
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
