import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addBuyerFirstClarity, BUYER_PORTAL_FOCUS_JS, BUYER_FIRST_CSS } from '../src/issue33-production-worker.js';
import { deriveWhatsNext } from '../src/household-state.js';
import { whatsNextPanel } from '../src/issue29-ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const INTERNAL_PHRASES = [
  'Seeded from the current-stage checklist',
  'From a checklist item that created this action',
  'Empty-state fallback is still a useful buyer action',
  'Highest-priority open task'
];

test('Issue #77: focus script is a simple stage card, not a four-cell grid', () => {
  assert.match(BUYER_PORTAL_FOCUS_JS, /buyer-focus-card/);
  assert.match(BUYER_PORTAL_FOCUS_JS, /You.?re here/);
  assert.match(BUYER_PORTAL_FOCUS_JS, /Have your consultation with HBE/);
  assert.match(BUYER_PORTAL_FOCUS_JS, /Nothing else you need to do right now/);
  assert.match(BUYER_PORTAL_FOCUS_JS, /See more/);
  assert.doesNotMatch(BUYER_PORTAL_FOCUS_JS, /buyer-focus-grid/);
  assert.doesNotMatch(BUYER_PORTAL_FOCUS_JS, /Answer \/ act/);
  assert.doesNotMatch(BUYER_PORTAL_FOCUS_JS, /Why this matters/);
  assert.doesNotMatch(BUYER_PORTAL_FOCUS_JS, /className=['"]buyer-roadmap-next['"]/);
  assert.doesNotMatch(BUYER_PORTAL_FOCUS_JS, /What happens next/);
  assert.doesNotMatch(BUYER_FIRST_CSS, /buyer-focus-grid/);
});

test('Issue #77: portal injection keeps one next-action treatment in script source', () => {
  const html = addBuyerFirstClarity(
    `<!doctype html><html><head></head><body><main>
      <div class="i29-map"><div class="i29-stop current" data-stage="consultation"><strong>Consultation</strong><small>Turn answers into understanding</small></div></div>
      <section class="i29-next" id="whats-next"><strong>Continue Consultation: Consultation held</strong><small>Seeded from the current-stage checklist</small></section>
      <section class="i29-story"></section>
      <section class="i29-compass"></section>
      <section class="i29-checklist"></section>
      <section class="i29-comp"></section>
    </main></body></html>`,
    '/portal'
  );
  assert.match(html, /id="buyer-portal-focus-script"/);
  assert.match(html, /Have your consultation with HBE/);
  assert.match(html, /See more/);
  assert.doesNotMatch(html, /buyer-focus-grid/);
  assert.doesNotMatch(html, /className=['"]buyer-roadmap-next['"]/);
  // Script removes .i29-next — only one primary next treatment remains in the focus card.
  assert.match(html, /next\.remove\(\)/);
});

test('Issue #77: buyer-facing deriveWhatsNext never uses internal Seeded phrasing', () => {
  const fromChecklist = deriveWhatsNext({
    stage: 'consultation',
    checklistItems: [{ id: '1', stage_id: 'consultation', title: 'Consultation held', visibility: 'shared' }],
    completions: [],
    tasks: [],
    actor: { kind: 'buyer' }
  });
  assert.equal(fromChecklist.reason, 'Next useful step right now');
  for (const phrase of INTERNAL_PHRASES) {
    assert.doesNotMatch(fromChecklist.reason, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const labeled = deriveWhatsNext({
    stage: 'consultation',
    checklistItems: [],
    completions: [],
    tasks: [{ id: 't1', title: 'Have consultation', status: 'open', visibility: 'shared', is_whats_next: 1, priority: 'high', source: 'checklist' }],
    actor: { kind: 'buyer' }
  });
  assert.equal(labeled.reason, 'Next useful step right now');

  const empty = deriveWhatsNext({
    stage: 'consultation',
    checklistItems: [],
    completions: [],
    tasks: [],
    actor: { kind: 'buyer' }
  });
  assert.equal(empty.reason, 'Best next step');
});

test('Issue #77: HBE still keeps seeded checklist reason for operational depth', () => {
  const hbe = deriveWhatsNext({
    stage: 'consultation',
    checklistItems: [{ id: '1', stage_id: 'consultation', title: 'Consultation held', visibility: 'shared' }],
    completions: [],
    tasks: [],
    actor: { kind: 'hbe' }
  });
  assert.equal(hbe.reason, 'Seeded from the current-stage checklist');
});

test('Issue #77: buyer whatsNextPanel HTML has no internal Seeded phrase', () => {
  const panel = whatsNextPanel({
    stage: 'consultation',
    checklistItems: [{ id: '1', stage_id: 'consultation', title: 'Consultation held', visibility: 'shared' }],
    completions: [],
    tasks: [],
    actor: { kind: 'buyer', id: 'b1' }
  });
  assert.doesNotMatch(panel, /Seeded from the current-stage checklist/);
  assert.match(panel, /Next useful step right now/);
});

test('Issue #77: production rewrite strips Seeded phrase if it appears in HTML', () => {
  const src = read('src/issue29-production-worker.js');
  assert.match(src, /Seeded from the current-stage checklist',\s*'Next useful step right now'/);
  assert.match(src, /pathname !== '\/portal'/);
});

test('Issue #77: focus runtime builds Consultation card and one See more (no duplicate next)', () => {
  function makeEl(tag, attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      className: attrs.className || '',
      id: attrs.id || '',
      attributes: { ...(attrs.attrs || {}) },
      children: [],
      parentNode: null,
      textContent: attrs.textContent || '',
      innerHTML: '',
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      querySelector(sel) { return query(this, sel); },
      querySelectorAll(sel) { return queryAll(this, sel); },
      append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } },
      appendChild(k) { k.parentNode = this; this.children.push(k); return k; },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
        this.parentNode = null;
      },
      insertBefore(neu, ref) {
        neu.parentNode = this;
        if (!ref) { this.children.push(neu); return neu; }
        const i = this.children.indexOf(ref);
        if (i < 0) this.children.push(neu);
        else this.children.splice(i, 0, neu);
        return neu;
      }
    };
    if (attrs['data-stage']) el.attributes['data-stage'] = attrs['data-stage'];
    return el;
  }

  function matchOne(el, sel) {
    if (sel.startsWith('.')) {
      const parts = sel.slice(1).split('.').filter(Boolean);
      return parts.every(p => String(el.className || '').split(/\s+/).includes(p));
    }
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.includes('.')) {
      const bits = sel.split('.');
      const tag = bits[0];
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      return bits.slice(1).every(p => String(el.className || '').split(/\s+/).includes(p));
    }
    return String(el.tagName || '').toLowerCase() === sel.toLowerCase();
  }

  function walk(root, fn) {
    fn(root);
    for (const c of root.children || []) walk(c, fn);
  }

  function query(root, sel) {
    if (sel.startsWith(':scope > ')) {
      const childSel = sel.slice(':scope > '.length);
      return (root.children || []).find(c => matchOne(c, childSel)) || null;
    }
    let found = null;
    const parts = sel.split(/\s+/);
    if (parts.length > 1) {
      walk(root, el => {
        if (found) return;
        if (matchOne(el, parts[0])) {
          const hit = query(el, parts.slice(1).join(' '));
          if (hit) found = hit;
        }
      });
      return found;
    }
    walk(root, el => { if (!found && matchOne(el, sel)) found = el; });
    return found;
  }

  function queryAll(root, sel) {
    const out = [];
    for (const p of sel.split(',')) {
      walk(root, el => { if (matchOne(el, p.trim())) out.push(el); });
    }
    return out;
  }

  const documentElement = makeEl('html');
  documentElement.classList = {
    _v: new Set(),
    add(...xs) { for (const x of xs) this._v.add(x); documentElement.className = [...this._v].join(' '); },
    remove(...xs) { for (const x of xs) this._v.delete(x); documentElement.className = [...this._v].join(' '); },
    contains(x) { return this._v.has(x); }
  };
  const main = makeEl('main');
  const map = makeEl('div', { className: 'i29-map' });
  const stopInner = makeEl('div');
  const strong = makeEl('strong', { textContent: 'Consultation' });
  strong.textContent = 'Consultation';
  const small = makeEl('small', { textContent: 'Turn answers into understanding' });
  small.textContent = 'Turn answers into understanding';
  stopInner.append(strong, small);
  const stop = makeEl('div', { className: 'i29-stop current' });
  stop.setAttribute('data-stage', 'consultation');
  stop.append(stopInner);
  map.append(stop);

  const nextStrong = makeEl('strong', { textContent: 'Continue Consultation: Consultation held' });
  nextStrong.textContent = 'Continue Consultation: Consultation held';
  const nextSmall = makeEl('small', { textContent: 'Seeded from the current-stage checklist' });
  nextSmall.textContent = 'Seeded from the current-stage checklist';
  const next = makeEl('section', { className: 'i29-next', id: 'whats-next' });
  next.id = 'whats-next';
  next.append(nextStrong, nextSmall);

  const story = makeEl('section', { className: 'i29-story' });
  const compass = makeEl('section', { className: 'i29-compass' });
  const checklist = makeEl('section', { className: 'i29-checklist' });
  const comp = makeEl('section', { className: 'i29-comp' });
  main.append(map, next, story, compass, checklist, comp);
  const body = makeEl('body');
  body.append(main);
  documentElement.append(body);

  const document = {
    documentElement,
    querySelector(sel) {
      if (sel === 'main') return main;
      if (sel === '.buyer-focus-card') return query(documentElement, '.buyer-focus-card');
      if (sel === '.i29-next') return query(documentElement, '.i29-next');
      if (sel === '.i29-stop.current') return stop;
      if (sel === '.i29-stop.current strong') return strong;
      if (sel === '.i29-map') return map;
      if (sel === '.i29-story') return story;
      if (sel === '.i29-compass') return compass;
      if (sel === '.i29-checklist') return checklist;
      if (sel === '.i29-comp') return comp;
      if (sel === '.buyer-more') return query(documentElement, '.buyer-more');
      return query(documentElement, sel);
    },
    querySelectorAll(sel) { return queryAll(documentElement, sel); },
    createElement(tag) { return makeEl(tag); }
  };

  const iife = BUYER_PORTAL_FOCUS_JS
    .replace(/^[\s\S]*?<script[^>]*>/, '')
    .replace(/<\/script>[\s\S]*$/, '');
  const runner = new Function('document', iife);
  runner(document);

  const card = document.querySelector('.buyer-focus-card');
  assert.ok(card, 'focus card created');
  assert.match(card.innerHTML, /Consultation/);
  assert.match(card.innerHTML, /You.?re here/);
  assert.match(card.innerHTML, /Have your consultation with HBE/);
  assert.match(card.innerHTML, /Nothing else you need to do right now/);
  assert.doesNotMatch(card.innerHTML, /buyer-focus-grid/);
  assert.doesNotMatch(card.innerHTML, /Seeded from/);
  assert.equal(document.querySelector('.i29-next'), null, 'duplicate What’s Next removed');

  const more = document.querySelector('.buyer-more');
  assert.ok(more, 'See more present');
  const summary = more.children.find(c => c.tagName === 'SUMMARY');
  assert.equal(summary?.textContent, 'See more');
  assert.equal(document.querySelectorAll('.buyer-more').length, 1);
  const bodyEl = more.children.find(c => String(c.className).includes('buyer-more-body'));
  assert.ok(bodyEl);
  const classes = bodyEl.children.map(c => c.className);
  assert.ok(classes.includes('i29-map'));
  assert.ok(classes.includes('i29-checklist'));
});

