import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuyerFirstClarity } from '../src/issue33-production-worker.js';
import { readFileSync } from 'node:fs';
import { BUYER_GUIDANCE, TIMELINE_CHIP_VALUES, CONCERN_CHIP_VALUES, installBuyerGuidance } from '../src/buyer-guidance.js';

const REMAINDER_OPEN_FIELDS = [
  'success_definition',
  'non_negotiables',
  'unknowns',
  'saturday_morning_vision',
  'consultation_success',
  'past_experience_detail'
];
const IDENTITY_FIELDS = ['first_name', 'last_name', 'email', 'phone'];

const questionnaire = `<!doctype html><html><head></head><body><main><form id="buyerExperienceForm" method="post" action="/api/intake" novalidate><input name="first_name" required><input name="last_name" required><input type="email" name="email" required><textarea name="why"></textarea><input name="timeline"><input name="location"><textarea name="concerns"></textarea><textarea name="notes"></textarea><div class="submitbox"><strong>This is the moment HBE receives your information.</strong><p>Submitting creates your private buyer record and alerts HBE that your Buyer Experience is ready for review. HBE will store what you actually submitted; unanswered reflective questions remain unanswered.</p><button class="btn primary" type="submit">Submit to HBE</button></div></form></main></body></html>`;

test('questionnaire adds plain-English buyer-only explanation', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /helps people buy homes/i);
  assert.match(html, /only for home buyers/i);
  assert.match(html, /never for the seller/i);
  assert.match(html, /walk away/i);
});

test('questionnaire requires review before final submission', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /Review &amp; Send to HomeBuyer Experts/);
  assert.match(html, /Here is what HBE will receive/);
  assert.match(html, /Back and edit/);
  assert.match(html, /Send to HomeBuyer Experts/);
  assert.match(html, /does not hire HBE/i);
  assert.match(html, /does not.*sign an agency agreement/i);
  assert.match(html, /does not.*obligate you to buy/i);
  assert.doesNotMatch(html, />Submit to HBE<\/button>/);
});

test('pre-submit review preserves the existing intake action', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /action="\/api\/intake"/);
  assert.match(html, /form\.requestSubmit\(\)/);
});

test('review UI does not expose invitation token values', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /hidden=new Set\(\['household_invite_token'\]\)/);
});

test('open-ended typed answers receive suggestions and explicit uncertainty permission', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /buyer-guided-answer-script/);
  assert.match(html, /Need a starting point\?/);
  assert.match(html, /It is okay not to know yet/);
  assert.match(html, /I’m not sure yet/);
  assert.match(html, /why:\{help:/);
  assert.match(html, /timeline:\{help:/);
  assert.match(html, /location:\{help:/);
  assert.match(html, /concerns:\{help:/);
  assert.match(html, /notes:\{help:/);
  for (const name of REMAINDER_OPEN_FIELDS) {
    assert.match(html, new RegExp(name + ':\\{help:'));
  }
  assert.doesNotMatch(html, /first_name:\{help:/);
  assert.doesNotMatch(html, /last_name:\{help:/);
  assert.doesNotMatch(html, /email:\{help:/);
  assert.doesNotMatch(html, /phone:\{help:/);
});

test('public journey gets buyer-only explanation without submission dialog markup', () => {
  const home = '<!doctype html><html><head></head><body><main><h1>Journey</h1></main></body></html>';
  const html = addBuyerFirstClarity(home, '/');
  assert.match(html, /helps people buy homes/i);
  assert.doesNotMatch(html, /id="buyer-review-backdrop"/);
  assert.doesNotMatch(html, /id="buyer-first-review-script"/);
});

test('buyer portal gets a focused Now Next Why Time layer while preserving expandable detail', () => {
  const portal = '<!doctype html><html><head></head><body><main><div class="i29-map"><div class="i29-stop current"><strong>Consultation</strong></div></div><section class="i29-next"><div>What’s Next</div><h2>Highest priority right now</h2><strong>Schedule the strategy session</strong><small>Turn answers into understanding</small></section><section class="i29-story"></section><section class="i29-compass"></section><section class="i29-checklist"></section><section class="i29-comp"></section></main></body></html>';
  const html = addBuyerFirstClarity(portal, '/portal');
  assert.match(html, /buyer-portal-focus-script/);
  assert.match(html, />NOW</);
  assert.match(html, /Best next step/);
  assert.match(html, /Why this matters/);
  assert.match(html, /Time/);
  assert.match(html, /See the full 17-stage journey/);
  assert.match(html, /Current-step checklist/);
});
function matches(el, selector) {
  if (!el) return false;
  return selector.split(',').map(s => s.trim()).some(sel => {
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1));
    return String(el.tagName || '').toLowerCase() === sel.toLowerCase();
  });
}

function createEl(tag, attrs = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    type: attrs.type || (tag === 'select' ? 'select-one' : tag === 'textarea' ? 'textarea' : tag === 'button' ? 'button' : 'text'),
    name: attrs.name || '',
    checked: !!attrs.checked,
    dataset: Object.assign({}, attrs.dataset),
    className: attrs.className || '',
    id: attrs.id || '',
    children: [],
    parentNode: attrs.parentNode || null,
    nextSiblings: [],
    listeners: {},
    options: attrs.options || [],
    selectedIndex: attrs.selectedIndex ?? 0,
    textContent: attrs.textContent || '',
    innerHTML: '',
    focused: false,
    insertAdjacentElement(pos, node) {
      if (pos !== 'afterend') throw new Error('unsupported position ' + pos);
      this.nextSiblings.unshift(node);
      node.parentNode = this.parentNode;
      return node;
    },
    closest(sel) {
      let n = this;
      while (n) {
        if (matches(n, sel)) return n;
        n = n.parentNode;
      }
      return null;
    },
    querySelector(sel) {
      const stack = [...(this.children || [])];
      while (stack.length) {
        const n = stack.shift();
        if (matches(n, sel)) return n;
        if (n.children) stack.push(...n.children);
      }
      return null;
    },
    setAttribute(k, v) {
      this.attrs = this.attrs || {};
      this.attrs[k] = v;
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    dispatchEvent(ev) {
      (this.listeners[ev.type] || []).forEach(fn => fn(ev));
      return true;
    },
    focus() { this.focused = true; },
    click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  };
  if (tag.toUpperCase() === 'SELECT') {
    let selectedIndex = attrs.selectedIndex ?? 0;
    Object.defineProperty(el, 'selectedIndex', {
      get() { return selectedIndex; },
      set(v) { selectedIndex = v; }
    });
    Object.defineProperty(el, 'value', {
      get() {
        const opt = this.options[selectedIndex];
        if (!opt) return '';
        return opt.value !== undefined ? opt.value : opt.text;
      },
      set(v) {
        const idx = this.options.findIndex(o => (o.value !== undefined ? o.value : o.text) === v);
        selectedIndex = idx;
      }
    });
  } else {
    el.value = attrs.value ?? '';
  }
  return el;
}

function radioNodeList(controls) {
  const list = { length: controls.length, item(i) { return controls[i] || null; } };
  controls.forEach((c, i) => { list[i] = c; });
  return list;
}

function chipsAfter(el) {
  return (el.nextSiblings || []).find(n => n.className === 'buyer-suggestions') || null;
}

function clickChip(el, label) {
  const chips = chipsAfter(el);
  assert.ok(chips, 'expected suggestion chips after field/group');
  const btn = chips.children.find(b => b.textContent === label);
  assert.ok(btn, 'expected chip labeled ' + label);
  btn.click();
  return btn;
}

function fakeDocument() {
  return { createElement(tag) { return createEl(tag); } };
}

function portalLikeForm() {
  const first_name = createEl('input', { name: 'first_name', type: 'text' });
  const last_name = createEl('input', { name: 'last_name', type: 'text' });
  const email = createEl('input', { name: 'email', type: 'email' });
  const phone = createEl('input', { name: 'phone', type: 'tel' });
  const why = createEl('textarea', { name: 'why' });
  const location = createEl('input', { name: 'location', type: 'text' });
  const notes = createEl('textarea', { name: 'notes' });
  const success_definition = createEl('textarea', { name: 'success_definition' });
  const non_negotiables = createEl('textarea', { name: 'non_negotiables' });
  const unknowns = createEl('textarea', { name: 'unknowns' });
  const saturday_morning_vision = createEl('textarea', { name: 'saturday_morning_vision' });
  const consultation_success = createEl('textarea', { name: 'consultation_success' });
  const past_experience_detail = createEl('textarea', { name: 'past_experience_detail' });
  const timeline = createEl('select', { name: 'timeline' });
  timeline.options = [
    { value: '', text: 'Choose one if helpful' },
    ...TIMELINE_CHIP_VALUES.map(v => ({ value: v, text: v }))
  ];
  timeline.selectedIndex = 0;

  const concernChoices = createEl('div', { id: 'concernChoices', className: 'choices' });
  const concernGroup = createEl('div', { className: 'group' });
  concernChoices.parentNode = concernGroup;
  concernGroup.children.push(concernChoices);
  const boxes = CONCERN_CHIP_VALUES.map(label => {
    const box = createEl('input', { type: 'checkbox', name: 'concerns', value: label });
    box.parentNode = concernChoices;
    concernChoices.children.push(box);
    return box;
  });

  const fields = {
    first_name, last_name, email, phone, why, location, notes, timeline,
    success_definition, non_negotiables, unknowns, saturday_morning_vision, consultation_success, past_experience_detail,
    concerns: radioNodeList(boxes)
  };

  const form = {
    elements: { namedItem(name) { return fields[name] || null; } },
    querySelector(sel) { return sel === '#concernChoices' ? concernChoices : null; },
    fields, boxes, concernChoices
  };
  return form;
}

function workerLikeForm() {
  const fields = {
    first_name: createEl('input', { name: 'first_name' }),
    email: createEl('input', { name: 'email', type: 'email' }),
    why: createEl('textarea', { name: 'why' }),
    timeline: createEl('input', { name: 'timeline', type: 'text' }),
    location: createEl('input', { name: 'location', type: 'text' }),
    concerns: createEl('textarea', { name: 'concerns' }),
    notes: createEl('textarea', { name: 'notes' })
  };
  return {
    elements: { namedItem(name) { return fields[name] || null; } },
    querySelector() { return null; },
    fields
  };
}

test('guided chips use live timeline options and concern checkbox labels', () => {
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  for (const value of TIMELINE_CHIP_VALUES) assert.ok(html.includes(value), value);
  for (const value of CONCERN_CHIP_VALUES) assert.ok(html.includes(value), value);
  assert.equal(html.includes('As soon as it makes sense'), false);
  assert.equal(html.includes('Within 3–6 months'), false);
  assert.doesNotMatch(html, /phone:\{help:/);
});

test('injector does not throw on concerns checkbox group and still chips notes', () => {
  const form = portalLikeForm();
  const named = form.elements.namedItem('concerns');
  assert.equal(named.nodeType, undefined);
  assert.equal(named.dataset, undefined);
  assert.equal(typeof named.length, 'number');
  assert.doesNotThrow(() => installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE));
  assert.ok(chipsAfter(form.concernChoices), 'concerns group should have chips');
  assert.equal(chipsAfter(form.concernChoices).children.length, CONCERN_CHIP_VALUES.length);
  assert.ok(chipsAfter(form.fields.notes), 'notes must still receive chips after concerns');
  assert.ok(chipsAfter(form.fields.timeline), 'timeline should have chips');
  assert.ok(chipsAfter(form.fields.why), 'why should have chips');
  assert.ok(chipsAfter(form.fields.location), 'location should have chips');
  for (const name of REMAINDER_OPEN_FIELDS) {
    assert.ok(chipsAfter(form.fields[name]), name + ' must still receive chips after concerns');
  }
});

test('timeline chips match the six option values and set a real selected option', () => {
  const form = portalLikeForm();
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  const timeline = form.fields.timeline;
  const chipLabels = chipsAfter(timeline).children.map(b => b.textContent);
  assert.deepEqual(chipLabels, TIMELINE_CHIP_VALUES);
  assert.equal(timeline.selectedIndex, 0);
  assert.equal(timeline.value, '');
  clickChip(timeline, '1–3 months');
  assert.equal(timeline.value, '1–3 months');
  assert.equal(timeline.selectedIndex, 2);
  assert.ok(timeline.selectedIndex > 0);
  assert.ok(timeline.options[timeline.selectedIndex]);
  clickChip(timeline, 'Just exploring / unsure');
  assert.equal(timeline.value, 'Just exploring / unsure');
  assert.equal(timeline.selectedIndex, 6);
});

test('concern chips toggle the matching checkbox rather than assigning .value on the list', () => {
  const form = portalLikeForm();
  const list = form.elements.namedItem('concerns');
  Object.defineProperty(list, 'value', {
    set() { throw new Error('must not assign .value on the checkbox NodeList'); },
    get() { return ''; }
  });
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  const paying = form.boxes.find(b => b.value === 'Paying too much');
  assert.equal(paying.checked, false);
  clickChip(form.concernChoices, 'Paying too much');
  assert.equal(paying.checked, true);
  clickChip(form.concernChoices, 'Paying too much');
  assert.equal(paying.checked, false);
  clickChip(form.concernChoices, 'I do not know what I do not know');
  assert.equal(form.boxes.find(b => b.value === 'I do not know what I do not know').checked, true);
});

test('identity fields still have no I do not know or guided chips', () => {
  const form = portalLikeForm();
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  for (const name of IDENTITY_FIELDS) {
    assert.equal(chipsAfter(form.fields[name]), null);
    assert.equal(form.fields[name].dataset.guided, undefined);
    assert.equal(name in BUYER_GUIDANCE, false);
  }
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.doesNotMatch(html, /first_name:\{help:/);
  assert.doesNotMatch(html, /last_name:\{help:/);
  assert.doesNotMatch(html, /email:\{help:/);
  assert.doesNotMatch(html, /phone:\{help:/);
  const identityBlock = html.match(/first_name[\s\S]{0,200}I’m not sure yet/);
  assert.equal(identityBlock, null);
});

test('a throw on one field does not abort remaining fields including notes', () => {
  const form = portalLikeForm();
  const broken = {
    nodeType: 1,
    tagName: 'TEXTAREA',
    type: 'textarea',
    get dataset() { throw new Error('dataset boom'); }
  };
  const orig = form.elements.namedItem.bind(form.elements);
  form.elements.namedItem = (name) => name === 'why' ? broken : orig(name);
  assert.doesNotThrow(() => installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE));
  assert.ok(chipsAfter(form.fields.notes), 'notes chips must survive an earlier field throw');
  assert.ok(chipsAfter(form.concernChoices), 'concerns chips must survive an earlier field throw');
});

test('injector is type-aware for worker.js text concerns and timeline', () => {
  const form = workerLikeForm();
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  assert.ok(chipsAfter(form.fields.concerns));
  assert.ok(chipsAfter(form.fields.timeline));
  clickChip(form.fields.timeline, 'Immediately / within 30 days');
  assert.equal(form.fields.timeline.value, 'Immediately / within 30 days');
  clickChip(form.fields.concerns, 'Hidden property problems');
  assert.equal(form.fields.concerns.value, 'Hidden property problems');
});

test('live portal questionnaire option strings stay 1:1 with chips', () => {
  const portal = readFileSync(new URL('../src/portal-worker.js', import.meta.url), 'utf8');
  for (const value of TIMELINE_CHIP_VALUES) {
    assert.ok(portal.includes(`<option>${value}</option>`), value);
  }
  const joined = CONCERN_CHIP_VALUES.map(v => `'${v}'`).join(',');
  assert.ok(portal.includes(joined), 'concern checkbox labels must match chips 1:1');
});

function helpAfter(el) {
  return (el.nextSiblings || []).find(n => n.className === 'buyer-answer-help') || null;
}

test('remaining optional textareas each receive help and 4-6 starting-point chips', () => {
  const form = portalLikeForm();
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  for (const name of REMAINDER_OPEN_FIELDS) {
    const field = form.fields[name];
    const help = helpAfter(field);
    const chips = chipsAfter(field);
    assert.ok(help, name + ' should have help text');
    assert.match(help.innerHTML, /Need a starting point\?/);
    assert.match(help.innerHTML, /It is okay not to know yet/);
    assert.ok(chips, name + ' should have chips');
    const count = chips.children.length;
    assert.ok(count >= 4 && count <= 6, name + ' should have 4-6 chips, got ' + count);
    assert.deepEqual(chips.children.map(b => b.textContent), BUYER_GUIDANCE[name].suggestions);
    clickChip(field, BUYER_GUIDANCE[name].suggestions[0]);
    assert.equal(field.value, BUYER_GUIDANCE[name].suggestions[0]);
  }
});

test('BUYER_GUIDANCE does not attach I-do-not-know chips to identity or factual fields', () => {
  for (const name of IDENTITY_FIELDS.concat(['situation', 'financing', 'has_other_buyer'])) {
    assert.equal(BUYER_GUIDANCE[name], undefined);
  }
  const form = portalLikeForm();
  installBuyerGuidance(form, fakeDocument(), BUYER_GUIDANCE);
  for (const name of IDENTITY_FIELDS) {
    assert.equal(chipsAfter(form.fields[name]), null);
  }
  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  for (const name of IDENTITY_FIELDS) {
    assert.doesNotMatch(html, new RegExp(name + ':\\{help:'));
  }
  assert.doesNotMatch(html, /first_name[\s\S]{0,80}I don.t know/i);
  assert.doesNotMatch(html, /email[\s\S]{0,80}I.m not sure yet/);
});

test('portal questionnaire privacy and submit copy use review/send verbs', () => {
  const portal = readFileSync(new URL('../src/portal-worker.js', import.meta.url), 'utf8');
  const privacy = portal.match(/class="privacy">[\s\S]*?<\/div>/)[0];
  const submitbox = portal.match(/class="submitbox">[\s\S]*?<\/div>/)[0];
  assert.match(privacy, /Review &amp; Send to HomeBuyer Experts|review and send/i);
  assert.doesNotMatch(privacy, /press <strong>Submit to HBE<\/strong>/);
  assert.doesNotMatch(privacy, /Submit to HBE/);
  assert.match(submitbox, /Review &amp; Send to HomeBuyer Experts/);
  assert.doesNotMatch(submitbox, /Submit to HBE/);
  assert.match(portal, /id="review-before-send"/);

  const ui = readFileSync(new URL('../src/ui-worker.js', import.meta.url), 'utf8');
  assert.match(ui, /Start My Buyer Experience/);
  assert.match(ui, /Nothing is sent until you review and send it/);
  assert.match(ui, /Open my Buyer Portal/);
  assert.match(ui, /See all 17 stages/);
  assert.doesNotMatch(ui, /Submit to HBE/);
  assert.doesNotMatch(ui, /Begin the Buyer Experience/);
  assert.doesNotMatch(ui, /Start the Experience(?!\.)/);
  assert.doesNotMatch(ui, /START HERE|buyer-focus-card/);

  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const workerExplorer = worker.match(/function explorer\(\)\{[\s\S]*?Start My Buyer Experience/)[0];
  assert.match(workerExplorer, /review and send them to HomeBuyer Experts/);
  assert.doesNotMatch(workerExplorer, /Submit to HBE/);

  const html = addBuyerFirstClarity(questionnaire, '/questionnaire');
  assert.match(html, /Review &amp; Send to HomeBuyer Experts|Review before sending/);
  assert.match(html, /Send to HomeBuyer Experts/);
  assert.doesNotMatch(html, />Submit to HBE<\/button>/);

  const live = addBuyerFirstClarity(portal.match(/return `<!doctype html>[\s\S]*?<\/html>`/)[0], '/questionnaire');
  assert.match(live, /Review &amp; Send to HomeBuyer Experts/);
  assert.match(live, /Send to HomeBuyer Experts/);
  assert.doesNotMatch(live, />Submit to HBE<\/button>/);
  const livePrivacy = live.match(/class="privacy">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(livePrivacy, /Submit to HBE/);
});
