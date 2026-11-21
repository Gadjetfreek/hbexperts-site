// "Your Buyer Story" — the optional last step of the Stage 1 Buyer Experience questionnaire.
//
// Everything a buyer reads in the story comes from STORY_COPY (the single copy module Vera and
// Homey revise) plus the buyer's own answers. createStoryEngine() is self-contained so the exact
// same code runs in the browser (embedded via Function#toString) and in node tests.
//
// Privacy contract for this module (enforced by tests/buyer-story.test.mjs):
// - No network APIs of any kind. The download path builds the story on the device and prints it.
// - It never writes to Web Storage; after a download it clears the questionnaire draft.
// - No analytics or Google tags.
// - The shared path only adds three hidden fields to the existing questionnaire form, which then
//   goes through the existing /api/intake lead flow after the buyer's explicit consent.

export const STORY_COPY_VERSION = 'buyer-story-copy-v1-2026-11-20';
export const PHRASE_BANK_VERSION = 'buyer-story-phrases-v1-2026-11-20';
export const STORY_SOURCE = 'buyer_story';
export const STORY_TEXT_MAX = 12000;
export const QUESTIONNAIRE_DRAFT_KEY = 'hbe:buyer-experience:draft';

export const STORY_COPY = {
  version: STORY_COPY_VERSION,
  phraseBankVersion: PHRASE_BANK_VERSION,
  config: {
    // OPEN QUESTION FOR SEBASTIAN. One switch for both money-adjacent items:
    // the buyer's own stated budget comfort in the "at a glance" summary (only if they gave one),
    // and the generic "talk with a lender" advocate step. The story sections never mention money
    // either way. Default OFF (the stricter of Homey's and Vera's rules).
    moneyInSummaryAndAdvocate: false
  },
  limits: { freeTextChars: 400, itemsPerSection: 5, advocateSteps: 5 },
  // Fields the story never reads, whatever the form contains.
  excludeFields: ['first_name', 'last_name', 'email', 'phone', 'remember_device', 'household_invite_token', 'financing', 'notes', 'consultation_success', 'story_source', 'story_consent', 'story_text'],
  title: 'Your Buyer Story',
  brand: 'HomeBuyer Experts',
  headings: {
    story: 'Your Story',
    matters: 'What Matters Most to You',
    needs: 'What a Home Needs to Do for You',
    mind: "What's on Your Mind",
    known: "What You Know and What You're Still Figuring Out",
    options: 'Your Options',
    decide: 'How You Like to Decide',
    glance: 'Your Priorities at a Glance',
    advocate: "What a Buyer's Advocate Would Do Next"
  },
  intros: {
    storyWithWhy: 'You told us what is prompting your move.',
    storyFallback: 'This is a snapshot of what you told us matters, in your words.',
    matters: 'These are the things you said matter most.',
    needs: 'Here is what you said a home needs to do for you.',
    mind: 'You named a few worries. Many people buying a home have these same ones. Having them is normal.',
    known: 'Some things are clear. Some are still open. Both are normal.',
    options: 'You have more than one good path.',
    decide: 'Here is how you said you like to make choices.',
    glance: 'A plain summary of what you chose.',
    advocate: "Whoever helps you, or if you go it alone, here's what a good buyer's advocate would do with what you've shared."
  },
  leads: {
    why: 'You said:',
    success: 'You hope daily life gets better like this:',
    ruleOut: 'You said this would rule a home out:',
    location: "Where you're considering:",
    past: 'What you would like done differently this time:',
    glancePriorities: 'Priorities you picked:',
    glanceTiming: 'Timing:',
    glanceBudget: 'Budget you said feels comfortable:'
  },
  tags: { need: 'Need', flexible: 'Flexible' },
  lines: {
    otherBuyer: 'You told us another buyer is part of this decision. This story shows only your answers. They can share their own.',
    unknownUnknowns: "You said you don't know what you don't know yet. That is a normal place to start.",
    optionWait: 'Taking more time is a real option.',
    optionRent: 'Renting a while longer can be a real option, if it fits your life.',
    optionChange: 'You can change direction at any point. That is part of deciding well.'
  },
  truncated: '(see your full answers)',
  advocateRules: [
    { id: 'listen', when: 'always', text: 'Start by listening, and make sure they understand what you shared here, in your own words.' },
    { id: 'checklist', when: 'hasNeeds', text: 'Turn what matters most to you into a short checklist to hold every home up against.' },
    { id: 'condition', when: 'conditionWorry', text: "Help you plan how to learn about a home's condition, and point you to a licensed home inspector for answers about it." },
    { id: 'lender', when: 'money', text: 'Suggest you talk with a lender early, so you know what monthly payment feels comfortable before you look.' },
    { id: 'pace', when: 'paceWorry', text: 'Walk through each decision with you at your pace, so you never feel rushed.' },
    { id: 'notYet', when: 'notYet', text: 'Help you make the best choice for you, even when the best choice is to wait or walk away.' },
    { id: 'pros', when: 'always', text: 'Send legal, tax, and lending questions to the right licensed professionals.' }
  ],
  advocateFact: "An exclusive buyer's agent represents only buyers, never sellers. Ask any agent you interview who else they represent and how they're paid.",
  closing: 'Wherever you go from here, the next step is yours to choose.',
  footer: 'This story is yours. You chose what to share. Generated on {date}.',
  anonymousLine: 'Created on your device. Nothing was sent to us.',
  contactLine: "If you'd like to talk it through with HBE: hbexperts.com",
  rules: {
    longTimelines: ['6–12 months', 'More than a year', 'Just exploring / unsure'],
    conditionWorries: ['Hidden property problems', 'Inspection issues'],
    paceWorries: ['Negotiating effectively', 'Making the wrong decision'],
    timingWorries: ['Timing / market conditions'],
    changeWorries: ['Making the wrong decision'],
    unknownWorry: 'I do not know what I do not know'
  },
  // Versioned phrase bank: one neutral phrase per multiple-choice option (the option value is the
  // ID). null = deliberately left out of the story (money, or a protected-class inference).
  // Any value not listed here is left out too. Nothing is ever guessed.
  phrases: {
    priorities: {
      'Location': 'Being in the right location',
      'Price / monthly cost': null,
      'Schools': null,
      'Commute': 'A commute that works for you',
      'Privacy': 'Privacy',
      'Yard / outdoor space': 'Outdoor space',
      'Investment potential': null,
      'Walkability': 'Being able to walk to places',
      'Character': 'A home with character',
      'Low maintenance': 'A home that is easy to keep up',
      'Space for family': null,
      'Future resale': null
    },
    // Labels the "at a glance" summary may show only when the money switch is on.
    moneyPriorities: {
      'Price / monthly cost': 'Monthly cost',
      'Investment potential': 'Investment potential',
      'Future resale': 'Future resale'
    },
    lifestyle_pace: {
      'Always on the go — home is mainly a base': "You're often on the go, so home is mainly a base.",
      'Balanced — active, but I value downtime': "You're active, and you value downtime at home.",
      'Home-centered — home is a major part of how I live': 'Home is a big part of how you live.',
      'Work-from-home life — the space has to function for living and working': 'You work from home, so the space has to work for living and working.',
      'Prefer not to answer': null
    },
    space_priority: {
      'More indoor space, even if location or lot is less ideal': "You'd give a little on location or lot for more indoor space.",
      'More outdoor space, even if the house is smaller': "You'd take a smaller house for more outdoor space.",
      'Better location, even if the home is smaller': "You'd take a smaller home for a better location.",
      'Higher quality / condition, even if I get less space': "You'd take less space for better quality and condition.",
      'Prefer not to answer': null
    },
    info_preference: {
      'Give me the data and let me analyze it': 'You like to get the data and look at it yourself.',
      'Give me the big picture first, details later': 'You like the big picture first, and the details later.',
      'Walk me through it step by step': 'You like to go step by step.',
      'Tell me what you recommend and why': 'You like a clear recommendation, with the reasons for it.',
      'Prefer not to answer': null
    },
    uncertainty_style: {
      'Keep gathering information until the uncertainty is smaller': 'When things are unclear, you keep gathering information until the unknowns get smaller.',
      'Identify the biggest unknowns, then decide if the remaining risk is acceptable': 'When things are unclear, you name the biggest unknowns, then decide if the risk left is okay.',
      'Talk it through until I understand how the uncertainty changes the choice': 'When things are unclear, you talk it through until you see how the unknowns change the choice.',
      'If the downside is survivable and it feels right, I can act without knowing everything': 'If the downside is something you can live with and it feels right, you can act without knowing everything.',
      'Prefer not to answer': null
    },
    disagreement_style: {
      'Put the evidence side by side': 'When you and someone you trust disagree, it helps to put the facts side by side.',
      'Let each person explain what matters to them before solving it': 'When you and someone you trust disagree, it helps for each person to say what matters to them first.',
      'Give us time to think separately, then come back together': 'When you and someone you trust disagree, it helps to think on your own, then come back together.',
      'Help identify the tradeoff underneath the disagreement': 'When you and someone you trust disagree, it helps to find the tradeoff underneath.',
      'Prefer not to answer': null
    },
    concerns: {
      'Paying too much': null,
      'Choosing the wrong area': 'Choosing the wrong area',
      'Hidden property problems': 'Problems with a home that are hard to see',
      'Financing / monthly cost': null,
      'Negotiating effectively': 'Negotiating well',
      'Timing / market conditions': 'Timing, and what the market is doing',
      'Inspection issues': 'What an inspection might find',
      'Making the wrong decision': 'Making the wrong decision',
      'I do not know what I do not know': null
    },
    timeline: {
      'Immediately / within 30 days': { text: "You'd like to move within about a month.", open: false },
      '1–3 months': { text: "You'd like to move in about 1 to 3 months.", open: false },
      '3–6 months': { text: "You'd like to move in about 3 to 6 months.", open: false },
      '6–12 months': { text: "You'd like to move in about 6 to 12 months.", open: false },
      'More than a year': { text: "You're thinking more than a year out.", open: false },
      'Just exploring / unsure': { text: "Your timing is still open. You're exploring.", open: true }
    }
  },
  ui: {
    eyebrow: 'Optional · Your Buyer Story',
    heading: 'Get your story',
    intro: 'Turn your answers into a short story you can keep. It is built right here in your browser, only from what you wrote.',
    show: 'Show my story',
    refresh: 'Refresh my story',
    editHint: 'You can change any wording below before you save or share it. To change an answer, go back to that part, then refresh your story.',
    empty: 'Answer a few questions above and your story will appear here.',
    consentLabel: 'Yes, save my Buyer Journey and share it, with my story, with Jen and Sebastian at HomeBuyer Experts so they can follow up with me. I can ask to have it deleted anytime.',
    privacyLink: 'Privacy Policy',
    privacyUrl: 'https://hbexperts.com/privacy/',
    downloadLabel: 'Download my story',
    downloadSub: 'It stays on your device. Nothing is saved or sent.',
    // OPEN QUESTION FOR HOMEY / SEBASTIAN: Homey's label is "Email me a copy and keep my journey",
    // but the existing sender can only mail HBE's own inboxes, so the buyer cannot be emailed a
    // copy without new email setup. The label says what really happens until that is decided.
    shareLabel: 'Share it with HBE and keep my journey',
    shareSub: 'Jen and Sebastian will read it personally and reach out, no obligation. To keep your own copy, use Download my story too.',
    shareNeedsConsent: 'Turn on the switch above to share your story.',
    reviewRow: 'Your Buyer Story',
    reviewRowValue: 'Included, as it reads in your story preview.',
    afterDownload: 'Your story is ready to save as a PDF or print. Your draft answers were also cleared from this browser\u2019s temporary storage. They stay on this page until you leave it.'
  }
};

// ---- Story engine (self-contained; embedded verbatim in the page) -------------------------
export function createStoryEngine(copy) {
  const MAX = copy.limits.freeTextChars;
  const PER = copy.limits.itemsPerSection;
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const squash = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  function list(a, k) {
    if (copy.excludeFields.indexOf(k) !== -1 || !own(a, k)) return [];
    const v = a[k];
    return (Array.isArray(v) ? v : [v]).map(squash).filter(Boolean);
  }
  const one = (a, k) => list(a, k)[0] || '';
  function phrase(field, value) {
    const bank = copy.phrases[field];
    return own(bank, value) ? bank[value] : null;
  }
  function quote(lead, raw, tag) {
    const s = squash(raw);
    if (!s) return null;
    const cut = s.length > MAX;
    const item = { lead, quote: cut ? s.slice(0, MAX).trimEnd() + '...' : s, truncated: cut };
    if (tag) item.tag = tag;
    return item;
  }
  const line = (text, tag) => (text ? (tag ? { text, tag } : { text }) : null);

  function build(answers, opts) {
    const a = answers || {};
    const o = opts || {};
    const money = !!copy.config.moneyInSummaryAndAdvocate;
    const sections = [];
    const add = (id, intro, items, always) => {
      const kept = items.filter(Boolean).slice(0, PER);
      if (!kept.length && !always) return;
      sections.push({ id, heading: copy.headings[id], intro_sentence: intro, items: kept });
    };
    const concerns = list(a, 'concerns');
    const has = (vals, wanted) => vals.some(v => wanted.indexOf(v) !== -1);
    const timeline = one(a, 'timeline');
    const tl = phrase('timeline', timeline);
    const longTimeline = copy.rules.longTimelines.indexOf(timeline) !== -1;

    // 1. Your Story (always; fallback framing when "why" is blank)
    const why = one(a, 'why');
    add('story', why ? copy.intros.storyWithWhy : copy.intros.storyFallback, [
      quote(copy.leads.why, why),
      one(a, 'has_other_buyer') === 'yes' ? line(copy.lines.otherBuyer) : null
    ], true);

    // 2. What Matters Most
    const priorities = list(a, 'priorities').map(v => phrase('priorities', v)).filter(Boolean);
    add('matters', copy.intros.matters, [...priorities.map(p => line(p)), quote(copy.leads.success, one(a, 'success_definition'))]);

    // 3. What a Home Needs to Do for You (needs vs. flexible)
    add('needs', copy.intros.needs, [
      quote(copy.leads.ruleOut, one(a, 'non_negotiables'), copy.tags.need),
      line(phrase('lifestyle_pace', one(a, 'lifestyle_pace')), copy.tags.need),
      line(phrase('space_priority', one(a, 'space_priority')), copy.tags.flexible)
    ]);

    // 4. What's on Your Mind (named worries, normalized, never solved)
    add('mind', copy.intros.mind, concerns.map(v => line(phrase('concerns', v))));

    // 5. What You Know and What You're Still Figuring Out
    add('known', copy.intros.known, [
      tl ? line(tl.text) : null,
      quote(copy.leads.location, one(a, 'location')),
      concerns.indexOf(copy.rules.unknownWorry) !== -1 ? line(copy.lines.unknownUnknowns) : null
    ]);

    // 6. Your Options (only when their answers support it)
    const timingWorry = has(concerns, copy.rules.timingWorries);
    add('options', copy.intros.options, [
      longTimeline || timingWorry ? line(copy.lines.optionWait) : null,
      longTimeline ? line(copy.lines.optionRent) : null,
      has(concerns, copy.rules.changeWorries) ? line(copy.lines.optionChange) : null
    ]);

    // 7. How You Like to Decide
    add('decide', copy.intros.decide, [
      line(phrase('info_preference', one(a, 'info_preference'))),
      line(phrase('uncertainty_style', one(a, 'uncertainty_style'))),
      line(phrase('disagreement_style', one(a, 'disagreement_style'))),
      quote(copy.leads.past, one(a, 'past_experience_detail'))
    ]);

    // Plain summary of priorities (and budget comfort only behind the money switch)
    const picked = list(a, 'priorities').map(v => phrase('priorities', v) ? v : (money && own(copy.phrases.moneyPriorities, v) ? copy.phrases.moneyPriorities[v] : null)).filter(Boolean);
    add('glance', copy.intros.glance, [
      picked.length ? { lead: copy.leads.glancePriorities, text: picked.join(', ') } : null,
      tl ? { lead: copy.leads.glanceTiming, text: timeline } : null,
      money ? quote(copy.leads.glanceBudget, one(a, 'budget_comfort')) : null
    ]);

    // 8. Advocate: deterministic rule table, fixed order, max N
    const hasNeeds = priorities.length > 0 || !!one(a, 'non_negotiables') || !!phrase('space_priority', one(a, 'space_priority'));
    const cond = {
      always: true,
      hasNeeds,
      conditionWorry: has(concerns, copy.rules.conditionWorries),
      money,
      paceWorry: has(concerns, copy.rules.paceWorries) || one(a, 'info_preference') === 'Walk me through it step by step',
      notYet: longTimeline || timingWorry
    };
    const steps = copy.advocateRules.filter(r => cond[r.when] === true).slice(0, copy.limits.advocateSteps).map(r => ({ text: r.text, rule: r.id }));
    sections.push({ id: 'advocate', heading: copy.headings.advocate, intro_sentence: copy.intros.advocate, items: steps, note: copy.advocateFact });

    const date = squash(o.date) || '';
    return {
      version: copy.version,
      phraseBankVersion: copy.phraseBankVersion,
      title: copy.title,
      anonymous: !!o.anonymous,
      sections,
      closing: copy.closing,
      footer: copy.footer.replace('{date}', date),
      anonymousLine: o.anonymous ? copy.anonymousLine : '',
      contact: copy.contactLine
    };
  }

  function itemHtml(it) {
    const tag = it.tag ? '<span class="story-tag">' + esc(it.tag) + '</span> ' : '';
    const lead = it.lead ? '<span class="story-lead">' + esc(it.lead) + '</span> ' : '';
    const body = it.quote != null
      ? '<span class="story-quote">\u201c' + esc(it.quote) + '\u201d</span>' + (it.truncated ? ' <span class="story-more">' + esc(copy.truncated) + '</span>' : '')
      : esc(it.text);
    return '<li>' + tag + lead + body + '</li>';
  }
  function toHtml(story) {
    let h = '<header class="story-head"><p class="story-brand">' + esc(copy.brand) + '</p><h1>' + esc(story.title) + '</h1></header>';
    for (const s of story.sections) {
      h += '<section class="story-sec" data-sec="' + esc(s.id) + '"><h2>' + esc(s.heading) + '</h2>';
      if (s.intro_sentence) h += '<p class="story-intro">' + esc(s.intro_sentence) + '</p>';
      if (s.items.length) h += (s.id === 'advocate' ? '<ol>' : '<ul>') + s.items.map(itemHtml).join('') + (s.id === 'advocate' ? '</ol>' : '</ul>');
      if (s.note) h += '<p class="story-note">' + esc(s.note) + '</p>';
      h += '</section>';
    }
    h += '<p class="story-closing">' + esc(story.closing) + '</p><footer class="story-foot"><p>' + esc(story.footer) + '</p>';
    if (story.anonymousLine) h += '<p class="story-anon-line">' + esc(story.anonymousLine) + '</p>';
    h += '<p class="story-contact">' + esc(story.contact) + '</p></footer>';
    return h;
  }
  function itemText(it) {
    const body = it.quote != null ? '"' + it.quote + '"' + (it.truncated ? ' ' + copy.truncated : '') : it.text;
    return [it.tag ? '[' + it.tag + ']' : '', it.lead || '', body].filter(Boolean).join(' ');
  }
  function toText(story) {
    const out = [story.title, ''];
    for (const s of story.sections) {
      out.push(s.heading.toUpperCase());
      if (s.intro_sentence) out.push(s.intro_sentence);
      s.items.forEach((it, i) => out.push((s.id === 'advocate' ? (i + 1) + '. ' : '- ') + itemText(it)));
      if (s.note) out.push(s.note);
      out.push('');
    }
    out.push(story.closing, '', story.footer);
    if (story.anonymousLine) out.push(story.anonymousLine);
    out.push(story.contact);
    return out.join('\n');
  }
  return { build, toHtml, toText, escape: esc };
}

// Removes what the story step must not leave behind after a download. The story step itself never
// writes to storage; this also drops the questionnaire's sessionStorage draft (Homey's rule).
export function clearStoryStorage(stores, draftKey) {
  let removed = 0;
  for (const store of stores || []) {
    if (!store) continue;
    try {
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      for (const k of keys) {
        if (k === draftKey || String(k).indexOf('hbe:buyer-story') === 0) { store.removeItem(k); removed++; }
      }
    } catch (e) { /* storage unavailable: nothing to clear */ }
  }
  return removed;
}

// ---- Server-side helpers for the consented path ---------------------------------------------
export function readStorySubmission(form) {
  const source = String(form.get('story_source') || '').trim();
  if (!source) return { present: false };
  const consent = String(form.get('story_consent') || '').trim() === 'yes';
  const text = String(form.get('story_text') || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim().slice(0, STORY_TEXT_MAX);
  const ok = source === STORY_SOURCE && consent && !!text;
  return { present: true, ok, source, consent, text };
}

export const STORY_CONSENT_ERROR = 'To share your Buyer Story, please turn on the sharing switch first. Or use Download my story to keep it to yourself.';

// ---- Page injection --------------------------------------------------------------------------
const STORY_CSS = `<style id="buyer-story-css">
.buyer-story-step{border:1px solid #dfe8e2;border-radius:14px;padding:1.1rem 1.15rem;margin:1.2rem 0;background:#fbfdfb}
.buyer-story-step h2{font:600 1.35rem Georgia,serif;color:#1a1a2e;margin:.2rem 0 .4rem}
.buyer-story-step .story-eyebrow{font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:#2d5a3d;margin:0}
.buyer-story-step .story-help{color:#555;line-height:1.55;margin:.35rem 0 .8rem}
#buyer-story-doc{background:#fff;border:1px solid #e8e5e0;border-radius:12px;padding:1rem 1.1rem;margin:.8rem 0;color:#1a1a2e;line-height:1.55;outline:none}
#buyer-story-doc:focus{box-shadow:0 0 0 3px rgba(45,90,61,.25)}
#buyer-story-doc h1,#buyer-story-print h1{font:600 1.5rem Georgia,serif;margin:.1rem 0 .6rem}
#buyer-story-doc h2,#buyer-story-print h2{font:600 1.08rem Georgia,serif;margin:1rem 0 .3rem;color:#1a1a2e}
#buyer-story-doc ul,#buyer-story-doc ol,#buyer-story-print ul,#buyer-story-print ol{margin:.3rem 0 .3rem 1.2rem;padding:0}
#buyer-story-doc li,#buyer-story-print li{margin:.2rem 0}
.story-brand{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#2d5a3d;margin:0}
.story-tag{display:inline-block;font-size:.72rem;font-weight:700;border:1px solid #2d5a3d;color:#2d5a3d;border-radius:999px;padding:0 .45rem;margin-right:.2rem}
.story-lead{color:#444}.story-more,.story-foot,.story-contact{color:#666;font-size:.88rem}
.story-note{font-size:.92rem;color:#333;border-left:3px solid #2d5a3d;padding-left:.6rem}
.story-closing{font-style:italic;margin-top:1rem}
.story-switch{display:flex;gap:.7rem;align-items:flex-start;margin:.9rem 0;cursor:pointer;line-height:1.5}
.story-switch input{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:2.6rem;height:1.5rem;border-radius:999px;background:#c9cfcb;position:relative;margin:.1rem 0 0;cursor:pointer;transition:background .15s}
.story-switch input:after{content:'';position:absolute;top:.15rem;left:.15rem;width:1.2rem;height:1.2rem;border-radius:50%;background:#fff;transition:left .15s}
.story-switch input:checked{background:#2d5a3d}.story-switch input:checked:after{left:1.25rem}
.story-switch input:focus-visible{outline:3px solid rgba(45,90,61,.4);outline-offset:2px}
.story-choices{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin:.8rem 0}
@media (max-width:640px){.story-choices{grid-template-columns:1fr}}
.story-choice{display:flex;flex-direction:column;align-items:flex-start;gap:.25rem;text-align:left;width:100%;min-height:5.2rem;padding:.85rem 1rem;border:2px solid #2d5a3d;border-radius:12px;background:#fff;color:#1a1a2e;font:inherit;cursor:pointer}
.story-choice strong{font-size:1.02rem}.story-choice small{color:#555;line-height:1.4}
.story-choice[disabled]{opacity:.55;cursor:not-allowed}
.story-link{background:none;border:0;color:#2d5a3d;text-decoration:underline;font:inherit;cursor:pointer;padding:.2rem 0}
.story-status{color:#2d5a3d;font-size:.92rem;min-height:1.2em}
@media screen{#buyer-story-print{display:none}}
@media print{
@page{margin:16mm}
html.hbe-story-printing body>*:not(#buyer-story-print){display:none!important}
html.hbe-story-printing,html.hbe-story-printing body{background:#fff!important}
html.hbe-story-printing #buyer-story-print{display:block!important;color:#1a1a2e;background:#fff;font:11.5pt/1.5 Georgia,"Times New Roman",serif}
#buyer-story-print .story-sec{break-inside:avoid-page;page-break-inside:avoid}
#buyer-story-print h2{break-after:avoid;page-break-after:avoid}
#buyer-story-print .story-tag{border-color:#555;color:#333}
}
</style>`;

export function buyerStoryStepHtml(copy = STORY_COPY) {
  const e = createStoryEngine(copy).escape;
  const u = copy.ui;
  return `<section class="buyer-story-step" id="buyer-story-step" aria-labelledby="buyer-story-heading">
<p class="story-eyebrow">${e(u.eyebrow)}</p><h2 id="buyer-story-heading">${e(u.heading)}</h2>
<p class="story-help">${e(u.intro)}</p>
<button class="story-link" id="buyer-story-show" type="button">${e(u.show)}</button>
<div id="buyer-story-preview" hidden><p class="story-help">${e(u.editHint)}</p>
<article id="buyer-story-doc" contenteditable="true" spellcheck="true" aria-label="${e(copy.title)}"></article>
<button class="story-link" id="buyer-story-refresh" type="button">${e(u.refresh)}</button></div>
<label class="story-switch"><input type="checkbox" id="buyer-story-consent" role="switch" aria-checked="false"><span>${e(u.consentLabel)} <a href="${e(u.privacyUrl)}" target="_blank" rel="noopener noreferrer">${e(u.privacyLink)}</a></span></label>
<div class="story-choices">
<button class="story-choice" id="buyer-story-download" type="button"><strong>${e(u.downloadLabel)}</strong><small>${e(u.downloadSub)}</small></button>
<button class="story-choice" id="buyer-story-share" type="button" disabled aria-disabled="true" aria-describedby="buyer-story-share-hint"><strong>${e(u.shareLabel)}</strong><small>${e(u.shareSub)}</small></button>
</div>
<p class="story-status" id="buyer-story-share-hint">${e(u.shareNeedsConsent)}</p>
<p class="story-status" id="buyer-story-status" role="status" aria-live="polite"></p>
</section>`;
}

function storyClientScript(copy) {
  // The UI below uses only DOM, print, and Web Storage removal. No network APIs.
  return `(()=>{
const COPY=${JSON.stringify(copy).replace(/</g, '\\u003c')};
const E=(${createStoryEngine.toString()})(COPY);
const clearStoryStorage=${clearStoryStorage.toString()};
const DRAFT_KEY=${JSON.stringify(QUESTIONNAIRE_DRAFT_KEY)};
const form=document.getElementById('buyerExperienceForm');
const root=document.getElementById('buyer-story-step');
if(!form||!root)return;
const $=id=>document.getElementById(id);
const doc=$('buyer-story-doc'),preview=$('buyer-story-preview'),consent=$('buyer-story-consent'),dl=$('buyer-story-download'),share=$('buyer-story-share'),hint=$('buyer-story-share-hint'),status=$('buyer-story-status');
let built=false,mode='download';
const today=()=>new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
function answers(){const a={};new FormData(form).forEach((v,k)=>{if(COPY.excludeFields.indexOf(k)!==-1)return;(a[k]=a[k]||[]).push(String(v));});return a;}
function render(){doc.innerHTML=E.toHtml(E.build(answers(),{anonymous:true,date:today()}));preview.hidden=false;built=true;}
function shareText(){
  const clone=doc.cloneNode(true);
  clone.querySelectorAll('.story-anon-line').forEach(n=>n.remove());
  const out=[];clone.querySelectorAll('h1,h2,p,li').forEach(n=>{const t=(n.textContent||'').replace(/\\s+/g,' ').trim();if(t)out.push(n.tagName==='LI'?'- '+t:n.tagName==='H2'?'\\n'+t.toUpperCase():t);});
  return out.join('\\n').trim();
}
function dropHidden(){form.querySelectorAll('input[data-buyer-story]').forEach(n=>n.remove());}
function addHidden(name,value){const i=document.createElement('input');i.type='hidden';i.name=name;i.value=value;i.setAttribute('data-buyer-story','');form.appendChild(i);}
// Keep story-step typing out of the questionnaire's draft autosave.
['input','change'].forEach(t=>root.addEventListener(t,e=>e.stopPropagation()));
$('buyer-story-show').addEventListener('click',render);
$('buyer-story-refresh').addEventListener('click',render);
consent.addEventListener('change',()=>{const on=consent.checked;consent.setAttribute('aria-checked',String(on));share.disabled=!on;share.setAttribute('aria-disabled',String(!on));hint.hidden=on;if(!on){mode='download';dropHidden();}});
dl.addEventListener('click',()=>{
  if(!built)render();
  const old=document.getElementById('buyer-story-print');if(old)old.remove();
  const p=document.createElement('div');p.id='buyer-story-print';p.innerHTML=doc.innerHTML;
  p.querySelectorAll('[contenteditable]').forEach(n=>n.removeAttribute('contenteditable'));
  document.body.appendChild(p);document.documentElement.classList.add('hbe-story-printing');
  const done=()=>{window.removeEventListener('afterprint',done);document.documentElement.classList.remove('hbe-story-printing');p.remove();};
  window.addEventListener('afterprint',done);
  try{window.print();}finally{clearStoryStorage([window.sessionStorage,window.localStorage],DRAFT_KEY);status.textContent=COPY.ui.afterDownload;}
});
const reviewBtn=document.getElementById('review-before-send');
if(reviewBtn)reviewBtn.addEventListener('click',e=>{if(e.isTrusted){mode='download';dropHidden();}});
share.addEventListener('click',()=>{
  if(!consent.checked||!reviewBtn)return;
  if(!built)render();
  mode='share';reviewBtn.click();
  const list=document.getElementById('buyer-review-list');
  if(list&&!list.querySelector('[data-buyer-story-row]')){const row=document.createElement('div');row.className='buyer-review-item';row.setAttribute('data-buyer-story-row','');const s=document.createElement('small');s.textContent=COPY.ui.reviewRow;const d=document.createElement('div');d.textContent=COPY.ui.reviewRowValue;row.append(s,d);list.prepend(row);}
});
// Runs before the review dialog's own send handler (capture phase), so the story rides along
// with the normal questionnaire submission only when the buyer chose to share and consented.
document.addEventListener('click',e=>{
  const t=e.target&&e.target.closest?e.target.closest('#buyer-review-send'):null;if(!t)return;
  dropHidden();
  if(mode==='share'&&consent.checked){addHidden('story_source','buyer_story');addHidden('story_consent','yes');addHidden('story_text',shareText());}
},true);
})();`;
}

export function buyerStoryScriptSource(copy = STORY_COPY) { return storyClientScript(copy); }

export function addBuyerStoryStep(html, copy = STORY_COPY) {
  let text = String(html);
  if (text.includes('id="buyer-story-step"')) return text;
  const anchor = '<div class="submitbox">';
  const at = text.indexOf(anchor);
  if (at === -1 || !text.includes('id="buyerExperienceForm"')) return text;
  text = text.slice(0, at) + buyerStoryStepHtml(copy) + text.slice(at);
  text = text.includes('</head>') ? text.replace('</head>', `${STORY_CSS}</head>`) : STORY_CSS + text;
  const script = `<script id="buyer-story-script">${storyClientScript(copy)}</script>`;
  const end = text.lastIndexOf('</body>');
  return end === -1 ? text + script : text.slice(0, end) + script + text.slice(end);
}
