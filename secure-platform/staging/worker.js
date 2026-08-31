/**
 * ForgeRokBot independent HBEUI + Buyer Portal staging Worker.
 * Synthetic Alex & Sam Rivera household only.
 *
 * Do not deploy as Worker hbe-buyer-platform.
 * Do not bind BUYER_DB / hbe-buyer-journey-v2 / buyer.hbexperts.com.
 * Staging submit does not send email.
 *
 * STAGE ASSUMPTION (labeled, independent of ForgePT PR #26):
 * Live currently has 16 stages ending at Get the Keys.
 * This rendition keeps Get the Keys as stage 16 and adds post-closing care:
 *   17 After the keys
 *   18 30-day care
 *   19 90-day care
 *   20 One-year review
 *   21 Anniversary follow-up
 * Total: 21 stages. Get the Keys is not replaced.
 *
 * Persistence gap: checklist / invite-accept / view-mode live in cookies.
 * D1 is optional and not bound in wrangler.toml.
 * Perimeter: fail closed. Access for cwhitehead@hbexperts.com on the whole hostname, or Worker secret STAGING_PREVIEW_TOKEN. Demo codes are not the gate.
 */
import {
  ADMIN_EMAIL,
  DEMO,
  HOUSEHOLD,
  PEOPLE,
  STAGES,
  FOLLOW_UP,
  COMPENSATION_POST_HIRE
} from './data.js';

const WHO = 'hbe_stg_who';
const VIEW = 'hbe_stg_view';
const CHECKS = 'hbe_stg_checks';
const FLASH = 'hbe_stg_flash';
const JOINED = 'hbe_stg_sam_joined';
const PREVIEW = 'hbe_stg_preview';
const COOKIE_BASE = 'Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=28800';
const PREVIEW_COOKIE = 'Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=14400';

const CODES = {
  [DEMO.alexCode]: 'alex',
  [DEMO.samCode]: 'sam',
  'HBE-STAGING-DEMO': 'hbe'
};

export default {
  async fetch(request, env) {
    const gate = authorizePreview(request, env);
    if (!gate.ok) return gate.response;

    const url = new URL(request.url);
    const cookies = parseCookies(request);
    const setCookies = [];

    const codeParam = String(url.searchParams.get('code') || '').trim().toUpperCase();
    if (codeParam && CODES[codeParam]) {
      const whoNow = CODES[codeParam];
      setCookies.push(cookie(WHO, whoNow));
      const dest = whoNow === 'hbe' ? '/hbe' : '/portal';
      return redirect(dest, setCookies);
    }

    if (url.pathname === '/robots.txt') {
      return text('User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    }

    const who = cookies[WHO] || '';
    const view = cookies[VIEW] === 'shared' ? 'shared' : 'private';
    const checks = parseChecks(cookies[CHECKS]);
    const flash = parseFlash(cookies[FLASH]);
    const samJoined = cookies[JOINED] === '1';

    if (flash) setCookies.push(expire(FLASH));

    const ctx = { who, view, checks, flash, samJoined, setCookies, url, request };

    try {
      if (request.method === 'POST' && url.pathname === '/login') return postLogin(ctx);
      if (request.method === 'GET' && url.pathname === '/logout') return logout();
      if (request.method === 'POST' && url.pathname === '/view') return postView(ctx);
      if (request.method === 'POST' && url.pathname === '/api/checklist') return postChecklist(ctx);
      if (request.method === 'POST' && url.pathname === '/api/intake') return postIntake(ctx);
      if (request.method === 'POST' && url.pathname.startsWith('/invite/')) return postInvite(ctx);

      if (url.pathname === '/' || url.pathname === '/login') return page(homePage(ctx), ctx);
      if (url.pathname === '/hbe') {
        if (!hbeAllowed(request)) return new Response('HBE access required', { status: 403, headers: securityHeaders() });
        return page(hbePage(ctx), ctx);
      }
      if (url.pathname === '/portal') {
        if (who !== 'alex' && who !== 'sam') return redirect('/?need=login');
        return page(portalPage(ctx), ctx);
      }
      if (url.pathname === '/questionnaire') return page(questionnairePage(ctx), ctx);
      if (url.pathname === '/thank-you') return page(thankYouPage(ctx), ctx);
      if (url.pathname.startsWith('/invite/')) return page(invitePage(ctx), ctx);
      return page(notFoundPage(), ctx, 404);
    } catch (err) {
      return page(errorPage(err), ctx, 500);
    }
  }
};

async function postLogin(ctx) {
  const form = await ctx.request.formData();
  const raw = String(form.get('code') || '').trim().toUpperCase();
  const who = CODES[raw];
  if (!who) {
    ctx.flash = { who: 'system', text: 'That demo code is not recognized. Use ALEX-RIVERA-DEMO, SAM-RIVERA-DEMO, or HBE-STAGING-DEMO.' };
    return page(homePage(ctx), ctx, 400);
  }
  ctx.setCookies.push(cookie(WHO, who));
  if (who === 'hbe') return redirect('/hbe', ctx.setCookies);
  return redirect('/portal', ctx.setCookies);
}

function logout() {
  return redirect('/', [expire(WHO), expire(VIEW), expire(FLASH)]);
}

async function postView(ctx) {
  const form = await ctx.request.formData();
  const next = String(form.get('view') || '') === 'shared' ? 'shared' : 'private';
  ctx.setCookies.push(cookie(VIEW, next));
  const back = safeReturn(form.get('return_to'), '/portal');
  return redirect(back, ctx.setCookies);
}

async function postChecklist(ctx) {
  const form = await ctx.request.formData();
  const stageId = String(form.get('stage_id') || '');
  const index = Number(form.get('item_index'));
  const stage = STAGES.find(s => s.id === stageId);
  const item = stage?.checklist?.[index];
  if (!item) return redirect(safeReturn(form.get('return_to'), '/portal'), ctx.setCookies);

  const key = `${stageId}.${index}`;
  const currently = isDone(ctx.checks, stageId, index, item);
  const nextDone = !currently;
  ctx.checks[key] = nextDone;
  ctx.setCookies.push(cookie(CHECKS, JSON.stringify(ctx.checks)));

  if (nextDone && item.early) {
    const ahead = stageIndex(stageId) > stageIndex(HOUSEHOLD.currentStage);
    const payload = `${item.early.who}|${ahead ? 'early|' : 'now|'}${item.early.text}`;
    ctx.setCookies.push(cookie(FLASH, payload));
  }
  return redirect(safeReturn(form.get('return_to'), '/portal'), ctx.setCookies);
}

async function postIntake(ctx) {
  const form = await ctx.request.formData();
  const first = clean(form.get('first_name')) || 'there';
  // Intentionally no email send. Synthetic staging only.
  return redirect('/thank-you?first=' + encodeURIComponent(first), ctx.setCookies);
}

async function postInvite(ctx) {
  const token = decodeURIComponent(ctx.url.pathname.slice('/invite/'.length));
  if (token !== DEMO.inviteToken) {
    ctx.flash = { who: 'system', text: 'This invitation is not available.' };
    return page(inviteUnavailable(), ctx, 404);
  }
  const form = await ctx.request.formData();
  const consent = String(form.get('household_join_consent') || '') === 'yes';
  const identify = clean(form.get('identify')).toLowerCase();
  if (!consent) {
    ctx.flash = { who: 'system', text: 'Joining is optional. Check the consent box only if you choose to connect your own login to this household.' };
    return page(invitePage(ctx), ctx, 400);
  }
  const looksLikeSam = identify === 'sam' || identify === 'sam rivera' || identify === DEMO.samEmail;
  if (!looksLikeSam) {
    ctx.flash = { who: 'system', text: 'Identify yourself in your own name. Staging accepts “Sam Rivera” or sam.rivera@example.test — this is not Alex’s session.' };
    return page(invitePage(ctx), ctx, 400);
  }
  ctx.setCookies.push(cookie(WHO, 'sam'));
  ctx.setCookies.push(cookie(VIEW, 'private'));
  ctx.setCookies.push(cookie(JOINED, '1'));
  ctx.setCookies.push(cookie(FLASH, 'buyer|now|You identified yourself as Sam Rivera. This is your private login — not a shared session with Alex.'));
  return redirect('/portal', ctx.setCookies);
}

function homePage(ctx) {
  const need = ctx.url.searchParams.get('need') === 'login';
  return shell('Staging · HomeBuyer Experts', `
    <section class="hero">
      <div class="hero-inner">
        <div class="eyebrow">ForgeRokBot staging · synthetic only</div>
        <h1>Alex and Sam Rivera’s journey, two dashboards.</h1>
        <p class="lede">People are the purpose. Real estate is the medium. This isolated Worker is a Grok/ForgeRokBot rendition of HBEUI and the Buyer Portal — independent of ForgePT PR #26. No live client, no production D1, no email.</p>
      </div>
    </section>
    <main class="wrap">
      ${need ? `<div class="banner warn">Buyer Dashboard needs a private login. Use a demo code — this is not a shared household session.</div>` : ''}
      ${flashBanner(ctx.flash)}
      ${splitCard()}
      <section class="panel">
        <div class="eyebrow">Private demo login</div>
        <h2>Each person has their own code.</h2>
        <p>Second person arrives through a private invitation and a new login, not by borrowing Alex’s session. Staging seeds codes so Sebastian can switch people without email.</p>
        <div class="code-row">
          <a class="btn primary" href="/login?code=${encodeURIComponent(DEMO.alexCode)}">Continue as Alex</a>
          <a class="btn ghost" href="/login?code=${encodeURIComponent(DEMO.samCode)}">Continue as Sam</a>
          <a class="btn ghost" href="/login?code=HBE-STAGING-DEMO">Open HBE Dashboard</a>
        </div>
        <form class="login-form" method="post" action="/login">
          <label>Or type a demo code
            <input name="code" autocomplete="off" spellcheck="false" placeholder="ALEX-RIVERA-DEMO">
          </label>
          <button class="btn primary" type="submit">Sign in</button>
        </form>
        <p class="muted">Codes: <code>${esc(DEMO.alexCode)}</code> · <code>${esc(DEMO.samCode)}</code> · <code>HBE-STAGING-DEMO</code> · invite token <code>${esc(DEMO.inviteToken)}</code></p>
      </section>
      <div class="grid2">
        <section class="panel">
          <div class="eyebrow">Buyer Experience</div>
          <h2>Education before transaction.</h2>
          <p>Walk the synthetic thank-you page. Submitting does not email anyone and does not write production records.</p>
          <a class="btn ghost" href="/questionnaire">Open the staging Buyer Experience</a>
        </section>
        <section class="panel">
          <div class="eyebrow">Private invitation</div>
          <h2>Sam is invited, not added.</h2>
          <p>The invitation does not share a session. Sam identifies themselves and keeps a private login.</p>
          <a class="btn ghost" href="/invite/${encodeURIComponent(DEMO.inviteToken)}">Open Sam’s invitation</a>
        </section>
      </div>
      <p class="assumption">Stage assumption: live has 16 stages ending at Get the Keys. This rendition adds stages 17–21 (After the keys, 30/90/365, anniversary). Get the Keys is not replaced.</p>
    </main>`);
}

function splitCard() {
  return `<section class="split-card" aria-label="Rivera household dashboards">
    <a class="half hbe-half" href="/hbe">
      <div class="eyebrow">HBE Dashboard</div>
      <h2>Rivera household</h2>
      <p>HBE’s synthesized story, both voices, extra HBE actions, post-hire compensation as negotiable options — no numbers.</p>
      <span class="go">Open HBE view →</span>
    </a>
    <a class="half buyer-half" href="/portal">
      <div class="eyebrow">Buyer Dashboard</div>
      <h2>Alex or Sam, privately</h2>
      <p>Their voice plus shared facts. Hover the journey map. What’s next is never empty. No questionnaire dump.</p>
      <span class="go">Open buyer view →</span>
    </a>
  </section>`;
}

function hbePage(ctx) {
  const current = currentStage();
  const selectedId = ctx.url.searchParams.get('stage') || HOUSEHOLD.currentStage;
  const selected = STAGES.find(s => s.id === selectedId) || current;
  return shell('HBE Dashboard · Rivera household', `
    ${header(ctx, 'hbe')}
    <main class="wrap wide">
      <div class="banner staging">STAGING · synthetic Alex &amp; Sam Rivera · not a live client · no production D1</div>
      ${flashBanner(ctx.flash)}
      <section class="top">
        <div>
          <div class="eyebrow">HBE Workspace</div>
          <h1>What is best for this household?</h1>
          <p>Two decision-makers, one shared journey. Do not collapse Alex and Sam into a fake consensus.</p>
        </div>
        ${whatsNextPanel(ctx, 'hbe')}
      </section>
      ${splitCard()}
      <section class="buyer-strip" aria-label="Household">
        <div class="people-card">
          <span class="initials">AR</span>
          <div>
            <strong>Alex Rivera</strong>
            <small>Private login · ${esc(DEMO.alexCode)}</small>
          </div>
        </div>
        <div class="people-card">
          <span class="initials">SR</span>
          <div>
            <strong>Sam Rivera</strong>
            <small>${ctx.samJoined ? 'Joined via private invitation' : 'Invitation pending — not in Alex’s session'}</small>
          </div>
        </div>
      </section>
      <section class="story hbe-story">
        <div class="eyebrow">Household story · HBE synthesis</div>
        <h2>The story we are holding.</h2>
        <blockquote>${esc(HOUSEHOLD.hbeStory)}</blockquote>
        <p class="muted">HBE sees both private notes. Buyers do not see each other’s reflective voice. This is not a questionnaire dump.</p>
        <div class="grid2">
          <article class="voice">
            <h3>Alex — private to HBE</h3>
            <p>${esc(PEOPLE.alex.voice)}</p>
            <p class="note">${esc(PEOPLE.alex.privateNote)}</p>
          </article>
          <article class="voice">
            <h3>Sam — private to HBE</h3>
            <p>${esc(PEOPLE.sam.voice)}</p>
            <p class="note">${esc(PEOPLE.sam.privateNote)}</p>
          </article>
        </div>
      </section>
      ${householdBox('hbe')}
      ${stageRoad(ctx, '/hbe')}
      ${checklistPanel(ctx, selected, '/hbe')}
      ${compensationPanel(true)}
      ${followUpPanel()}
    </main>`);
}

function portalPage(ctx) {
  const person = PEOPLE[ctx.who];
  const current = currentStage();
  const selectedId = ctx.url.searchParams.get('stage') || HOUSEHOLD.currentStage;
  const selected = STAGES.find(s => s.id === selectedId) || current;
  const shared = ctx.view === 'shared';
  const greeting = shared
    ? `Shared household view — facts both of you can see. You are still signed in as ${person.full}, not as each other.`
    : person.greeting;
  const story = shared
    ? HOUSEHOLD.sharedStory
    : `${person.voice} ${HOUSEHOLD.sharedStory}`;
  return shell(`${person.first}’s Buyer Dashboard`, `
    ${header(ctx, 'buyer')}
    <main class="wrap wide">
      <div class="banner staging">STAGING · synthetic only · ${shared ? 'shared facts' : 'private view'}</div>
      ${flashBanner(ctx.flash)}
      <section class="top">
        <div>
          <div class="eyebrow">${shared ? 'Shared household view' : `${person.first}’s private view`}</div>
          <h1>${esc(greeting)}</h1>
          <p>Sam is not inside Alex’s login. Each person keeps a private session and a shared set of facts.</p>
          ${viewSwitch(ctx)}
        </div>
        ${whatsNextPanel(ctx, 'buyer')}
      </section>
      <section class="story buyer-story">
        <div class="eyebrow">${shared ? 'Shared story' : `${person.first}’s voice + shared facts`}</div>
        <h2>${shared ? 'What we are choosing toward together.' : 'What this decision is for.'}</h2>
        <blockquote>${esc(story)}</blockquote>
        ${shared ? '' : `<p class="muted">The other buyer’s private reflections are not shown here. HBE can hold both voices without making you share them.</p>`}
      </section>
      ${householdBox('buyer')}
      <section>
        <div class="eyebrow">Your HomeBuyer map</div>
        <h2>Hover a stage to peek. Click to open its checklist.</h2>
        <p class="lede">Hover is the preview. You do not have to click just to see what a stage is for.</p>
        ${buyerMap(ctx)}
      </section>
      ${checklistPanel(ctx, selected, '/portal')}
      ${ctx.who === 'alex' ? invitePanel(ctx) : samInviteNote(ctx)}
      ${compensationPanel(HOUSEHOLD.hired)}
    </main>`);
}

function viewSwitch(ctx) {
  const other = ctx.view === 'shared' ? 'private' : 'shared';
  const label = other === 'shared' ? 'Show shared household view' : 'Return to my private view';
  return `<form class="inline" method="post" action="/view">
    <input type="hidden" name="view" value="${other}">
    <input type="hidden" name="return_to" value="/portal">
    <button class="btn ghost" type="submit">${esc(label)}</button>
  </form>`;
}

function questionnairePage(ctx) {
  return shell('Buyer Experience · staging', `
    ${header(ctx, 'public')}
    <main class="wrap">
      <div class="eyebrow">Buyer Experience · staging · not submitted yet</div>
      <h1>Before we talk about houses, help us understand the decision.</h1>
      <p class="lede">Until you press Submit, nothing is sent. This staging form does not email real people and does not write production records.</p>
      ${flashBanner(ctx.flash)}
      <div class="privacy-note"><strong>You are still in control.</strong><br>Staging captures a thank-you only. No access code is mailed. No production buyer row is created.</div>
      <form method="post" action="/api/intake">
        <div class="grid2">
          <label>First name<input name="first_name" value="Alex" required></label>
          <label>Last name<input name="last_name" value="Rivera" required></label>
        </div>
        <label>Email <span class="hint">use .test only in staging</span>
          <input type="email" name="email" value="${esc(DEMO.alexEmail)}" required>
        </label>
        <label>What has you thinking about buying a home now?
          <textarea name="why" rows="4">We want ordinary days to feel calmer without giving up a workable commute or the chance to have people over.</textarea>
        </label>
        <div class="submitbox">
          <strong>This is the moment HBE would receive your information in production.</strong>
          <p>In this staging Worker, Submit only opens the thank-you page. No email is sent to ${esc(ADMIN_EMAIL)} or anyone else.</p>
          <button class="btn primary" type="submit">Submit to HBE</button>
        </div>
      </form>
    </main>`);
}

function thankYouPage(ctx) {
  const first = clean(ctx.url.searchParams.get('first')) || 'there';
  return shell('Thank you · HomeBuyer Experts', `
    ${header(ctx, 'public')}
    <main class="wrap">
      <section class="thanks">
        <div class="eyebrow">Submitted to HBE · staging</div>
        <h1>Thank you, ${esc(first)}.</h1>
        <p class="lede">HBE now has a starting point for a conversation — not a pressure hire. People are the purpose. Real estate is the medium. What is best for the buyer comes before any transaction.</p>
        <div class="privacy-note">
          <strong>Privacy</strong>
          <p>Your Buyer Experience is for authorized HBE professionals working with you. It is not a public listing profile, and the other buyer in a household does not automatically receive your private reflective answers.</p>
        </div>
        <div class="expect">
          <div class="eyebrow">What to expect next from HBE</div>
          <ol>
            <li>HBE reviews what you shared and prepares for a consultation in your language, not a product pitch.</li>
            <li>You talk through priorities, tradeoffs, timing, and unanswered questions. Fit is discussed without pressure to hire.</li>
            <li>If another person is part of the decision, they join through their own invitation and login — not by sharing yours.</li>
            <li>Representation is a deliberate choice. Compensation is discussed after that choice, and it is negotiable. You will not see a public rate card here.</li>
          </ol>
        </div>
        <p class="muted">This staging thank-you did not send email and did not create a production record. Education before transaction.</p>
        <div class="code-row">
          <a class="btn primary" href="/login?code=${encodeURIComponent(DEMO.alexCode)}">Open Alex’s Buyer Dashboard</a>
          <a class="btn ghost" href="/">Back to staging home</a>
        </div>
      </section>
    </main>`);
}

function invitePage(ctx) {
  const token = decodeURIComponent(ctx.url.pathname.slice('/invite/'.length));
  if (token !== DEMO.inviteToken) return inviteUnavailable();
  return shell('Join a buyer journey · staging', `
    ${header(ctx, 'public')}
    <main class="wrap">
      <section class="invite-card">
        <div class="eyebrow">Private buyer invitation</div>
        <h1>You’ve been invited to a shared homebuying journey.</h1>
        <p>The invitation does <strong>not</strong> add you automatically and does <strong>not</strong> put you inside Alex’s session. You identify yourself. You keep your own login. Your reflective answers stay private to you and authorized HBE professionals.</p>
        ${flashBanner(ctx.flash)}
        <form method="post" action="/invite/${encodeURIComponent(DEMO.inviteToken)}">
          <label>Identify yourself
            <input name="identify" placeholder="Sam Rivera" required>
          </label>
          <p class="hint">Staging accepts Sam Rivera or ${esc(DEMO.samEmail)}. This is how the second person arrives — not by using ${esc(DEMO.alexCode)}.</p>
          <label class="check">
            <input type="checkbox" name="household_join_consent" value="yes" required>
            <span><strong>Join this homebuying decision with the other buyer.</strong><br>I understand that accepting connects my own HBE login to the same household. I can close this page and do nothing.</span>
          </label>
          <button class="btn primary" type="submit">Continue with my own login</button>
        </form>
        <p class="muted">Seeded invite token for demo only. No email is sent. Production single-use hashing is not wired here (cookie flag only).</p>
      </section>
    </main>`);
}

function inviteUnavailable() {
  return shell('Invitation unavailable', `
    <main class="wrap">
      <section class="invite-card">
        <div class="eyebrow">HomeBuyer Experts</div>
        <h1>Invitation unavailable</h1>
        <p>This invitation is invalid for staging. Ask the other buyer for a new invitation, or open an independent Buyer Experience.</p>
        <a class="btn ghost" href="/questionnaire">Open an independent Buyer Experience</a>
      </section>
    </main>`);
}

function invitePanel(ctx) {
  return `<section class="panel invite-panel">
    <div class="eyebrow">Invite another buyer</div>
    <h2>They choose whether to join.</h2>
    <p>Create a private invitation. You do not enter their email. They identify themselves, complete their own Buyer Experience in production, and explicitly consent before their account joins the household. Staging seeds one token so you can switch people without sending mail.</p>
    <p><strong>You will not see their private reflective answers, and they will not see yours.</strong></p>
    <label>Invitation link<input readonly value="${esc(String(ctx.url.origin + '/invite/' + DEMO.inviteToken))}"></label>
    <p class="muted">${ctx.samJoined ? 'Sam has accepted in this browser (cookie flag — not D1).' : 'Pending in this browser. Open the link in a fresh session to sign in as Sam.'}</p>
    <a class="btn ghost" href="/invite/${encodeURIComponent(DEMO.inviteToken)}">Preview the invitation landing</a>
  </section>`;
}

function samInviteNote(ctx) {
  return `<section class="panel">
    <div class="eyebrow">Your login</div>
    <h2>This is Sam’s private session.</h2>
    <p>${ctx.samJoined ? 'You arrived through the invitation and identified yourself.' : 'You signed in with Sam’s demo code. In production you would arrive through a private invitation, not Alex’s access code.'}</p>
    <p class="muted">Alex remains on a separate login. Shared facts are available; Alex’s private reflections are not.</p>
  </section>`;
}

function whatsNextPanel(ctx, role) {
  const tasks = whatsNext(ctx.checks, role);
  const items = tasks.map(t => `<li>${esc(t)}</li>`).join('');
  return `<aside class="whats-next" aria-label="What's next">
    <div class="eyebrow">What’s next</div>
    <h2>${role === 'hbe' ? 'Useful HBE work now' : 'Your next useful hour'}</h2>
    <ol>${items}</ol>
  </aside>`;
}

function whatsNext(checks, role) {
  const current = currentStage();
  const out = [];
  current.checklist.forEach((item, i) => {
    if (!isDone(checks, current.id, i, item)) out.push(item.label);
  });
  if (!out.length) {
    const next = STAGES[stageIndex(current.id) + 1];
    if (next) out.push(`Begin ${next.name}: ${next.checklist[0].label}`);
  }
  if (!out.length) out.push(HOUSEHOLD.sharedFacts.nextTalk);
  if (role === 'hbe') out.push('Hold Alex’s and Sam’s voices separately — do not force a blended score.');
  return out.slice(0, 4);
}

function householdBox(which) {
  const f = HOUSEHOLD.sharedFacts;
  return `<section class="box" aria-label="Household box">
    <div class="eyebrow">Household box</div>
    <h2>${which === 'hbe' ? 'What this household is actually optimizing for.' : 'The life this home has to serve.'}</h2>
    <div class="box-grid">
      <article><small>Optimizing</small><p>${esc(f.optimizing)}</p></article>
      <article><small>Tradeoff</small><p>${esc(f.tradeoff)}</p></article>
      <article><small>Still uncertain</small><p>${esc(f.uncertainty)}</p></article>
      <article><small>Evidence so far</small><p>${esc(f.evidence)}</p></article>
      <article class="span"><small>Next conversation</small><p>${esc(f.nextTalk)}</p></article>
    </div>
    <p class="muted">Alex and Sam are both on this journey. Current stage: ${esc(currentStage().name)}. This box stays useful even when no listing is in play.</p>
  </section>`;
}

function stageRoad(ctx, base) {
  const currentId = HOUSEHOLD.currentStage;
  const idx = stageIndex(currentId);
  return `<section>
    <div class="eyebrow">21-stage journey</div>
    <h2>Get the Keys stays. Care continues after.</h2>
    <div class="roadmap">${STAGES.map((s, i) => {
      const cls = s.id === currentId ? 'current' : i < idx ? 'done' : '';
      return `<a class="stage ${cls}" href="${base}?stage=${encodeURIComponent(s.id)}"><span>${i + 1}</span><em>${esc(s.name)}</em></a>`;
    }).join('')}</div>
  </section>`;
}

function buyerMap(ctx) {
  const currentId = HOUSEHOLD.currentStage;
  const idx = stageIndex(currentId);
  return `<div class="map" aria-label="Buyer journey map">${STAGES.map((s, i) => {
    const cls = s.id === currentId ? 'current' : i < idx ? 'done' : 'future';
    const bullets = s.bullets.map(b => `<li>${esc(b)}</li>`).join('');
    return `<a class="mapstop ${cls}" href="/portal?stage=${encodeURIComponent(s.id)}">
      <span class="stepnum">${i < idx ? '✓' : i + 1}</span>
      <div class="steplabel"><strong>${esc(s.name)}</strong><small>${esc(s.summary)}</small></div>
      <div class="stagepeek">
        <div class="eyebrow">What happens here</div>
        <h2>${esc(s.name)}</h2>
        <p>${esc(s.summary)}</p>
        <ul>${bullets}</ul>
      </div>
    </a>`;
  }).join('')}</div>`;
}

function checklistPanel(ctx, stage, returnTo) {
  const currentIdx = stageIndex(HOUSEHOLD.currentStage);
  const thisIdx = stageIndex(stage.id);
  const earlyStage = thisIdx > currentIdx;
  const rows = stage.checklist.map((item, i) => {
    const done = isDone(ctx.checks, stage.id, i, item);
    const extra = item.early
      ? `<small class="early">Checking this ${earlyStage ? 'before this stage is current' : 'now'} ${item.early.who === 'hbe' ? 'creates extra HBE work' : 'asks a buyer action'}: ${esc(item.early.text)}</small>`
      : '';
    return `<li class="check-row ${done ? 'done' : ''}">
      <form method="post" action="/api/checklist">
        <input type="hidden" name="stage_id" value="${esc(stage.id)}">
        <input type="hidden" name="item_index" value="${i}">
        <input type="hidden" name="return_to" value="${esc(returnTo)}?stage=${encodeURIComponent(stage.id)}">
        <button class="checkbtn" type="submit" title="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : '○'}</button>
      </form>
      <div><strong>${esc(item.label)}</strong>${extra}</div>
    </li>`;
  }).join('');
  return `<section class="panel">
    <div class="eyebrow">Checklist · ${esc(stage.name)}</div>
    <h2>${esc(stage.summary)}</h2>
    <ul class="checks">${rows}</ul>
    ${earlyStage ? `<p class="muted">This stage is ahead of Discover Possibilities. Checking an item off early triggers the buyer or HBE action named on the row.</p>` : ''}
  </section>`;
}

function compensationPanel(hired) {
  if (!hired) {
    return `<section class="panel">
      <div class="eyebrow">Representation</div>
      <h2>Hire first. Compensation after.</h2>
      <p>Public and pre-hire views do not show commission details or a rate card. Representation is a deliberate choice. How HBE is paid is discussed after that choice, and it is negotiable.</p>
    </section>`;
  }
  const cards = COMPENSATION_POST_HIRE.map(c => `<article class="comp"><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></article>`).join('');
  return `<section class="panel">
    <div class="eyebrow">After you chose representation</div>
    <h2>How HBE can be paid — negotiable, no posted rate.</h2>
    <p>This household has hired HBE. Commission is not a public number. These are arrangement shapes, not a menu of prices. What is best for the buyer still governs the written agreement.</p>
    <div class="comp-grid">${cards}</div>
  </section>`;
}

function followUpPanel() {
  const rows = FOLLOW_UP.map(([when, text]) => `<li><strong>${esc(when)}</strong><span>${esc(text)}</span></li>`).join('');
  return `<section class="panel">
    <div class="eyebrow">Care after the keys</div>
    <h2>The relationship does not end at the table.</h2>
    <ul class="follow">${rows}</ul>
  </section>`;
}

function header(ctx, mode) {
  const whoLabel = ctx.who === 'alex' ? 'Alex Rivera' : ctx.who === 'sam' ? 'Sam Rivera' : ctx.who === 'hbe' ? 'HBE (staging)' : 'Not signed in';
  return `<header class="site-header"><div class="site-header-inner">
    <a class="brand" href="/">HomeBuyer Experts</a>
    <nav class="header-actions">
      <span class="pill">Staging</span>
      <span class="muted">${esc(whoLabel)}${mode === 'buyer' && ctx.view === 'shared' ? ' · shared facts' : ''}</span>
      <a href="/hbe">HBE</a>
      <a href="/portal">Buyer</a>
      <a href="/login?code=${encodeURIComponent(DEMO.alexCode)}">Alex</a>
      <a href="/login?code=${encodeURIComponent(DEMO.samCode)}">Sam</a>
      <a href="/logout">Sign out</a>
    </nav>
  </div></header>`;
}

function flashBanner(flash) {
  if (!flash || !flash.text) return '';
  const label = flash.who === 'hbe' ? 'Extra HBE action' : flash.who === 'buyer' ? 'Buyer action' : 'Notice';
  const early = flash.when === 'early' ? ' · triggered by checking ahead of the current stage' : '';
  return `<div class="banner action"><strong>${esc(label)}${early}</strong><p>${esc(flash.text)}</p></div>`;
}

function notFoundPage() {
  return shell('Not found', `<main class="wrap"><h1>That page is not in this staging Worker.</h1><a class="btn ghost" href="/">Back to staging home</a></main>`);
}
function errorPage(err) {
  return shell('Staging error', `<main class="wrap"><h1>Staging Worker error</h1><p class="muted">${esc(err && err.message ? err.message : String(err))}</p><a class="btn ghost" href="/">Home</a></main>`);
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <title>${esc(title)}</title>
    ${CSS}
  </head><body>${body}</body></html>`;
}


function authorizePreview(request, env) {
  env = env || {};
  const url = new URL(request.url);
  const expectedEmail = String(env.HBE_ADMIN_EMAIL || ADMIN_EMAIL || '').trim().toLowerCase();
  const accessEmail = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  if (accessEmail && expectedEmail && accessEmail === expectedEmail) return { ok: true };

  const token = String(env.STAGING_PREVIEW_TOKEN || '');
  const cookies = parseCookies(request);
  const supplied = String(url.searchParams.get('preview') || cookies[PREVIEW] || '');
  if (token && supplied && timingSafeEqualText(token, supplied)) {
    if (url.searchParams.has('preview')) {
      url.searchParams.delete('preview');
      const headers = securityHeaders();
      headers.set('location', `${url.pathname}${url.search}${url.hash}`);
      headers.append('set-cookie', `${PREVIEW}=${encodeURIComponent(token)}; ${PREVIEW_COOKIE}`);
      return { ok: false, response: new Response(null, { status: 303, headers }) };
    }
    return { ok: true };
  }

  const headers = securityHeaders();
  headers.set('content-type', 'text/plain; charset=utf-8');
  return {
    ok: false,
    response: new Response(
      'HBE staging is gated. Use Cloudflare Access for cwhitehead@hbexperts.com, or the separately supplied staging preview credential. Demo codes are not the perimeter.',
      { status: 403, headers }
    )
  };
}

function timingSafeEqualText(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function hbeAllowed(request) {
  // Secondary identity check only. Perimeter is authorizePreview on every route.
  const email = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  if (!email) return true;
  return email === String(ADMIN_EMAIL || '').toLowerCase();
}
function currentStage() {
  return STAGES.find(s => s.id === HOUSEHOLD.currentStage) || STAGES[0];
}
function stageIndex(id) {
  return STAGES.findIndex(s => s.id === id);
}
function isDone(checks, stageId, index, item) {
  const key = `${stageId}.${index}`;
  if (Object.prototype.hasOwnProperty.call(checks, key)) return !!checks[key];
  return !!item.done;
}
function parseChecks(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function parseFlash(raw) {
  if (!raw) return null;
  const parts = String(raw).split('|');
  if (parts.length < 3) return { who: 'system', when: 'now', text: String(raw) };
  return { who: parts[0], when: parts[1], text: parts.slice(2).join('|') };
}
function parseCookies(request) {
  const out = Object.create(null);
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}
function cookie(name, value) {
  return `${name}=${encodeURIComponent(String(value))}; ${COOKIE_BASE}`;
}
function expire(name) {
  return `${name}=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0`;
}
function redirect(location, cookies = []) {
  const headers = securityHeaders();
  headers.set('location', location);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}
function page(body, ctx, status = 200) {
  const headers = securityHeaders();
  headers.set('content-type', 'text/html; charset=utf-8');
  for (const c of ctx.setCookies || []) headers.append('set-cookie', c);
  return new Response(body, { status, headers });
}
function text(body, type) {
  const headers = securityHeaders();
  headers.set('content-type', type);
  return new Response(body, { status: 200, headers });
}
function securityHeaders() {
  return new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
}
function safeReturn(value, fallback) {
  const v = String(value || '');
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback;
  return v;
}
function clean(value) {
  return String(value || '').trim().slice(0, 200);
}
function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
}

const CSS = `<style>
:root{--navy:#1a1a2e;--green:#2d5a3d;--green2:#3a7a52;--gold:#c9a84c;--text:#2c2c2c;--muted:#6b6b6b;--warm:#faf9f6;--section:#f5f3ef;--border:#e8e5e0}
*{box-sizing:border-box}html{-webkit-font-smoothing:antialiased}
body{margin:0;background:#fff;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}
a{color:var(--green);text-decoration:none}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--navy);line-height:1.15;font-weight:600}
h1{font-size:clamp(2rem,5vw,3.2rem);margin:.35rem 0 1rem}h2{font-size:clamp(1.4rem,3vw,2rem);margin:.25rem 0 1rem}h3{font-size:1.2rem}
p{margin:0 0 1rem}.lede{font-size:1.12rem;color:var(--muted);max-width:760px}
.eyebrow{font-size:.76rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--green)}
.muted{color:var(--muted);font-size:.9rem}.hint{color:var(--muted);font-weight:400;font-size:.85rem}
.wrap{max-width:1100px;margin:auto;padding:2rem 1.25rem 4rem}.wrap.wide{max-width:1240px}
.site-header{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.site-header-inner{max-width:1240px;margin:auto;padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.brand{font:700 1.3rem Georgia,serif;color:var(--navy)}
.header-actions{display:flex;flex-wrap:wrap;gap:.75rem 1rem;align-items:center;font-size:.9rem}
.header-actions a{color:var(--green)}.pill{background:var(--section);border:1px solid var(--border);border-radius:999px;padding:.15rem .55rem;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--navy)}
.hero{padding:4.5rem 1.25rem 2rem;background:linear-gradient(180deg,var(--warm),#fff);text-align:center}
.hero-inner{max-width:820px;margin:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:.8rem 1.2rem;border-radius:6px;font-weight:700;border:0;cursor:pointer;font:inherit;text-decoration:none}
.btn.primary{background:var(--green);color:#fff}.btn.primary:hover{background:var(--green2)}
.btn.ghost{background:#fff;color:var(--green);border:2px solid var(--green)}
.code-row{display:flex;flex-wrap:wrap;gap:.7rem;margin:1rem 0}
.login-form{margin-top:1rem;display:grid;gap:.6rem;max-width:420px}
label{display:block;font-weight:700;margin:1rem 0 .35rem;color:var(--navy)}
input,textarea,select{width:100%;font:inherit;padding:.8rem;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text)}
textarea{resize:vertical}
.panel{background:#fff;border:1px solid var(--border);border-radius:14px;padding:1.25rem 1.35rem;margin:1.25rem 0;box-shadow:0 8px 28px rgba(26,26,46,.04)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.split-card{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:16px;overflow:hidden;margin:1.5rem 0;box-shadow:0 12px 36px rgba(26,26,46,.06)}
.half{display:block;padding:1.6rem 1.5rem;color:inherit;min-height:210px}
.hbe-half{background:var(--navy);color:#f4f1ea}.hbe-half h2,.hbe-half .eyebrow{color:#f4f1ea}.hbe-half .eyebrow{color:#c9a84c}.hbe-half p{color:#d9d4c8}
.buyer-half{background:var(--warm)}.go{display:inline-block;margin-top:.6rem;font-weight:800;color:var(--green)}.hbe-half .go{color:#c9a84c}
.banner{border-radius:10px;padding:.9rem 1rem;margin:0 0 1rem;border:1px solid var(--border);background:var(--warm)}
.banner.staging{border-left:4px solid var(--gold);font-size:.92rem}
.banner.warn{border-left:4px solid #9b3434;background:#fff5f5}
.banner.action{border-left:4px solid var(--green);background:#edf6f0}
.banner.action p{margin:.35rem 0 0}
.top{display:flex;justify-content:space-between;gap:1.5rem;align-items:flex-start;margin:1rem 0 1.5rem}
.whats-next{min-width:280px;max-width:420px;background:#fff;border:1px solid var(--border);border-left:4px solid var(--gold);border-radius:12px;padding:1rem 1.1rem}
.whats-next ol{margin:.4rem 0 0;padding-left:1.1rem}.whats-next li{margin:.35rem 0}
.people-card{display:flex;gap:.8rem;align-items:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:.85rem 1rem}
.buyer-strip{display:flex;gap:.9rem;flex-wrap:wrap;margin:0 0 1.25rem}
.initials{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--green);color:#fff;font-weight:800}
.story{margin:1.25rem 0;padding:1.25rem 1.4rem;background:var(--warm);border:1px solid var(--border);border-radius:14px}
blockquote{margin:0 0 1rem;font-family:Georgia,serif;font-size:1.2rem;color:var(--navy);border-left:3px solid var(--gold);padding:.2rem 0 .2rem 1rem}
.voice{background:#fff;border:1px solid var(--border);border-radius:10px;padding:1rem}
.note{font-size:.9rem;color:var(--muted)}
.box{margin:1.25rem 0;padding:1.25rem 1.4rem;border:1px solid var(--border);border-radius:14px;background:#fff}
.box-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
.box-grid article{background:var(--warm);border-radius:10px;padding:.85rem 1rem}
.box-grid small{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:.7rem;font-weight:800;color:var(--muted);margin-bottom:.35rem}
.box-grid .span{grid-column:1/-1}
.roadmap{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0}
.stage{display:inline-flex;gap:.35rem;align-items:center;background:var(--section);border:1px solid var(--border);border-radius:999px;padding:.35rem .65rem;color:var(--muted);font-size:.78rem}
.stage em{font-style:normal}.stage.done{background:#edf4ef;color:var(--green)}.stage.current{background:var(--green);color:#fff;border-color:var(--green)}
.map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin:1.25rem 0 2rem}
.mapstop{position:relative;display:grid;grid-template-columns:34px 1fr;gap:.7rem;min-height:104px;padding:1rem;border:1px solid var(--border);border-radius:12px;background:#fff;color:inherit}
.mapstop.future{opacity:.64}.mapstop.current{opacity:1;border-color:rgba(45,90,61,.55)}
.mapstop:hover,.mapstop:focus{opacity:1;z-index:5;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.stepnum{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--green);color:#fff;font-weight:700;font-size:.8rem}
.steplabel strong,.steplabel small{display:block}.steplabel strong{font-family:Georgia,serif;color:var(--navy)}.steplabel small{color:var(--muted);font-size:.8rem;margin-top:.25rem}
.stagepeek{pointer-events:none;position:absolute;left:50%;bottom:calc(100% + 10px);width:min(370px,82vw);transform:translate(-50%,8px);background:#fff;border:1px solid var(--border);border-radius:12px;padding:1.2rem;box-shadow:0 18px 50px rgba(26,26,46,.16);opacity:0;visibility:hidden;transition:.14s;z-index:20}
.mapstop:hover .stagepeek,.mapstop:focus .stagepeek,.mapstop:focus-within .stagepeek{opacity:1;visibility:visible;transform:translate(-50%,0)}
.stagepeek h2{font-size:1.35rem;margin:.2rem 0 .5rem}.stagepeek li{margin:.4rem 0}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:.65rem}
.check-row{display:grid;grid-template-columns:36px 1fr;gap:.55rem;align-items:start;background:var(--warm);border-radius:10px;padding:.75rem}
.check-row.done strong{text-decoration:line-through;color:var(--muted)}
.checkbtn{border:0;background:transparent;color:var(--green);font-size:1.35rem;cursor:pointer;padding:0}
.early{display:block;color:var(--muted);margin-top:.3rem;font-weight:400}
.comp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}
.comp{background:var(--warm);border-radius:10px;padding:1rem}
.follow{list-style:none;margin:0;padding:0}.follow li{display:grid;gap:.2rem;padding:.7rem 0;border-top:1px solid var(--border)}.follow strong{color:var(--navy)}
.privacy-note{background:var(--warm);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:10px;padding:1rem 1.1rem;margin:1.25rem 0}
.expect{background:#fff;border:1px solid var(--border);border-radius:12px;padding:1.1rem 1.25rem;margin:1.25rem 0}
.expect ol{margin:.4rem 0 0;padding-left:1.2rem}.expect li{margin:.45rem 0}
.thanks{background:var(--warm);border:1px solid var(--border);border-radius:16px;padding:clamp(1.4rem,4vw,2.6rem)}
.invite-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:clamp(1.4rem,5vw,3rem);box-shadow:0 12px 36px rgba(26,26,46,.06)}
.check{display:flex;gap:.75rem;align-items:flex-start;font-weight:400}
.check input{width:auto;margin-top:.3rem}
.submitbox{background:var(--warm);border:1px solid var(--border);border-radius:12px;padding:1.2rem;margin-top:1.5rem}
.assumption{margin-top:2rem;font-size:.85rem;color:var(--muted)}
.inline{display:inline}
@media(max-width:900px){.grid2,.split-card,.box-grid,.comp-grid,.top{grid-template-columns:1fr;display:grid}.top{display:block}.whats-next{margin-top:1rem;max-width:none}.map{grid-template-columns:repeat(2,minmax(0,1fr))}.stagepeek{left:0;transform:translate(0,8px)}.mapstop:hover .stagepeek,.mapstop:focus .stagepeek{transform:translate(0,0)}}
@media(max-width:520px){.map{grid-template-columns:1fr}.header-actions .muted{display:none}}
</style>`;
