export const TIMELINE_CHIP_VALUES = [
  'Immediately / within 30 days',
  '1–3 months',
  '3–6 months',
  '6–12 months',
  'More than a year',
  'Just exploring / unsure'
];

export const CONCERN_CHIP_VALUES = [
  'Paying too much',
  'Choosing the wrong area',
  'Hidden property problems',
  'Financing / monthly cost',
  'Negotiating effectively',
  'Timing / market conditions',
  'Inspection issues',
  'Making the wrong decision',
  'I do not know what I do not know'
];

export const BUYER_GUIDANCE = {
  why: {
    help: 'A sentence or two is enough. Think about what is changing, what you want more of, or what is pushing the idea forward.',
    suggestions: ['Need more space', 'Want a different location', 'Life or family change', 'Rent no longer feels right', 'Just exploring', 'I’m not sure yet']
  },
  timeline: {
    help: 'This can be approximate. There is no penalty for not having a timeline yet.',
    suggestions: TIMELINE_CHIP_VALUES
  },
  location: {
    help: 'You can name a city, commute, school area, neighborhood feel, or simply say you are still open.',
    suggestions: ['Near work', 'Near family', 'Akron area', 'Open to several areas', 'Commute matters most', 'I’m not sure yet']
  },
  concerns: {
    help: 'Anything that makes you hesitate belongs here. You do not need to know the real-estate vocabulary.',
    suggestions: CONCERN_CHIP_VALUES
  },
  notes: {
    help: 'Optional. Use this only if there is something you want a human at HBE to understand before talking with you.',
    suggestions: ['Nothing else right now', 'I’d rather discuss this live', 'I’m still figuring things out']
  }
};

/**
 * Self-contained injector for the Buyer Experience form.
 * Safe to Function.prototype.toString() into the page script: no outer-scope references.
 */
export function installBuyerGuidance(form, doc, guide) {
  if (!form || !doc) return;

  function isElement(node) {
    return !!(node && node.nodeType === 1);
  }

  function firstControl(named) {
    if (!named) return null;
    if (isElement(named)) return named;
    if (typeof named.length === 'number') {
      const node = named[0] || (typeof named.item === 'function' ? named.item(0) : null);
      return isElement(node) ? node : node || null;
    }
    return named;
  }

  function allControls(named) {
    if (!named) return [];
    if (isElement(named)) return [named];
    if (typeof named.length === 'number') {
      const out = [];
      for (let i = 0; i < named.length; i++) {
        const node = named[i] || (typeof named.item === 'function' ? named.item(i) : null);
        if (node) out.push(node);
      }
      return out;
    }
    return [named];
  }

  function fieldKind(el) {
    const type = String((el && el.type) || '').toLowerCase();
    const tag = String((el && el.tagName) || '').toUpperCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (tag === 'SELECT' || type === 'select-one' || type === 'select-multiple') return 'select';
    return 'text';
  }

  function insertAnchor(name, first) {
    const kind = fieldKind(first);
    if (kind === 'checkbox' || kind === 'radio') {
      if (name === 'concerns' && typeof form.querySelector === 'function') {
        const box = form.querySelector('#concernChoices');
        if (box) return box;
      }
      if (typeof first.closest === 'function') {
        const group = first.closest('#concernChoices, .choices, .group');
        if (group) return group;
      }
    }
    return first;
  }

  function applySuggestion(name, suggestion) {
    const named = form.elements.namedItem(name);
    const first = firstControl(named);
    if (!first) return;
    const kind = fieldKind(first);
    if (kind === 'checkbox' || kind === 'radio') {
      const match = allControls(named).find(function (el) { return el.value === suggestion; });
      if (!match) return;
      if (kind === 'checkbox') match.checked = !match.checked;
      else match.checked = true;
      match.dispatchEvent(new Event('input', { bubbles: true }));
      match.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof match.focus === 'function') match.focus();
      return;
    }
    first.value = suggestion;
    first.dispatchEvent(new Event('input', { bubbles: true }));
    if (kind === 'select') first.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof first.focus === 'function') first.focus();
  }

  const entries = Object.entries(guide);
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i][0];
    const cfg = entries[i][1];
    try {
      const named = form.elements.namedItem(name);
      const first = firstControl(named);
      if (!first) continue;
      if (!first.dataset) continue;
      if (first.dataset.guided === 'yes') continue;
      first.dataset.guided = 'yes';
      const anchor = insertAnchor(name, first);
      if (!anchor || typeof anchor.insertAdjacentElement !== 'function') continue;
      const help = doc.createElement('small');
      help.className = 'buyer-answer-help';
      help.innerHTML = '<strong>Need a starting point?</strong> ' + cfg.help + ' It is okay not to know yet.';
      const chips = doc.createElement('div');
      chips.className = 'buyer-suggestions';
      chips.setAttribute('aria-label', 'Answer suggestions');
      const suggestions = cfg.suggestions || [];
      for (let s = 0; s < suggestions.length; s++) {
        const suggestion = suggestions[s];
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'buyer-suggestion';
        button.textContent = suggestion;
        button.addEventListener('click', function () { applySuggestion(name, suggestion); });
        chips.appendChild(button);
      }
      anchor.insertAdjacentElement('afterend', chips);
      anchor.insertAdjacentElement('afterend', help);
    } catch (_err) {
      /* A throw/mismatch on one field must not abort remaining fields. */
    }
  }
}

export function buyerGuidanceRuntimeScript() {
  const guide = '{' + Object.entries(BUYER_GUIDANCE).map(([name, cfg]) => (
    name + ':{help:' + JSON.stringify(cfg.help) + ',suggestions:' + JSON.stringify(cfg.suggestions) + '}'
  )).join(',') + '}';
  return '(()=>{\n' +
    '  const form=document.getElementById(\'buyerExperienceForm\'); if(!form)return;\n' +
    '  const guide=' + guide + ';\n' +
    '  (' + installBuyerGuidance.toString() + ')(form,document,guide);\n' +
    '})();';
}
