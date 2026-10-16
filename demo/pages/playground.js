// playground.js — Every option on one live counter: a preview that stays in view, grouped options, the code
// for each framework (plus the CSS) and the events log. The state lives in the URL, so a setup can be shared.

import { GENERATORS, SYNTAXES, SYNTAX_NOTES } from '../snippets.js';
import { announce, codeBlock, copyText, debounce, h, icon, pageHeader, rich, segmented, tabSet, ticker, toggle } from '../ui.js';

/** Starting state: the library defaults (the code lists only what differs) and the demo's style controls. */
const DEFAULTS = {
  value: 1234,
  interpolate: true,
  duration: null,
  easing: '',
  pad: 1,
  decimals: null,
  max: null,
  overflowSuffix: '',
  locale: '',
  style: '',
  currency: 'EUR',
  unit: 'kilometer-per-hour',
  signDisplay: '',
  prefixText: '',
  suffixText: '',
  label: '',
  live: false,
  font: 'sans',
  effect: 'none',
  decoration: '',
};

/** Numeric options that are unset (`null`) by default. */
const NULLABLE = new Set(['duration', 'decimals', 'max']);

const EASINGS = [
  ['', 'auto'],
  ['ease-out-cubic', 'ease-out-cubic'],
  ['odometer', 'odometer'],
  ['ease-out-expo', 'ease-out-expo'],
  ['ease-in-out', 'ease-in-out'],
  ['linear', 'linear'],
  ['cubic-bezier(0.34, 1.56, 0.64, 1)', 'back-out · cubic-bezier(…)'],
  ['steps(6)', 'steps(6)'],
];
const LOCALES = [['', 'none · plain digits'], ...['en-US', 'en-GB', 'it-IT', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP', 'zh-CN', 'hi-IN', 'ar-EG'].map((code) => [code, code])];
const STYLES = [['', 'number'], ['currency', 'currency'], ['percent', 'percent'], ['unit', 'unit']];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'INR'].map((code) => [code, code]);
const UNITS = ['kilometer-per-hour', 'celsius', 'kilogram', 'megabyte', 'liter', 'meter', 'second'].map((unit) => [unit, unit]);
const SIGNS = [['', 'auto'], ['always', 'always'], ['exceptZero', 'exceptZero'], ['negative', 'negative'], ['never', 'never']];

const FONTS = { sans: null, mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', serif: "'Iowan Old Style', Palatino, Georgia, serif" };
const GRADIENT = 'linear-gradient(180deg, #c084fc, #4f46e5)';
const SYNTAX_KEY = 'rn-demo-syntax';

const rand = (min, max) => Math.round(min + Math.random() * (max - min));
const round = (value) => Math.round(value * 1e6) / 1e6;
const formatNumber = (value) => (typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(value));

/** Reads the state from the URL query, ignoring anything unknown or invalid. */
function fromQuery(query) {
  const state = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!query.has(key)) continue;
    const raw = /** @type {string} */ (query.get(key));
    if (typeof fallback === 'boolean') state[key] = raw === 'true';
    else if (typeof fallback === 'number' || NULLABLE.has(key)) {
      const number = raw === '' ? NaN : Number(raw);
      if (Number.isFinite(number)) state[key] = number;
    } else state[key] = raw.slice(0, 80);
  }
  return state;
}

function formatOf(state) {
  const format = {};
  if (state.style) format.style = state.style;
  if (state.style === 'currency') format.currency = state.currency;
  if (state.style === 'unit') format.unit = state.unit;
  if (state.signDisplay) format.signDisplay = state.signDisplay;
  return Object.keys(format).length ? format : null;
}

/** The options that differ from the defaults, in a stable order: what the code shows. */
function optionsOf(state) {
  const options = { value: state.value };
  if (state.pad !== 1) options.pad = state.pad;
  if (state.max !== null) options.max = state.max;
  if (state.overflowSuffix) options.overflowSuffix = state.overflowSuffix;
  if (!state.interpolate) options.interpolate = false;
  if (state.duration !== null) options.duration = state.duration;
  if (state.easing) options.easing = state.easing;
  if (state.decimals !== null) options.decimals = state.decimals;
  if (state.locale) options.locale = state.locale;
  const format = formatOf(state);
  if (format) options.format = format;
  if (state.prefixText) options.prefixText = state.prefixText;
  if (state.suffixText) options.suffixText = state.suffixText;
  if (state.label) options.label = state.label;
  if (state.live) options.live = 'polite';
  return options;
}

/** CSS declarations for the style controls (empty when the counter just inherits). */
function cssOf(state) {
  const rules = [];
  if (FONTS[state.font]) rules.push(`font-family: ${FONTS[state.font]};`);
  if (state.effect === 'gradient') rules.push(`--rn-fill: ${GRADIENT};`, 'color: transparent;');
  if (state.effect === 'glow') rules.push('text-shadow: 0 0 0.25em #818cf8;', '--rn-lh: 1.8;            /* a taller window… */', '--rn-bleed: 0.3em;       /* …that lets the glow out */');
  if (state.decoration) rules.push(`--rn-decoration: ${state.decoration};`);
  return rules;
}

const changedKeys = (state) => Object.keys(DEFAULTS).filter((key) => key !== 'value' && state[key] !== DEFAULTS[key]);

export function mount(view, { query }) {
  const state = fromQuery(query);
  /** @type {(() => void)[]} */
  const disposers = [];

  // --- The preview element (created once, updated through its properties) ----------------

  const preview = /** @type {any} */ (document.createElement('rolling-number'));
  preview.className = 'preview-counter';
  preview.value = state.value;

  function applyOptions() {
    preview.interpolate = state.interpolate;
    preview.duration = state.duration;
    preview.easing = state.easing || null;
    preview.pad = state.pad;
    preview.decimals = state.decimals;
    preview.max = state.max;
    preview.overflowSuffix = state.overflowSuffix || null;
    preview.locale = state.locale || null;
    preview.format = formatOf(state);
    preview.prefixText = state.prefixText || null;
    preview.suffixText = state.suffixText || null;
    preview.label = state.label || null;
    preview.live = state.live ? 'polite' : null;

    preview.dataset.font = state.font;
    preview.dataset.effect = state.effect;
    const style = preview.style;
    if (state.effect === 'gradient') {
      style.setProperty('--rn-fill', GRADIENT);
      style.setProperty('color', 'transparent');
    } else {
      style.removeProperty('--rn-fill');
      style.removeProperty('color');
    }
    for (const [name, value] of [['--rn-lh', '1.8'], ['--rn-bleed', '0.3em']]) {
      if (state.effect === 'glow') style.setProperty(name, value);
      else style.removeProperty(name);
    }
    if (state.decoration) style.setProperty('--rn-decoration', state.decoration);
    else style.removeProperty('--rn-decoration');
  }
  applyOptions();

  // --- Events log ------------------------------------------------------------------------

  const log = h('ol', { class: 'events-log', 'data-empty': 'Change the value to see rn-start, rn-end and the promise.', reversed: true });
  const eventCount = h('span', { class: 'count', text: '0' });
  let events = 0;
  const addEvent = (type, text) => {
    events++;
    eventCount.textContent = String(events);
    eventCount.toggleAttribute('data-active', events > 0);
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
    log.prepend(h('li', { class: 'event-item' }, h('span', { class: 'event-type', 'data-type': type, text: type }), h('span', { text }), h('time', { text: time })));
    while (log.children.length > 40) log.lastElementChild?.remove();
  };
  const onEvent = (event) => {
    const { value, from, animated } = event.detail;
    addEvent(event.type, `value ${formatNumber(value)} · from ${formatNumber(from)} · ${animated ? 'animated' : 'instant'}`);
  };
  preview.addEventListener('rn-start', onEvent);
  preview.addEventListener('rn-end', onEvent);
  disposers.push(() => {
    preview.removeEventListener('rn-start', onEvent);
    preview.removeEventListener('rn-end', onEvent);
  });

  // --- Value -----------------------------------------------------------------------------

  const valueInput = h('input', { class: 'input', id: 'pg-value', type: 'number', step: 'any', inputmode: 'decimal', value: String(state.value) });

  function setValue(next) {
    if (!Number.isFinite(next)) return;
    state.value = round(next);
    valueInput.value = String(state.value);
    const started = performance.now();
    preview.setValue(state.value).then(({ completed }) => {
      addEvent('promise', completed ? `setValue() resolved in ${Math.round(performance.now() - started)} ms` : 'setValue() resolved with completed: false (replaced)');
    });
    changed();
  }

  const randomValue = () => {
    if (state.style === 'percent') return rand(0, 1000) / 1000;
    if (state.style === 'currency' || state.decimals) return rand(0, 9_999_999) / 100;
    return rand(0, 99_999);
  };

  const stepButtons = h('div', { style: { display: 'contents' } });
  const renderSteps = () => {
    const steps = state.style === 'percent' ? [[-0.1, '−10%'], [-0.01, '−1%'], [0.01, '+1%'], [0.1, '+10%']] : [[-100, '−100'], [-1, '−1'], [1, '+1'], [100, '+100']];
    stepButtons.replaceChildren(
      ...steps.map(([step, label]) => h('button', { type: 'button', class: 'btn', text: label, 'aria-label': `${step > 0 ? 'Add' : 'Subtract'} ${label.slice(1)}`, onclick: () => setValue(state.value + step) })),
    );
  };
  renderSteps();

  const autoplay = ticker(() => setValue(randomValue()), 2000);
  autoplay.set(false);
  disposers.push(autoplay.stop);
  const autoplayToggle = toggle('Autoplay', { onChange: (on) => autoplay.set(on) });

  const previewCard = h(
    'section',
    { class: 'card panel preview-card', 'aria-labelledby': 'pg-preview-title', style: { order: '1' } },
    h('div', { class: 'panel-head' }, h('h2', { id: 'pg-preview-title', text: 'Preview' }), h('div', { class: 'preview-toolbar' }, autoplayToggle.element)),
    h('div', { class: 'stage preview-stage' }, preview),
    h(
      'div',
      { class: 'value-bar', role: 'group', 'aria-label': 'Change the value' },
      stepButtons,
      h('button', { type: 'button', class: 'btn', text: '±', 'aria-label': 'Flip the sign', title: 'Flip the sign', onclick: () => setValue(-state.value || -1234) }),
      h('button', { type: 'button', class: 'btn', 'aria-label': 'Random value', title: 'Random value', onclick: () => setValue(randomValue()) }, icon('shuffle')),
    ),
  );

  // --- Options ---------------------------------------------------------------------------

  /** @type {Map<string, () => void>} Re-syncs each control from the state (after a reset). */
  const syncers = new Map();
  /** @type {Map<string, HTMLElement>} */
  const fields = new Map();

  const field = (key, label, control, hint) => {
    const element = h(
      'div',
      { class: 'field' },
      control.tagName === 'FIELDSET' ? null : h('label', { class: 'field-label', for: control.id }, rich(label)),
      control,
      hint ? h('p', { class: 'field-hint' }, rich(hint)) : null,
    );
    fields.set(key, element);
    return element;
  };

  const numberField = (key, label, hint, { min, max, step = 1, placeholder = '' } = {}) => {
    const input = h('input', { class: 'input', id: `pg-${key}`, type: 'number', inputmode: 'decimal', min, max, step, placeholder });
    const sync = () => (input.value = state[key] === null ? '' : String(state[key]));
    input.addEventListener('input', () => {
      const number = input.value.trim() === '' ? NaN : Number(input.value);
      state[key] = Number.isFinite(number) ? number : NULLABLE.has(key) ? null : DEFAULTS[key];
      applyOptions();
      changed();
    });
    syncers.set(key, sync);
    sync();
    return field(key, label, input, hint);
  };

  const textField = (key, label, hint, placeholder) => {
    const input = h('input', { class: 'input', id: `pg-${key}`, type: 'text', placeholder, maxlength: '40', autocomplete: 'off' });
    const sync = () => (input.value = state[key]);
    input.addEventListener('input', () => {
      state[key] = input.value;
      applyOptions();
      changed();
    });
    syncers.set(key, sync);
    sync();
    return field(key, label, input, hint);
  };

  const selectField = (key, label, hint, choices, after) => {
    const select = h('select', { class: 'select', id: `pg-${key}` }, choices.map(([value, text]) => h('option', { value, text })));
    const sync = () => (select.value = state[key]);
    select.addEventListener('change', () => {
      state[key] = select.value;
      applyOptions();
      after?.();
      changed();
    });
    syncers.set(key, sync);
    sync();
    return field(key, label, select, hint);
  };

  const segmentField = (key, label, choices, hint, toValue = (value) => value, fromValue = (value) => value) => {
    const control = segmented({
      legend: label,
      options: choices.map(([value, text]) => ({ value, label: text })),
      value: fromValue(state[key]),
      onChange: (value) => {
        state[key] = toValue(value);
        applyOptions();
        changed();
      },
    });
    syncers.set(key, () => control.set(fromValue(state[key])));
    return field(key, label, control.element, hint);
  };

  const liveSwitch = toggle('Announce settled values (`live: \'polite\'`)', {
    checked: state.live,
    onChange: (on) => {
      state.live = on;
      applyOptions();
      changed();
    },
  });
  syncers.set('live', () => (liveSwitch.input.checked = state.live));
  fields.set('live', liveSwitch.element);

  const currencyField = selectField('currency', '`format.currency`', null, CURRENCIES);
  const unitField = selectField('unit', '`format.unit`', null, UNITS);
  const percentHint = h('p', { class: 'hint-box' }, rich('Percent multiplies by 100: the value `0.25` shows `25%`.'));
  const syncFormat = () => {
    currencyField.hidden = state.style !== 'currency';
    unitField.hidden = state.style !== 'unit';
    percentHint.hidden = state.style !== 'percent';
    renderSteps();
  };

  const valueForm = h(
    'form',
    { class: 'row', onsubmit: (event) => { event.preventDefault(); setValue(Number(valueInput.value)); } },
    valueInput,
    h('button', { type: 'submit', class: 'btn btn-primary', text: 'Animate' }),
  );

  const group = (legend, ...children) => {
    const id = `pg-group-${legend.toLowerCase().replace(/\W+/g, '-')}`;
    return h('div', { class: 'opt-group', role: 'group', 'aria-labelledby': id }, h('h3', { class: 'opt-legend', id, text: legend }), children);
  };

  const changedCount = h('span', { class: 'count' });
  const optionsCard = h(
    'section',
    { class: 'card panel', 'aria-labelledby': 'pg-options-title', style: { order: '2' } },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { id: 'pg-options-title' }, 'Options', changedCount),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => resetAll() }, icon('reset'), 'Reset all'),
    ),
    h(
      'div',
      { class: 'panel-body' },
      group('Value', h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'pg-value', text: 'Animate to' }), valueForm, h('p', { class: 'field-hint' }, rich('Same as `counter.setValue(n)` — or use the buttons under the preview.')))),
      group(
        'Motion',
        segmentField('interpolate', '`interpolate`', [['count', 'Count'], ['roll', 'Roll']], 'Count goes through the values in between; roll turns each digit straight to its new digit.', (value) => value === 'count', (value) => (value ? 'count' : 'roll')),
        h(
          'div',
          { class: 'opt-pair' },
          numberField('duration', '`duration`', 'ms · empty = auto (400 counting, 500 rolling)', { min: 0, max: 10000, step: 50, placeholder: 'auto' }),
          selectField('easing', '`easing`', null, EASINGS),
        ),
      ),
      group(
        'Digits',
        h(
          'div',
          { class: 'opt-pair' },
          numberField('pad', '`pad`', 'Minimum digits: `pad: 4` → `0042`', { min: 1, max: 12 }),
          numberField('decimals', '`decimals`', 'Fraction digits; empty = auto', { min: 0, max: 6, placeholder: 'auto' }),
          numberField('max', '`max`', 'Display limit, e.g. `99`', { min: 0, placeholder: 'none' }),
          textField('overflowSuffix', '`overflowSuffix`', 'Shown above `max`: `99+`', '+'),
        ),
      ),
      group(
        'Format',
        h('div', { class: 'opt-pair' }, selectField('locale', '`locale`', null, LOCALES), selectField('style', '`format.style`', null, STYLES, syncFormat)),
        h('div', { class: 'opt-pair' }, currencyField, unitField, selectField('signDisplay', '`format.signDisplay`', null, SIGNS)),
        percentHint,
        h('div', { class: 'opt-pair' }, textField('prefixText', '`prefixText`', null, '≈ '), textField('suffixText', '`suffixText`', null, ' pts')),
      ),
      group('Accessibility', textField('label', '`label`', 'Accessible name; `{value}` is the formatted value', '{value} points'), liveSwitch.element),
      group(
        'Style (CSS)',
        segmentField('font', 'Font', [['sans', 'Sans'], ['mono', 'Mono'], ['serif', 'Serif']]),
        segmentField('effect', 'Effect', [['none', 'None'], ['gradient', 'Gradient'], ['glow', 'Glow']], 'Uses `--rn-fill` and `--rn-bleed`: plain CSS on the host.'),
        segmentField('decoration', '`--rn-decoration`', [['', 'None'], ['underline', 'Underline'], ['line-through', 'Strike']]),
      ),
    ),
  );
  syncFormat();

  // --- Code --------------------------------------------------------------------------------

  /** @type {Map<string, { set: (text: string) => void }>} */
  const blocks = new Map();
  const notes = new Map();
  const codeFor = (id) => {
    const css = cssOf(state);
    if (id === 'css') return css.length ? `.counter {\n  ${css.join('\n  ')}\n}` : '/* No custom CSS: the counter inherits the font, size and color of its host. */';
    return GENERATORS[id](optionsOf(state), css.length ? 'counter' : '');
  };
  const refreshCode = () => {
    for (const [id, block] of blocks) block.set(codeFor(id));
    const css = cssOf(state).length > 0;
    for (const [id, note] of notes) if (id !== 'css') note.lastElementChild.hidden = !css;
  };

  let savedSyntax = 'html';
  try {
    savedSyntax = localStorage.getItem(SYNTAX_KEY) ?? 'html';
  } catch {
    // Storage blocked: HTML first.
  }
  const codeTabs = tabSet(
    [...SYNTAXES, { id: 'css', label: 'CSS' }].map((syntax) => ({
      id: syntax.id,
      label: syntax.label,
      panel: () => {
        const block = codeBlock(codeFor(syntax.id), { label: `${syntax.label} code`, caption: syntax.id === 'css' ? 'styles.css' : syntax.label });
        blocks.set(syntax.id, block);
        const note = h(
          'div',
          { class: 'code-notes' },
          h('p', { class: 'field-hint' }, rich(syntax.id === 'css' ? 'Set these on the host or on any ancestor. Custom properties: `--rn-duration`, `--rn-easing`, `--rn-lh`, `--rn-fill`, `--rn-bleed`, `--rn-decoration` ([reference](#/api)).' : SYNTAX_NOTES[syntax.id])),
          h('p', { class: 'field-hint', hidden: cssOf(state).length === 0 }, rich('The host has `class="counter"` for the rules in the CSS tab.')),
        );
        notes.set(syntax.id, note);
        return h('div', null, block.element, note);
      },
    })),
    {
      label: 'Code syntax',
      selected: savedSyntax,
      onChange: (id) => {
        try {
          if (id !== 'css') localStorage.setItem(SYNTAX_KEY, id);
        } catch {
          // Storage blocked: the choice lasts for this page only.
        }
      },
    },
  );

  const codeCard = h(
    'section',
    { class: 'card panel', 'aria-labelledby': 'pg-code-title', style: { order: '3' } },
    h('div', { class: 'panel-head' }, h('h2', { id: 'pg-code-title', text: 'Code' }), h('span', { class: 'field-hint', text: 'Only the options you changed.' })),
    h('div', { class: 'panel-body' }, codeTabs.element),
  );

  const eventsCard = h(
    'section',
    { class: 'card panel', 'aria-labelledby': 'pg-events-title', style: { order: '4' } },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { id: 'pg-events-title' }, 'Events', eventCount),
      h('button', { type: 'button', class: 'btn btn-sm', text: 'Clear', onclick: () => { log.replaceChildren(); events = 0; eventCount.textContent = '0'; eventCount.removeAttribute('data-active'); } }),
    ),
    h('div', { class: 'panel-body' }, log),
  );

  // --- Change propagation & URL --------------------------------------------------------------

  const writeUrl = () => {
    const params = new URLSearchParams();
    for (const key of Object.keys(DEFAULTS)) {
      if (state[key] !== DEFAULTS[key]) params.set(key, state[key] === null ? '' : String(state[key]));
    }
    const search = params.toString();
    history.replaceState(null, '', `#/playground${search ? `?${search}` : ''}`);
  };
  const syncUrl = debounce(writeUrl, 300);
  disposers.push(syncUrl.cancel);
  const scheduleCode = debounce(refreshCode, 60);
  disposers.push(scheduleCode.cancel);

  function changed() {
    const keys = changedKeys(state);
    changedCount.textContent = String(keys.length);
    changedCount.toggleAttribute('data-active', keys.length > 0);
    changedCount.setAttribute('aria-label', `${keys.length} changed`);
    for (const [key, element] of fields) element.toggleAttribute('data-changed', keys.includes(key));
    scheduleCode();
    syncUrl();
  }

  function resetAll() {
    Object.assign(state, DEFAULTS);
    for (const sync of syncers.values()) sync();
    valueInput.value = String(state.value);
    syncFormat();
    applyOptions();
    preview.setValue(state.value);
    changed();
    announce('Options reset');
  }

  const shareButton = h('button', { type: 'button', class: 'btn' }, icon('link'), h('span', { text: 'Copy link' }));
  shareButton.addEventListener('click', async () => {
    syncUrl.cancel();
    writeUrl();
    const ok = await copyText(location.href);
    const label = /** @type {HTMLElement} */ (shareButton.lastElementChild);
    label.textContent = ok ? 'Link copied' : 'Copy failed';
    announce(ok ? 'Link to this setup copied' : 'Copy failed');
    setTimeout(() => (label.textContent = 'Copy link'), 1600);
  });

  view.append(
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'config-title' },
        pageHeader({ eyebrow: 'Playground', title: 'Try every option', lead: 'Change an option and the counter updates at once. The code follows your choices, in the syntax of your framework, and the link keeps this setup.' }),
        h('div', { class: 'page-actions' }, shareButton),
      ),
      h('div', { class: 'config-layout' }, h('div', { class: 'config-main' }, previewCard, codeCard, eventsCard), h('div', { class: 'config-side' }, optionsCard)),
    ),
  );

  changed();
  refreshCode();

  return () => disposers.forEach((dispose) => dispose());
}
