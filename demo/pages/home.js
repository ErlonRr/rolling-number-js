// home.js — Value proposition, install command, a live dashboard and the counter inside real elements.

import { rollingNumber } from 'rolling-number';
import { INSTALL } from '../snippets.js';
import { h, icon, installBox, rich, section, ticker } from '../ui.js';

const rand = (min, max) => Math.round(min + Math.random() * (max - min));

/** A KPI tile whose value is a counter; `delta` shows the last change. */
function kpi(title, options) {
  const host = h('span');
  const delta = h('span', { class: 'delta', 'aria-hidden': 'true' });
  const action = rollingNumber(host, options);
  let last = options.value;
  return {
    element: h('div', { class: 'card kpi' }, h('span', { class: 'kpi-title', text: title }), h('span', { class: 'kpi-value' }, host), delta),
    set(value, label) {
      const diff = value - last;
      last = value;
      action.core?.setValue(value);
      delta.className = `delta ${diff >= 0 ? 'up' : 'down'}`;
      delta.textContent = `${diff >= 0 ? '▲' : '▼'} ${label(Math.abs(diff))}`;
    },
    destroy: () => action.destroy(),
  };
}

function dashboard(disposers) {
  let revenue = 48210.5;
  let visitors = 12904;
  let orders = 384;
  let conversion = 0.031;

  const revenueHost = h('span', { class: 'board-value' });
  const revenueCounter = rollingNumber(revenueHost, { value: revenue, locale: 'en-US', format: { style: 'currency', currency: 'USD' }, label: 'Revenue today: {value}' });
  const tiles = [
    kpi('Visitors', { value: visitors, locale: 'en-US' }),
    kpi('Orders', { value: orders, locale: 'en-US' }),
    kpi('Conversion', { value: conversion, locale: 'en-US', format: { style: 'percent' }, decimals: 1 }),
  ];
  disposers.push(() => revenueCounter.destroy(), ...tiles.map((tile) => tile.destroy));

  const setRevenue = (next) => {
    revenue = Math.max(0, Math.round(next * 100) / 100);
    revenueCounter.core?.setValue(revenue);
  };
  const tick = () => {
    setRevenue(revenue + rand(-120, 640) + rand(0, 99) / 100);
    visitors += rand(4, 60);
    orders += rand(0, 4);
    conversion = Math.min(0.09, Math.max(0.012, conversion + rand(-3, 3) / 1000));
    tiles[0].set(visitors, (n) => n.toLocaleString('en-US'));
    tiles[1].set(orders, String);
    tiles[2].set(conversion, (n) => `${(n * 100).toFixed(1)} pt`);
  };

  const status = h('span', { class: 'status-pill' });
  const playIcon = h('span', { style: { display: 'contents' } });
  const playLabel = h('span');
  const playButton = h('button', { type: 'button', class: 'btn btn-sm' }, playIcon, playLabel);
  const live = ticker(tick, 2200);
  disposers.push(live.stop);
  const syncStatus = () => {
    const running = live.running();
    status.textContent = running ? 'Live' : 'Paused';
    status.toggleAttribute('data-live', running);
    playIcon.replaceChildren(icon(running ? 'pause' : 'play'));
    playLabel.textContent = running ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(!running));
    playButton.setAttribute('aria-label', running ? 'Pause the live updates' : 'Resume the live updates');
  };
  playButton.addEventListener('click', () => {
    live.set(!live.running());
    if (live.running()) tick();
    syncStatus();
  });
  syncStatus();

  return h(
    'div',
    { class: 'board', role: 'group', 'aria-label': 'Example dashboard' },
    h(
      'div',
      { class: 'card board-main' },
      h('div', { class: 'board-head' }, h('span', { class: 'kpi-title', text: 'Revenue today' }), status),
      revenueHost,
      h(
        'div',
        { class: 'board-actions' },
        playButton,
        h('button', { type: 'button', class: 'btn btn-sm', text: 'Big sale', onclick: () => setRevenue(revenue + rand(20000, 90000)) }),
        h('button', { type: 'button', class: 'btn btn-sm', text: 'Refund', onclick: () => setRevenue(revenue - rand(5000, 15000)) }),
      ),
    ),
    h('div', { class: 'kpi-grid' }, tiles.map((tile) => tile.element)),
  );
}

/** One card of "Works in the element you already have". */
function contextCard({ title, tag, text, stage, snippet }) {
  return h(
    'article',
    { class: 'card context-card' },
    h('div', { class: 'stage' }, stage),
    h('div', { class: 'context-body' }, h('h3', null, title, h('code', { text: tag })), h('p', { text }), h('code', { class: 'snippet', text: snippet })),
  );
}

function contexts(disposers) {
  const bellBadge = h('span', { class: 'count-badge' });
  const priceCell = h('td');
  const growthCell = h('td');
  const distance = h('input', { class: 'input', readonly: true, 'aria-label': 'Distance this month' });
  const svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  for (const [key, value] of Object.entries({ x: '100', y: '62', 'text-anchor': 'middle', fill: 'currentColor', 'font-size': '30', 'font-weight': '700' })) svgText.setAttribute(key, value);

  let notifications = 7;
  const items = [
    { host: bellBadge, options: { value: notifications, max: 99, overflowSuffix: '+', label: '{value} notifications' }, next: () => (notifications = rand(0, 140)) },
    { host: priceCell, options: { value: 1249.9, locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }, next: () => rand(20000, 250000) / 100 },
    { host: growthCell, options: { value: 0.124, locale: 'it-IT', format: { style: 'percent', signDisplay: 'always' }, decimals: 1 }, next: () => rand(-150, 450) / 1000 },
    { host: distance, options: { value: 1820, locale: 'en-US', format: { style: 'unit', unit: 'kilometer' } }, next: () => rand(0, 40000) },
    { host: svgText, options: { value: 21.5, locale: 'en-US', format: { style: 'unit', unit: 'celsius' }, decimals: 1 }, next: () => rand(-200, 400) / 10 },
  ].map((item) => ({ ...item, action: rollingNumber(item.host, item.options) }));
  disposers.push(() => items.forEach((item) => item.action.destroy()));
  const shuffle = () => items.forEach((item) => item.action.core?.setValue(item.next()));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 200 96', class: 'gauge', role: 'img', 'aria-label': 'Room temperature' })) svg.setAttribute(key, value);
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [key, value] of Object.entries({ x: '1', y: '1', width: '198', height: '94', rx: '16', fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.2' })) ring.setAttribute(key, value);
  svg.append(ring, svgText);

  const grid = h(
    'div',
    { class: 'context-grid' },
    contextCard({
      title: 'Button badge',
      tag: '<button>',
      text: 'Capped at 99+, while the accessible name keeps the real count.',
      stage: h('button', { type: 'button', class: 'bell', 'aria-label': 'Notifications', onclick: () => items[0].action.core?.setValue((notifications += rand(1, 30))) }, icon('bell', 24), bellBadge),
      snippet: "{ max: 99, overflowSuffix: '+' }",
    }),
    contextCard({
      title: 'Table cells',
      tag: '<td>',
      text: 'Currency and percent through Intl: the digits roll, the symbols stay put.',
      stage: h('table', { class: 'mini-table' }, h('tbody', null, h('tr', null, h('th', { scope: 'row', text: 'Price' }), priceCell), h('tr', null, h('th', { scope: 'row', text: 'Growth' }), growthCell))),
      snippet: "{ locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }",
    }),
    contextCard({
      title: 'Form field',
      tag: '<input>',
      text: 'Text mode: the value is rewritten frame by frame, never while the user is typing.',
      stage: distance,
      snippet: "{ format: { style: 'unit', unit: 'kilometer' } }",
    }),
    contextCard({
      title: 'SVG text',
      tag: '<text>',
      text: 'Inside charts and gauges: the text node itself counts.',
      stage: svg,
      snippet: "{ format: { style: 'unit', unit: 'celsius' }, decimals: 1 }",
    }),
  );

  return { grid, shuffle };
}

const FEATURES = [
  ['A real odometer', 'Counts through the values in between. Fast digits spin as reels, 9 → 0 rolls forward, and a new value mid-flight continues from what is on screen.'],
  ['Any element', 'Digit columns inside containers; animated text in inputs, textareas, options and SVG text. Your other children are never touched.'],
  ['Number formatting', 'Currencies, percent, units, locales and native digits through Intl, plus 99+ badges, prefixes and suffixes.'],
  ['Events and promises', '`rn-start` and `rn-end` on every element, and `setValue()` resolves when the animation ends.'],
  ['Accessible', 'An accessible name with the real value, optional live announcements, and instant changes with reduced motion.'],
  ['Typed, SSR-ready', 'Typed options in every editor, server-rendered fallbacks, and styles injected for you (CSP-friendly).'],
];

function stats(disposers) {
  const items = [
    ['0', 'runtime dependencies', { value: 0 }],
    ['6', 'ways to use it: HTML, JS, React, Vue, Angular, Svelte', { value: 6, from: 0 }],
    ['18', 'options, the same in every framework', { value: 18, from: 0 }],
    ['23', 'KB gzip for the full entry, styles included', { value: 23, from: 0 }],
  ];
  return h(
    'div',
    { class: 'stats' },
    items.map(([, text, options]) => {
      const host = h('span', { class: 'big-number' });
      const action = rollingNumber(host, { ...options, trigger: 'visible', duration: 1400 });
      disposers.push(() => action.destroy());
      return h('div', { class: 'card stat' }, host, h('span', { text }));
    }),
  );
}

export function mount(view) {
  /** @type {(() => void)[]} */
  const disposers = [];
  const { grid, shuffle } = contexts(disposers);

  view.append(
    h(
      'div',
      { class: 'container' },
      h(
        'section',
        { class: 'hero', 'aria-labelledby': 'hero-title' },
        h(
          'div',
          { class: 'hero-copy' },
          h('p', { class: 'eyebrow', text: 'Web Component · React · Vue · Angular · Svelte' }),
          h('h1', { id: 'hero-title', tabindex: '-1' }, 'Numbers that ', h('em', { text: 'roll' }), ' into place.'),
          h('p', { class: 'lead', text: 'An animated odometer counter for any element: text, buttons, table cells, inputs and SVG. Give it a value and it rolls there — with real number formatting, events and zero dependencies.' }),
          h('div', { class: 'hero-install' }, installBox(INSTALL)),
          h('div', { class: 'page-actions' }, h('a', { class: 'btn btn-primary', href: '#/playground' }, 'Open the playground'), h('a', { class: 'btn', href: '#/frameworks' }, 'Use it in your framework')),
          h('ul', { class: 'hero-points' }, h('li', null, 'Zero dependencies'), h('li', null, 'TypeScript types'), h('li', null, 'SSR-ready'), h('li', null, 'Reduced motion')),
        ),
        dashboard(disposers),
      ),
      section(
        {
          id: 'contexts',
          title: 'Works in the element you already have',
          intro: 'No wrapper to adopt: the counter attaches to your badge, cell, field or chart label.',
          aside: h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: shuffle }, icon('shuffle'), 'New values'), h('a', { class: 'btn btn-sm btn-ghost', href: '#/examples' }, 'All examples', icon('arrow'))),
        },
        grid,
      ),
      section(
        { id: 'features', title: 'Small API, careful details' },
        h('div', { class: 'features' }, FEATURES.map(([title, text]) => h('div', { class: 'card feature' }, h('h3', { text: title }), h('p', null, rich(text))))),
        h('div', { style: { 'margin-top': '16px' } }, stats(disposers)),
      ),
    ),
  );

  return () => disposers.forEach((dispose) => dispose());
}
