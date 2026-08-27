import appWorker from './pilot-worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await appWorker.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    const type = headers.get('content-type') || '';
    if (!type.includes('text/html')) return response;

    let text = await response.text();

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/questionnaire' || url.pathname === '/login')) {
      text = addValueContext(text);
    }

    if (request.method === 'GET' && url.pathname === '/portal' && response.status === 200) {
      text = addPortalValuePanel(text);
    }

    if (request.method === 'GET' && url.pathname === '/hbe' && response.status === 200) {
      text = addHbeValueStrip(text);
    }

    text = text.replace('</head>', `${VALUE_CSS}</head>`);
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }
};

function addValueContext(text) {
  const line = '<div class="value-context"><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div>';
  if (text.includes('<main')) return text.replace(/(<main[^>]*>)/, `$1${line}`);
  return text.replace('<body>', `<body>${line}`);
}

function addPortalValuePanel(text) {
  const panel = `<section class="value-portal-panel"><div class="value-kicker">YOUR VALUE RECORD</div><h2>Price tells you what a home costs. VALUE helps you decide what that cost means to you.</h2><p><strong>Values · Alternatives · Learning · Uncertainty · Evidence</strong></p><p>This record is meant to evolve as you see homes, learn new facts, uncover uncertainty, and understand your own priorities more clearly. VALUE does not choose for you. It helps keep the choice visible.</p></section>`;
  return injectBeforeMainEnd(text, panel);
}

function addHbeValueStrip(text) {
  const panel = `<section class="value-hbe-strip"><div><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div><p>At consequential stages and after showings: what changed, what remains unknown, what alternatives remain, and what evidence should change our recommendation?</p></section>`;
  return injectBeforeMainEnd(text, panel);
}

function injectBeforeMainEnd(text, panel) {
  const i = text.lastIndexOf('</main>');
  if (i >= 0) return `${text.slice(0, i)}${panel}${text.slice(i)}`;
  return text.replace('</body>', `${panel}</body>`);
}

const VALUE_CSS = `<style id="value-system-language">
.value-context{max-width:1120px;margin:1rem auto 0;padding:.7rem 1rem;border:1px solid #e8e5e0;border-radius:10px;background:#faf9f6;display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap;color:#4b4b4b}.value-context strong,.value-kicker,.value-hbe-strip strong{color:#2d5a3d;letter-spacing:.1em}.value-context span{font-size:.86rem}.value-portal-panel{margin-top:1.5rem;padding:1.25rem;background:#fff;border:1px solid #e8e5e0;border-radius:12px}.value-portal-panel h2{margin:.25rem 0 .6rem;color:#1a1a2e;font-family:Georgia,serif;font-size:1.45rem}.value-portal-panel p{color:#555;line-height:1.6}.value-kicker{font-size:.72rem;font-weight:800}.value-hbe-strip{margin-top:1.25rem;padding:1rem 1.15rem;background:#faf9f6;border:1px solid #e8e5e0;border-radius:10px}.value-hbe-strip>div{display:flex;gap:.75rem;align-items:baseline;flex-wrap:wrap}.value-hbe-strip span{font-size:.82rem;color:#666}.value-hbe-strip p{margin:.5rem 0 0;color:#555;line-height:1.5;font-size:.9rem}@media(max-width:600px){.value-context,.value-hbe-strip{margin-left:.75rem;margin-right:.75rem}.value-portal-panel h2{font-size:1.25rem}}
</style>`;
