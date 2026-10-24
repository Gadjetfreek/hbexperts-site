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
    help: 'Add anything the other answers have not covered.',
    suggestions: ['Nothing else right now', 'I’d rather discuss this live', 'I’m still figuring things out']
  },
  success_definition: {
    help: 'Picture an ordinary day in your next home and what would feel better.',
    suggestions: ['We felt settled', 'The house still fits our life', 'Less stress about the next move', 'Room for how we actually live', 'I’m not sure yet what “right” looks like', 'We would choose it again']
  },
  non_negotiables: {
    help: 'Add any firm limits you already know.',
    suggestions: ['None yet', 'Commute must work', 'Budget ceiling is real', 'Enough bedrooms for us', 'Quiet enough to rest', 'I’m still naming these']
  },
  unknowns: {
    help: 'Name the gaps. You do not need the real-estate vocabulary — “I don’t know what I don’t know” is useful.',
    suggestions: ['I don’t know what I don’t know', 'Financing details', 'Which areas fit', 'What I can really afford monthly', 'How offers actually work', 'What I should ask first']
  },
  saturday_morning_vision: {
    help: 'A sensory snapshot is enough: who is there, what you hear, how the morning feels. Skip it if nothing comes yet.',
    suggestions: ['Coffee, quiet, sunlight', 'Kids nearby, unhurried', 'Slow start, no commute rush', 'Walk to Saturday errands', 'Windows open to the yard', 'I’m still picturing it']
  },
  consultation_success: {
    help: 'Name a question, a concern, or a next step you would like to work through.',
    suggestions: ['Understand what I can afford', 'Understand the process', 'Know if HBE is a fit', 'Leave with a clear next step', 'See what I might be missing', 'I’m not sure what I need yet']
  },
  past_experience_detail: {
    help: 'Share what worked well or what you would like handled differently.',
    suggestions: ['First-time buyer', 'Want less pressure this time', 'Nothing specific', 'Felt rushed before', 'Want more teaching, less selling', 'Prefer to discuss live']
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
    if (typeof first.closest === 'function') {
      const label = first.closest('label');
      if (label) return label;
    }
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

  /** Uncertainty paths stay plain; example answers are labeled (Issue #65). */
  function isUncertaintySuggestion(suggestion) {
    return /not sure yet|none yet|still figuring|still naming|still picturing|don.?t know what i don.?t know|nothing else right now|rather discuss|nothing specific|first-time buyer|prefer to discuss live|i.?m still /i.test(String(suggestion || ''));
  }

  function chipLabel(suggestion, kind) {
    if (kind === 'checkbox' || kind === 'radio' || kind === 'select') return suggestion;
    if (isUncertaintySuggestion(suggestion)) return suggestion;
    return 'Example: ' + suggestion;
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
      const kind = fieldKind(first);
      // Selects and choice groups already display their available answers.
      if (kind !== 'text') continue;
      first.dataset.guided = 'yes';
      const anchor = insertAnchor(name, first);
      if (!anchor || typeof anchor.insertAdjacentElement !== 'function') continue;
      const examples = doc.createElement('details');
      examples.className = 'buyer-answer-examples';
      const summary = doc.createElement('summary');
      summary.textContent = 'Need an example?';
      const help = doc.createElement('small');
      help.className = 'buyer-answer-help';
      help.textContent = cfg.help + ' Choose an example to use it, or write your own answer.';
      const chips = doc.createElement('div');
      chips.className = 'buyer-suggestions';
      chips.setAttribute('aria-label', 'Answer examples');
      const suggestions = cfg.suggestions || [];
      for (let s = 0; s < suggestions.length; s++) {
        const suggestion = suggestions[s];
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'buyer-suggestion';
        button.dataset.value = suggestion;
        button.textContent = chipLabel(suggestion, kind);
        button.addEventListener('click', function () { applySuggestion(name, suggestion); });
        chips.appendChild(button);
      }
      examples.appendChild(summary);
      examples.appendChild(help);
      examples.appendChild(chips);
      anchor.insertAdjacentElement('afterend', examples);
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
