import baseWorker from './worker.js';

const STAGES = [
  ['buyerExperience','Buyer Experience','Start with what matters to you',['Share what is bringing you to the idea of buying a home.','Tell us what you know, what you do not know, and what you are worried about.','Give HBE a useful starting point without needing perfect answers.']],
  ['consultation','Consultation','Turn answers into understanding',['Talk through your Buyer Experience with an HBE advisor.','Clarify priorities, tradeoffs, timing, risks, and unanswered questions.','Decide whether HBE feels like the right fit for you.']],
  ['representation','Hire HBE','Choose your representation deliberately',['Understand who HBE represents and what fiduciary representation means.','Review compensation, responsibilities, and the agency agreement.','Choose whether to hire HBE without pressure.']],
  ['search','Build Your Home Search','Turn priorities into a useful search',['Translate your priorities into search criteria and tradeoffs.','Connect your profile to the MLS search.','Adjust the search as we learn what actually fits.']],
  ['market','Learn the Market','Understand what the market is really offering',['See what your money buys in the current market.','Compare location, condition, value, and alternatives.','Refine expectations before chasing individual homes.']],
  ['possibilities','Discover Possibilities','Find homes worth learning from',['Review homes that may fit your evolving profile.','Notice useful possibilities you did not originally expect.','Flag homes worth seeing without letting the search become noise.']],
  ['evaluation','Evaluate Homes','Learn from each property',['Tour homes with an HBE advisor.','Capture details, observations, photos, and questions worth remembering.','Use each home to improve the next decision.']],
  ['offer','Ready to Offer?','Decide before negotiating',['Separate excitement from decision quality.','Identify what is still unknown and what could change the decision.','Choose whether making an offer actually serves your goals.']],
  ['terms','Build the Offer','Construct price and terms deliberately',['Choose price, timing, contingencies, and protections consciously.','Understand what each term gives up or protects.','Build an offer you can live with whether it wins or loses.']],
  ['negotiation','Negotiate Wisely','Protect leverage and your WHY',['Evaluate counters, concessions, and seller responses.','Keep alternatives and leverage visible.','Choose when to proceed, counter, or walk away.']],
  ['diligence','Learn What We Did Not Know','Investigate before commitment hardens',['Review disclosures, records, transaction details, and unanswered questions.','Track new facts as they appear.','Ask what each new fact changes about the decision.']],
  ['inspection','Inspection Decision','Put inspection findings in context',['Separate routine maintenance from meaningful risk.','Identify specialist or follow-up needs.','Choose repairs, credits, acceptance, or exit when available.']],
  ['value','Value Check','Compare price with independent evidence',['Review appraisal and other value evidence.','Understand any value gap and its consequences.','Choose the response that best protects you.']],
  ['loan','Final Financing','Finish financing without surprises',['Track underwriting and lender conditions.','Review final cash, payment, and financing expectations.','Protect the transaction from avoidable financing problems.']],
  ['commitment','Final Decision','Ask whether this is still the right choice',['Compare what you know now with what you knew when you started.','Confirm remaining risks and obligations.','Make sure the home still serves your WHY before final commitment.']],
  ['closing','Get the Keys','Complete the purchase and take possession',['Verify final documents, funds, and logistics.','Complete the final walk-through and closing.','Get the keys and begin making the home yours.']]
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(explorer(), { status: 200, headers: securityHeaders() });
    }
    return baseWorker.fetch(request, env, ctx);
  }
};

function explorer() {
  const map = STAGES.map((stage, index) => {
    const [id, label, summary, bullets] = stage;
    return `<div class="mapstop ${id === 'buyerExperience' ? 'current' : 'future'}" tabindex="0" aria-describedby="tip-${id}">
      <span class="stepnum">${index + 1}</span>
      <div class="steplabel"><strong>${esc(label)}</strong><small>${esc(summary)}</small></div>
      <div class="stagepeek" id="tip-${id}" role="tooltip">
        <div class="peekeyebrow">What happens here</div>
        <h2>${esc(label)}</h2>
        <ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      </div>
    </div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>HomeBuyer Experts Buyer Journey</title>
<style>
:root{--ink:#34271d;--deep:#49331f;--gold:#a87523;--line:#8f7043;--paper:#f9edcc;--soft:#fff1cd}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#cfb77d,#bfa064);color:var(--ink);font-family:Inter,system-ui,sans-serif;min-height:100vh}.wrap{max-width:1120px;margin:auto;padding:24px 14px 70px}.panel{background:rgba(249,237,204,.96);border:1px solid var(--line);border-radius:20px;padding:clamp(20px,4vw,44px);box-shadow:0 20px 60px #4d351c33}.journeyhead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:24px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.journeyhead a{color:#76511e;text-decoration:none;border-bottom:1px solid transparent}.journeyhead a:hover,.journeyhead a:focus{border-bottom-color:#76511e}.journeyhead .divider{opacity:.45}.journeyhead .title{color:var(--ink)}h1,h2{font-family:Georgia,serif}h1{font-size:clamp(36px,6vw,62px);line-height:1.02;margin:6px 0 14px;max-width:880px}h2{margin:6px 0 12px;font-size:25px}.lede{font-size:18px;line-height:1.55;max-width:820px;margin-bottom:22px}.nextstep{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#4a3422;color:#fff;padding:13px 16px;border-radius:14px;margin:8px 0 22px;width:max-content;max-width:100%}.nextstep small{text-transform:uppercase;font-weight:850;letter-spacing:.08em}.nextstep a{font:700 23px Georgia,serif;color:#fff;text-decoration:none;border-bottom:1px solid #fff8}.nextstep a:hover,.nextstep a:focus{border-bottom-color:#fff}.map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0 26px}.mapstop{position:relative;text-align:left;display:grid;grid-template-columns:34px 1fr;column-gap:8px;align-items:start;min-height:92px;padding:11px;border:1px solid #917144;border-radius:14px;background:#f6e8c2;color:inherit;outline:none}.mapstop.future{opacity:.63}.mapstop.current{outline:3px solid var(--gold);opacity:1}.stepnum{grid-row:1/3;width:28px;height:28px;border-radius:50%;border:2px solid #75552d;display:grid;place-items:center;font-weight:900}.steplabel strong,.steplabel small{display:block}.steplabel small{font-size:11px;line-height:1.3;margin-top:4px}.mapstop:hover,.mapstop:focus,.mapstop:focus-within{opacity:1;z-index:8}.stagepeek{pointer-events:none;position:absolute;left:50%;bottom:calc(100% + 10px);width:min(360px,82vw);transform:translate(-50%,8px);background:#fff8e6;border:1px solid #826138;border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px #2d1d1066;opacity:0;visibility:hidden;transition:opacity .14s ease,transform .14s ease;z-index:20}.stagepeek:after{content:"";position:absolute;top:100%;left:50%;margin-left:-8px;border:8px solid transparent;border-top-color:#826138}.mapstop:hover .stagepeek,.mapstop:focus .stagepeek,.mapstop:focus-within .stagepeek{opacity:1;visibility:visible;transform:translate(-50%,0)}.peekeyebrow{font-size:10px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;color:#76511e}.stagepeek ul{padding-left:20px;margin:8px 0 0}.stagepeek li{margin:8px 0;line-height:1.4}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}.actioncard{display:flex;min-height:126px;flex-direction:column;justify-content:space-between;padding:18px;border:1px solid #9b7b4e;border-radius:14px;background:var(--soft)}.actioncard strong{font:700 23px Georgia,serif}.actioncard small{display:block;line-height:1.45;margin-top:6px}.btn{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:12px 17px;margin-top:14px;text-decoration:none;font-weight:850;cursor:pointer;width:max-content;max-width:100%}.primary{background:var(--deep);color:white}.ghost{background:transparent;border:1px solid #80633d;color:var(--deep)}
@media(max-width:850px){.map{grid-template-columns:repeat(2,minmax(0,1fr))}.stagepeek{left:0;transform:translate(0,8px)}.mapstop:hover .stagepeek,.mapstop:focus .stagepeek,.mapstop:focus-within .stagepeek{transform:translate(0,0)}.stagepeek:after{left:30px}}
@media(max-width:620px){.wrap{padding:10px 8px 40px}.panel{border-radius:14px}.map{grid-template-columns:1fr}.mapstop{min-height:72px}.actions{grid-template-columns:1fr}.nextstep{width:100%;align-items:flex-start;flex-direction:column}.stagepeek{position:absolute;left:0;right:0;width:auto;bottom:calc(100% + 8px)}h1{font-size:38px}}
@media(hover:none){.mapstop{cursor:default}}
</style>
</head>
<body>
<main class="wrap">
<section class="panel">
  <header class="journeyhead">
    <a href="https://hbexperts.com/">HomeBuyer Experts</a>
    <span class="divider">|</span>
    <span class="title">Buyer Journey</span>
  </header>

  <h1>Your HomeBuyer journey, from first questions to keys.</h1>
  <p class="lede">Explore the entire process before you decide whether to share anything with HBE. Hover over any step — or focus it on a touch device — to see what happens there.</p>

  <div class="nextstep">
    <small>Next step in your journey</small>
    <a href="/questionnaire">Buyer Experience →</a>
  </div>

  <div class="map" aria-label="HomeBuyer roadmap">${map}</div>

  <div class="actions">
    <div class="actioncard">
      <div><strong>Start the Buyer Experience</strong><small>Your answers stay on this device until you deliberately press “Submit to HBE.”</small></div>
      <a class="btn primary" href="/questionnaire">Start the Experience</a>
    </div>
    <div class="actioncard">
      <div><strong>Already submitted?</strong><small>Return to the same BuyerUI and central journey record from this or another device.</small></div>
      <a class="btn ghost" href="/login">Open my BuyerUI</a>
    </div>
  </div>
</section>
</main>
</body>
</html>`;
}

function securityHeaders(){return new Headers({'content-type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"})}
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
