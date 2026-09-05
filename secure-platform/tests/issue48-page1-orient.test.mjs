import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuyerFirstClarity, confineOrientationCardsToPage1 } from '../src/issue33-production-worker.js';
import { compensationPublicHtml } from '../src/issue29-ui.js';

const VALUE_LINE =
  '<div class="value-context"><strong>VALUE</strong><span>Values · Alternatives · Learning · Uncertainty · Evidence</span></div>';

const BUYER_CORE =
  '<div class="buyer-first-core" role="note"><strong>HomeBuyer Experts helps people buy homes.</strong> We work only for home buyers — never for the seller. Our job is to help you make the best choice for you, even when the best choice is to walk away.</div>';

function syntheticQuestionnaire() {
  return `<!doctype html><html><head></head><body><main class="experience">
${BUYER_CORE}
${VALUE_LINE}
<div class="progress-row"><span>1 of 8</span></div>
<form id="buyerExperienceForm" method="post" action="/api/intake">
<section class="step active" data-title="You & this decision">
<div class="eyebrow">Part 1</div><h1>Start with you.</h1>
<p class="intro">Page 1 intro stays.</p>
<div class="privacy">Nothing is sent yet.</div>
<div class="navrow"><button type="button">Continue</button></div>
</section>
<section class="step" data-title="What matters">
<div class="eyebrow">Part 2</div><h1>What matters</h1>
<p class="intro">Page 2 intro stays.</p>
<div class="navrow"><button type="button">Back</button><button type="button">Continue</button></div>
</section>
<section class="step" data-title="How you decide">
<div class="eyebrow">Part 3</div><h1>How you decide</h1>
<div class="navrow"><button type="button">Back</button><button type="button">Continue</button></div>
</section>
<section class="step" data-title="Pressure">
<div class="eyebrow">Part 4</div><h1>Pressure</h1>
</section>
<section class="step" data-title="Others">
<div class="eyebrow">Part 5</div><h1>Others</h1>
</section>
<section class="step" data-title="Life">
<div class="eyebrow">Part 6</div><h1>Life</h1>
</section>
<section class="step" data-title="Practical">
<div class="eyebrow">Part 7</div><h1>Practical</h1>
</section>
<section class="step" data-title="Success">
<div class="eyebrow">Part 8</div><h1>Success</h1>
</section>
</form>
${compensationPublicHtml()}
</main></body></html>`;
}

function steps(html) {
  const parts = [];
  const re = /<section\b([^>]*)\bclass="([^"]*\bstep\b[^"]*)"([^>]*)>([\s\S]*?)<\/section>/gi;
  // Depth-aware split: first find each step open, then walk to matching close
  const openRe = /<section\b[^>]*\bclass="[^"]*\bstep\b[^"]*"[^>]*>/gi;
  let match;
  const opens = [];
  while ((match = openRe.exec(html))) opens.push({ index: match.index, open: match[0], end: match.index + match[0].length });
  for (let i = 0; i < opens.length; i++) {
    const start = opens[i].end;
    const limit = i + 1 < opens.length ? opens[i + 1].index : html.length;
    // From start, find the step's own closing </section> with depth (compensation nests a section)
    let depth = 1;
    const tagRe = /<\/?section\b[^>]*>/gi;
    tagRe.lastIndex = start;
    let closeAt = -1;
    let m;
    while ((m = tagRe.exec(html)) && m.index < html.length) {
      if (m[0].startsWith('</')) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        closeAt = m.index;
        break;
      }
      if (i + 1 < opens.length && m.index >= opens[i + 1].index && depth === 1) {
        // reached next sibling step open while still inside — shouldn't happen
        break;
      }
    }
    const body = closeAt >= 0 ? html.slice(start, closeAt) : html.slice(start, limit);
    parts.push({ open: opens[i].open, body, full: opens[i].open + body });
  }
  return parts;
}

test('confine puts buyer-first, VALUE, and compensation inside first .step only', () => {
  const html = confineOrientationCardsToPage1(syntheticQuestionnaire());
  const all = steps(html);
  assert.equal(all.length, 8);

  const first = all[0].body;
  assert.match(first, /buyer-first-core/);
  assert.match(first, /value-context/);
  assert.match(first, /id="compensation-note"/);
  assert.match(first, /qx-page1-orient/);

  // Order: buyer-first → VALUE → compensation
  const iBuyer = first.indexOf('buyer-first-core');
  const iValue = first.indexOf('value-context');
  const iComp = first.indexOf('compensation-note');
  assert.ok(iBuyer >= 0 && iValue > iBuyer && iComp > iValue);

  for (let i = 1; i < all.length; i++) {
    assert.doesNotMatch(all[i].body, /buyer-first-core/);
    assert.doesNotMatch(all[i].body, /value-context/);
    assert.doesNotMatch(all[i].body, /compensation-note/);
    assert.doesNotMatch(all[i].body, /qx-page1-orient/);
  }

  // Still present once (not deleted)
  assert.equal((html.match(/buyer-first-core/g) || []).length, 1);
  assert.equal((html.match(/class="value-context/g) || []).length, 1);
  assert.equal((html.match(/id="compensation-note"/g) || []).length, 1);

  // Page chrome preserved
  assert.match(html, /1 of 8/);
  assert.match(html, /Page 1 intro stays/);
  assert.match(html, /Page 2 intro stays/);
  assert.match(html, /Nothing is sent yet/);
});

test('confine is idempotent when already page-1 confined', () => {
  const once = confineOrientationCardsToPage1(syntheticQuestionnaire());
  const twice = confineOrientationCardsToPage1(once);
  assert.equal(twice, once);
});

test('addBuyerFirstClarity keeps homepage buyer-first at main level (not page1-confined)', () => {
  const home = '<!doctype html><html><head></head><body><main><h1>Journey</h1></main></body></html>';
  const html = addBuyerFirstClarity(home, '/');
  assert.match(html, /buyer-first-core/);
  assert.match(html, /<main[^>]*>\s*<div class="buyer-first-core"/);
  // Orient class may appear in shared CSS; the card itself must stay unconfined on /.
  assert.doesNotMatch(html, /class="buyer-first-core[^"]*qx-page1-orient/);
  assert.doesNotMatch(html, /class="[^"]*step[^"]*"/);
});

test('full questionnaire path: addBuyerFirstClarity then confine', () => {
  // Simulate mid-chain HTML: VALUE + compensation already present, no buyer-first yet
  const mid = `<!doctype html><html><head></head><body><main>
${VALUE_LINE}
<form id="buyerExperienceForm" method="post" action="/api/intake">
<section class="step active" data-title="You & this decision"><div class="eyebrow">Part 1</div><h1>Start</h1>
<div class="submitbox"><strong>This is the moment HBE receives your information.</strong><p>x</p><button class="btn primary" type="submit">Submit to HBE</button></div>
</section>
<section class="step" data-title="Two"><h1>Two</h1></section>
</form>
${compensationPublicHtml()}
</main></body></html>`;

  let html = addBuyerFirstClarity(mid, '/questionnaire');
  html = confineOrientationCardsToPage1(html);
  const all = steps(html);
  assert.ok(all.length >= 2);
  assert.match(all[0].body, /buyer-first-core/);
  assert.match(all[0].body, /value-context/);
  assert.match(all[0].body, /compensation-note/);
  assert.doesNotMatch(all[1].body, /buyer-first-core|value-context|compensation-note/);
});

test('confine falls back gracefully when steps are missing', () => {
  const html = confineOrientationCardsToPage1(
    `<!doctype html><html><body><main>${BUYER_CORE}${VALUE_LINE}${compensationPublicHtml()}<p>no steps</p></main></body></html>`
  );
  assert.match(html, /buyer-first-core/);
  assert.match(html, /value-context/);
  assert.match(html, /compensation-note/);
  assert.match(html, /qx-page1-orient/);
  assert.match(html, /no steps/);
});

test('portal VALUE panel is not mistaken for public value-context', () => {
  const html = confineOrientationCardsToPage1(`<!doctype html><html><body><main>
<section class="value-portal-panel"><h2>Price tells you</h2></section>
<section class="step active"><h1>One</h1></section>
<section class="step"><h1>Two</h1></section>
</main></body></html>`);
  assert.match(html, /value-portal-panel/);
  assert.doesNotMatch(html, /qx-page1-orient/);
  const all = steps(html);
  assert.doesNotMatch(all[0].body, /value-portal-panel/);
});
