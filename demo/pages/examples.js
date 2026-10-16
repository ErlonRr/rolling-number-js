// examples.js — The counter in every kind of element, number formatting, CSS styles, events and promises,
// and 100 counters on one frame loop. Each card shows the options or CSS behind it.

import { rollingNumber } from 'rolling-number';
import { literal } from '../snippets.js';
import { codeBlock, h, icon, jumpNav, pageHeader, section, ticker, toggle } from '../ui.js';

const rand = (min, max) => Math.round(min + Math.random() * (max - min));
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attrs) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

/** A card: the live element on a stage, then its title, host tag and snippet. */
function exampleCard({ title, tag, stage, snippet }) {
  return h(
    'article',
    { class: 'card context-card' },
    h('div', { class: 'stage' }, stage),
    h('div', { class: 'context-body' }, h('h3', null, title, tag ? h('code', { text: tag }) : null), h('code', { class: 'snippet', text: snippet })),
  );
}

/** Starts a set of counters; returns `shuffle()` and registers their cleanup. */
function counters(items, disposers) {
  const started = items.map((item) => ({ ...item, action: rollingNumber(item.host, { ...item.options, value: item.next() }) }));
  disposers.push(() => started.forEach((item) => item.action.destroy()));
  return () => started.forEach((item) => item.action.core?.setValue(item.next()));
}

/** A "New values" button and an autoplay switch for a section. */
function controls(shuffle, disposers, label = 'New values') {
  const auto = ticker(shuffle, 1800);
  auto.set(false);
  disposers.push(auto.stop);
  return h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: shuffle }, icon('shuffle'), label), toggle('Autoplay', { onChange: (on) => auto.set(on) }).element);
}

function elements(disposers) {
  const inline = h('span');
  const cart = h('span', { class: 'count-badge' });
  const revenue = h('td');
  const growth = h('td');
  const input = h('input', { class: 'input', readonly: true, 'aria-label': 'Distance' });
  const textarea = h('textarea', { class: 'input', readonly: true, rows: '2', 'aria-label': 'Order total' });
  const option = h('option');
  const svgText = svgElement('text', { x: '100', y: '60', 'text-anchor': 'middle', fill: 'currentColor', 'font-size': '30', 'font-weight': '700' });
  const svg = svgElement('svg', { viewBox: '0 0 200 92', class: 'gauge', role: 'img', 'aria-label': 'Temperature' });
  svg.append(svgElement('rect', { x: '1', y: '1', width: '198', height: '90', rx: '16', fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.2' }), svgText);
  const visible = h('span', { class: 'big-number' });

  const shuffle = counters(
    [
      { host: inline, options: { max: 99, overflowSuffix: '+', label: '{value} new messages' }, next: () => rand(0, 140) },
      { host: cart, options: { label: '{value} items in the cart' }, next: () => rand(0, 12) },
      { host: revenue, options: { locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }, next: () => rand(1000, 250000) + rand(0, 99) / 100 },
      { host: growth, options: { locale: 'it-IT', format: { style: 'percent', signDisplay: 'always' }, decimals: 1 }, next: () => rand(-150, 450) / 1000 },
      { host: input, options: { locale: 'en-US', format: { style: 'unit', unit: 'kilometer' } }, next: () => rand(0, 40000) },
      { host: textarea, options: { prefixText: 'Total: ', suffixText: ' items' }, next: () => rand(0, 5000) },
      { host: option, options: { prefixText: 'Seats left: ' }, next: () => rand(0, 300) },
      { host: svgText, options: { locale: 'en-US', format: { style: 'unit', unit: 'celsius' }, decimals: 1 }, next: () => rand(-200, 400) / 10 },
    ],
    disposers,
  );
  const intro = rollingNumber(visible, { value: 12480, from: 0, trigger: 'visible', duration: 1600, locale: 'en-US' });
  disposers.push(() => intro.destroy());

  return section(
    {
      id: 'ex-elements',
      title: 'Any element',
      intro: 'Containers get animated digit columns next to their own children; `<input>`, `<textarea>`, `<option>` and SVG text are rewritten as text, so the value stays a normal value.',
      aside: controls(shuffle, disposers),
    },
    h(
      'div',
      { class: 'example-grid' },
      exampleCard({ title: 'Inline text', tag: '<span>', stage: h('p', null, 'You have ', inline, ' new messages'), snippet: "{ max: 99, overflowSuffix: '+' }" }),
      exampleCard({ title: 'Button badge', tag: '<button>', stage: h('button', { type: 'button', class: 'btn cart-btn' }, icon('cart'), 'Cart ', cart), snippet: 'rollingNumber(badge, 3)' }),
      exampleCard({
        title: 'Table cells',
        tag: '<td>',
        stage: h('table', { class: 'mini-table' }, h('tbody', null, h('tr', null, h('th', { scope: 'row', text: 'Revenue' }), revenue), h('tr', null, h('th', { scope: 'row', text: 'Growth' }), growth))),
        snippet: "{ locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }",
      }),
      exampleCard({ title: 'Input', tag: '<input readonly>', stage: input, snippet: "{ format: { style: 'unit', unit: 'kilometer' } }" }),
      exampleCard({ title: 'Textarea', tag: '<textarea>', stage: textarea, snippet: "{ prefixText: 'Total: ', suffixText: ' items' }" }),
      exampleCard({ title: 'Select option', tag: '<option>', stage: h('select', { class: 'select', 'aria-label': 'Seats' }, option), snippet: "{ prefixText: 'Seats left: ' }" }),
      exampleCard({ title: 'SVG text', tag: '<text>', stage: svg, snippet: "{ format: { style: 'unit', unit: 'celsius' }, decimals: 1 }" }),
      exampleCard({ title: 'When visible', tag: 'trigger', stage: visible, snippet: "{ from: 0, trigger: 'visible' }" }),
    ),
  );
}

const FORMATS = [
  ['Euro · de-DE', { locale: 'de-DE', format: { style: 'currency', currency: 'EUR' } }, () => rand(0, 999999) / 100],
  ['Dollar · accounting', { locale: 'en-US', format: { style: 'currency', currency: 'USD', currencySign: 'accounting' } }, () => rand(-50000, 50000) / 100],
  ['Yen · ja-JP', { locale: 'ja-JP', format: { style: 'currency', currency: 'JPY' } }, () => rand(0, 9999999)],
  ['Percent', { locale: 'en-US', format: { style: 'percent' }, decimals: 1 }, () => rand(0, 1000) / 1000],
  ['Speed · unit', { locale: 'en-US', format: { style: 'unit', unit: 'kilometer-per-hour' } }, () => rand(0, 320)],
  ['Indian grouping · hi-IN', { locale: 'hi-IN' }, () => rand(0, 99999999)],
  ['Native digits · ar-EG', { locale: 'ar-EG' }, () => rand(0, 99999)],
  ['Sign always', { format: { signDisplay: 'always' } }, () => rand(-500, 500)],
  ['Badge · 99+', { max: 99, overflowSuffix: '+' }, () => rand(0, 160)],
  ['Prefix and suffix', { prefixText: '≈ ', suffixText: ' pts' }, () => rand(0, 9999)],
  ['Zero padding', { pad: 6 }, () => rand(0, 99999)],
  ['Fixed decimals', { decimals: 3 }, () => rand(0, 99999) / 1000],
];

function formatting(disposers) {
  const cards = FORMATS.map(([title, options, next]) => ({ title, options, next, host: h('span', { class: 'big-number' }) }));
  const shuffle = counters(cards, disposers);
  return section(
    {
      id: 'ex-formatting',
      title: 'Number formatting',
      intro: 'Setting `locale` or `format` switches on `Intl.NumberFormat`: separators, currency symbols, units and native digits. The digits roll; the symbols stay in place.',
      aside: controls(shuffle, disposers, 'Shuffle'),
    },
    h('div', { class: 'example-grid' }, cards.map((card) => exampleCard({ title: card.title, stage: card.host, snippet: literal(card.options) }))),
  );
}

const STYLES = [
  ['Gradient fill', 'styled-gradient', '--rn-fill: linear-gradient(180deg, #c084fc, #4f46e5);\ncolor: transparent;'],
  ['Glow', 'styled-glow', 'text-shadow: 0 0 0.25em #818cf8;\n--rn-lh: 1.8;\n--rn-bleed: 0.3em;'],
  ['Still underline', 'styled-underline', '--rn-decoration: underline;'],
  ['Slow, bouncy roll', 'styled-slow', "font-family: Georgia, serif;\n--rn-duration: 1.2s;\n--rn-easing: cubic-bezier(0.34, 1.56, 0.64, 1);"],
];

function styles(disposers) {
  const cards = STYLES.map(([title, className, css]) => ({ title, css, host: h('span', { class: `big-number ${className}` }), options: className === 'styled-slow' ? { interpolate: false } : {}, next: () => rand(0, 9999) }));
  const shuffle = counters(cards, disposers);
  return section(
    {
      id: 'ex-styles',
      title: 'Styles',
      intro: 'The counter inherits font, size and color. These custom properties go on the host or any ancestor; `--rn-duration` and `--rn-easing` time the rolls when the JS options are unset.',
      aside: controls(shuffle, disposers, 'Animate'),
    },
    h('div', { class: 'example-grid' }, cards.map((card) => exampleCard({ title: card.title, stage: card.host, snippet: card.css }))),
  );
}

function events(disposers) {
  const counter = /** @type {any} */ (h('rolling-number', { class: 'big-number', value: '100', style: { 'font-size': '2.6rem' } }));
  const log = h('ol', { class: 'events-log', reversed: true, 'data-empty': 'Press a button to see the events.' });
  const add = (type, text) => {
    log.prepend(h('li', { class: 'event-item' }, h('span', { class: 'event-type', 'data-type': type, text: type }), h('span', { text })));
    while (log.children.length > 12) log.lastElementChild?.remove();
  };
  const onEvent = (event) => add(event.type, `value ${event.detail.value} · from ${event.detail.from} · ${event.detail.animated ? 'animated' : 'instant'}`);
  counter.addEventListener('rn-start', onEvent);
  counter.addEventListener('rn-end', onEvent);
  const run = (promise) => promise.then(({ value, completed }) => add('promise', `{ value: ${value}, completed: ${completed} }`));
  const actions = [
    ['setValue(v)', () => run(counter.setValue(rand(0, 9999)))],
    ['setValue(v, false)', () => run(counter.setValue(rand(0, 9999), false))],
    ["{ motion: 'none' }", () => run(counter.setValue(rand(0, 9999), { motion: 'none' }))],
    ['two values fast', () => {
      run(counter.setValue(rand(0, 9999)));
      setTimeout(() => run(counter.setValue(rand(0, 9999))), 150);
    }],
  ];
  disposers.push(() => {
    counter.removeEventListener('rn-start', onEvent);
    counter.removeEventListener('rn-end', onEvent);
  });

  return section(
    {
      id: 'ex-events',
      title: 'Events and promises',
      intro: 'Every change fires `rn-start` and `rn-end` on the host (they bubble), and `setValue()` returns a promise that resolves when the animation ends — with `completed: false` when a newer value replaced it.',
    },
    h(
      'div',
      { class: 'events-demo' },
      h('div', { class: 'card' }, h('div', { class: 'stage' }, counter), h('div', { class: 'button-grid' }, actions.map(([label, onclick]) => h('button', { type: 'button', class: 'btn', text: label, onclick })))),
      h('div', { class: 'card panel' }, h('div', { class: 'panel-head' }, h('h3', { text: 'Log' })), h('div', { class: 'panel-body' }, log)),
    ),
    h(
      'div',
      { style: { 'margin-top': '16px' } },
      codeBlock(
        `const counter = document.querySelector('rolling-number');

counter.addEventListener('rn-start', (e) => console.log('start', e.detail)); // { value, from, animated }
counter.addEventListener('rn-end', (e) => console.log('end', e.detail.value));

const { completed } = await counter.setValue(500);  // true when it reached 500
counter.setValue(10, false);                         // roll each digit
counter.setValue(10, { motion: 'none' });            // instant
counter.setValue(10, { duration: 1500, easing: 'ease-out-expo' });

// React: onRnStart / onRnEnd · Vue: @rn-start / @rn-end · Angular: (rnStart) / (rnEnd)`,
        { label: 'Events example', caption: 'events.js' },
      ).element,
    ),
  );
}

function performance(disposers) {
  const cells = Array.from({ length: 100 }, () => {
    const cell = /** @type {any} */ (h('rolling-number', { pad: '2' }));
    cell.value = rand(0, 99);
    return h('span', null, cell);
  });
  const randomize = () => cells.forEach((cell) => (/** @type {any} */ (cell.firstElementChild).value = rand(0, 99)));
  const auto = ticker(randomize, 700);
  auto.set(false);
  disposers.push(auto.stop);
  return section(
    {
      id: 'ex-performance',
      title: '100 counters, one frame loop',
      intro: 'All counters on a page share a single `requestAnimationFrame` loop that batches DOM reads and writes.',
      aside: h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: randomize }, icon('shuffle'), 'Randomize'), toggle('Loop', { onChange: (on) => auto.set(on) }).element),
    },
    h('div', { class: 'card stress-grid' }, cells),
  );
}

export function mount(view) {
  /** @type {(() => void)[]} */
  const disposers = [];
  view.append(
    h(
      'div',
      { class: 'container' },
      pageHeader({ eyebrow: 'Examples', title: 'See it in context', lead: 'The same counter in every kind of element, with real number formatting, CSS styles and events. Each card shows the options behind it.' }),
      jumpNav([
        ['ex-elements', 'Any element'],
        ['ex-formatting', 'Formatting'],
        ['ex-styles', 'Styles'],
        ['ex-events', 'Events'],
        ['ex-performance', 'Performance'],
      ]),
      elements(disposers),
      formatting(disposers),
      styles(disposers),
      events(disposers),
      performance(disposers),
    ),
  );
  return () => disposers.forEach((dispose) => dispose());
}
