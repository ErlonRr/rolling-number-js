// ui.js — Small DOM helpers shared by the pages: element builder, icons, inline code text, copy buttons,
// code blocks, tabs and segmented controls. No innerHTML anywhere, like the library itself.

let uid = 0;

/** A unique id for label/aria wiring. */
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`;

/**
 * Creates an element. `attrs` keys: `class`, `text`, `on<Event>` listeners, `props` (assigned as
 * properties), `style` (object of properties), and any other key as an attribute
 * (`true` → empty attribute, `false`/`null`/`undefined` → omitted).
 *
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children Nodes, strings, arrays of them; `null`/`false` are skipped.
 * @returns {any}
 */
export function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'props') Object.assign(element, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) element.style.setProperty(name, String(item));
    } else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child);
  }
}

/**
 * Text with inline code and links, without innerHTML: `like this` becomes <code>,
 * [label](href) becomes a link. Returns an array of nodes and strings.
 *
 * @param {string} text
 */
export function rich(text) {
  return text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/).filter(Boolean).map((part) => {
    if (part.startsWith('`')) return h('code', { text: part.slice(1, -1) });
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const external = /^https?:/.test(link[2]);
      return h('a', { href: link[2], target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, rich(link[1]));
    }
    return part;
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Stroke icons on a 24px grid. */
const ICONS = {
  copy: ['M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M5 15V5a2 2 0 0 1 2-2h10'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  shuffle: ['M3 6h3.5c4.5 0 6.5 12 11 12H21', 'M3 18h3.5c1.8 0 3.1-1.9 4.3-4.3', 'M13.2 10.3C14.4 7.9 15.7 6 17.5 6H21', 'm18 3 3 3-3 3', 'm18 15 3 3-3 3'],
  play: ['M7 5v14l11-7L7 5Z'],
  pause: ['M8 5v14', 'M16 5v14'],
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z', 'M10 21h4'],
  cart: ['M3 4h2l2.4 11h10.2L20 8H6.2', 'M9.5 20a1 1 0 1 0 0-.01', 'M17 20a1 1 0 1 0 0-.01'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
};

/**
 * An inline SVG icon (decorative: aria-hidden).
 *
 * @param {keyof typeof ICONS} name
 */
export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(key, String(value));
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Announces a short message to screen readers through the page's live region. */
export function announce(message) {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  // A fresh text node, so the same message twice is announced twice.
  requestAnimationFrame(() => (region.textContent = message));
}

/** Copies text, with a textarea fallback when the async clipboard is unavailable (http, old browsers). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * A copy button. `getText` is read on click, so it always copies the current value.
 *
 * @param {() => string} getText
 * @param {string} [label] Accessible name.
 */
export function copyButton(getText, label = 'Copy code') {
  const text = h('span', { class: 'copy-label', text: 'Copy' });
  const button = h('button', { type: 'button', class: 'btn btn-ghost btn-sm copy-btn', 'aria-label': label }, icon('copy'), text);
  let timer = 0;
  button.addEventListener('click', async () => {
    const ok = await copyText(getText());
    text.textContent = ok ? 'Copied' : 'Copy failed';
    button.dataset.state = ok ? 'ok' : 'error';
    announce(ok ? 'Copied to clipboard' : 'Copy failed: select the text and copy it manually');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      text.textContent = 'Copy';
      delete button.dataset.state;
    }, 1600);
  });
  return button;
}

/**
 * A code block with a caption and a copy button. Returns the block and a setter for the code.
 *
 * @param {string} code
 * @param {{ label?: string, caption?: string }} [options]
 */
export function codeBlock(code, { label = 'Code', caption } = {}) {
  const codeElement = h('code', { text: code });
  const pre = h('pre', { tabindex: '0', 'aria-label': label }, codeElement);
  const captionElement = h('span', { class: 'code-caption', text: caption ?? label });
  const block = h(
    'div',
    { class: 'code-block' },
    h('div', { class: 'code-head' }, captionElement, copyButton(() => codeElement.textContent ?? '', `Copy ${label}`)),
    pre,
  );
  return {
    element: block,
    set(text, nextCaption) {
      if (codeElement.textContent !== text) codeElement.textContent = text;
      if (nextCaption !== undefined) captionElement.textContent = nextCaption;
    },
  };
}

/** An install command with copy, one tab per package manager (or CDN). */
export function installBox(commands) {
  return tabSet(
    Object.entries(commands).map(([manager, command]) => ({
      id: manager,
      label: manager,
      panel: () =>
        h(
          'div',
          { class: `install-line${command.startsWith('<') ? ' html' : ''}` },
          h('code', { text: command }),
          copyButton(() => command, `Copy the ${manager} command`),
        ),
    })),
    { label: 'Package manager', className: 'install' },
  ).element;
}

/**
 * ARIA tabs with roving focus (arrow keys, Home, End). Panels are created lazily.
 *
 * @param {{ id: string, label: string, panel: () => Node }[]} items
 * @param {{ label: string, className?: string, selected?: string, onChange?: (id: string) => void }} options
 */
export function tabSet(items, { label, className = '', selected, onChange }) {
  const base = nextId('tabs');
  const list = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': label });
  const panels = h('div', { class: 'tab-panels' });
  /** @type {Map<string, { tab: HTMLButtonElement, panel: HTMLElement, built: boolean }>} */
  const parts = new Map();
  let current = '';

  const select = (id, focus = false) => {
    current = id;
    for (const [key, part] of parts) {
      const active = key === id;
      part.tab.setAttribute('aria-selected', String(active));
      part.tab.tabIndex = active ? 0 : -1;
      part.panel.hidden = !active;
      if (active && !part.built) {
        part.panel.append(items.find((item) => item.id === key).panel());
        part.built = true;
      }
      if (active && focus) part.tab.focus();
    }
    onChange?.(id);
  };

  for (const item of items) {
    const tab = h('button', { type: 'button', role: 'tab', id: `${base}-${item.id}-tab`, 'aria-controls': `${base}-${item.id}`, class: 'tab', text: item.label });
    const panel = h('div', { role: 'tabpanel', id: `${base}-${item.id}`, 'aria-labelledby': tab.id, class: 'tab-panel', hidden: true });
    tab.addEventListener('click', () => select(item.id));
    parts.set(item.id, { tab, panel, built: false });
    list.append(tab);
    panels.append(panel);
  }

  list.addEventListener('keydown', (event) => {
    const ids = items.map((item) => item.id);
    const index = ids.findIndex((id) => parts.get(id).tab === document.activeElement);
    if (index === -1) return;
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: ids.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(ids[(moves[event.key] + ids.length) % ids.length], true);
  });

  select(selected && parts.has(selected) ? selected : items[0].id);
  return { element: h('div', { class: `tabs ${className}` }, list, panels), select, current: () => current };
}

/**
 * A segmented control built on native radio buttons (keyboard support for free).
 *
 * @param {{ legend: string, options: { value: string, label: string }[], value: string, onChange: (value: string) => void, hideLegend?: boolean }} config
 */
export function segmented({ legend, options, value, onChange, hideLegend = false }) {
  const name = nextId('seg');
  const fieldset = h('fieldset', { class: 'segmented' }, h('legend', { class: hideLegend ? 'visually-hidden' : 'field-label' }, rich(legend)));
  const group = h('div', { class: 'segmented-group' });
  for (const option of options) {
    const input = h('input', { type: 'radio', name, value: option.value, checked: option.value === value });
    input.addEventListener('change', () => input.checked && onChange(option.value));
    group.append(h('label', { class: 'segment' }, input, h('span', { text: option.label })));
  }
  fieldset.append(group);
  return {
    element: fieldset,
    set(next) {
      for (const input of group.querySelectorAll('input')) input.checked = input.value === next;
    },
  };
}

/** A labelled switch (checkbox with role="switch"). */
export function toggle(label, { checked = false, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return { element: h('label', { class: 'switch' }, input, h('span', null, rich(label))), input };
}

/** Runs `fn` once, `wait` ms after the last call. */
export function debounce(fn, wait = 200) {
  let timer = 0;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/** Whether the user asks for reduced motion. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Calls `tick` every `ms` while the page is visible and the user has not asked for reduced motion.
 * Returns controls; `stop()` is the cleanup.
 */
export function ticker(tick, ms) {
  let timer = 0;
  let wanted = !prefersReducedMotion();
  const sync = () => {
    clearInterval(timer);
    timer = 0;
    if (wanted && !document.hidden) timer = window.setInterval(tick, ms);
  };
  document.addEventListener('visibilitychange', sync);
  sync();
  return {
    running: () => wanted,
    set(next) {
      wanted = next;
      sync();
    },
    stop() {
      wanted = false;
      sync();
      document.removeEventListener('visibilitychange', sync);
    },
  };
}

/** A page header block: eyebrow, h1 (focus target on navigation), lead and actions. */
export function pageHeader({ eyebrow, title, lead, actions }) {
  return h(
    'header',
    { class: 'page-header' },
    eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
    h('h1', { tabindex: '-1', text: title }),
    lead ? h('p', { class: 'lead' }, rich(lead)) : null,
    actions ? h('div', { class: 'page-actions' }, actions) : null,
  );
}

/** A section with a heading (focusable for "on this page" links), an optional intro and an aside. */
export function section({ id, title, intro, aside }, ...content) {
  return h(
    'section',
    { class: 'section', id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'section-head' }, h('div', null, h('h2', { id: `${id}-title`, tabindex: '-1', text: title }), intro ? h('p', null, rich(intro)) : null), aside ?? null),
    content,
  );
}

/** "On this page" chips for the sections of a long page. */
export function jumpNav(links) {
  return h('nav', { class: 'jump-nav', 'aria-label': 'On this page' }, links.map(([id, label]) => h('a', { href: `#${id}`, 'data-jump': '' }, label)));
}

/**
 * A reference table that turns into cards on phones. Rows are arrays of strings with `inline code`;
 * the first cell is the row header. Explicit roles keep the table semantics when CSS changes `display`.
 *
 * @param {string} caption Accessible name of the table.
 * @param {string[]} columns
 * @param {string[][]} rows
 */
export function refTable(caption, columns, rows) {
  return h(
    'div',
    { class: 'table-wrap', role: 'region', 'aria-label': caption, tabindex: '0' },
    h(
      'table',
      { class: 'ref-table', role: 'table', 'aria-label': caption },
      h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, columns.map((column) => h('th', { scope: 'col', role: 'columnheader', text: column })))),
      h(
        'tbody',
        { role: 'rowgroup' },
        rows.map((cells) =>
          h(
            'tr',
            { role: 'row' },
            cells.map((cell, index) =>
              index === 0
                ? h('th', { scope: 'row', role: 'rowheader' }, rich(cell))
                : h('td', { role: 'cell', 'data-label': index < cells.length - 1 ? columns[index] : null }, rich(cell)),
            ),
          ),
        ),
      ),
    ),
  );
}
