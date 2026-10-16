// frameworks.js — Install and usage per framework (HTML, JavaScript, React, Vue, Angular, Svelte, CDN), with a
// live result where the framework runs in the browser, then SSR, TypeScript and CSP. The tab is kept in the URL.

import { CDN, CSP_SNIPPET, FRAMEWORK_GUIDES, INSTALL, LAYER_SNIPPET, SSR_SNIPPET, TYPES_SNIPPET } from '../snippets.js';
import { codeBlock, h, installBox, pageHeader, rich, section, tabSet } from '../ui.js';

const SYNTAX_KEY = 'rn-demo-syntax';

/** A "Result" card: a live counter with − / + buttons. `mountCounter` returns the setter and a cleanup. */
function liveResult(label, step, mountCounter, disposers) {
  const slot = h('span', { class: 'big-number' });
  const result = h(
    'div',
    { class: 'card live-result' },
    h('div', null, h('span', { class: 'kpi-title', text: label }), slot),
    h('div', { class: 'row' }),
  );
  mountCounter(slot).then(({ add, dispose }) => {
    disposers.push(dispose);
    result.lastElementChild.append(
      h('button', { type: 'button', class: 'btn btn-sm', text: `− ${step}`, onclick: () => add(-step) }),
      h('button', { type: 'button', class: 'btn btn-sm', text: `+ ${step}`, onclick: () => add(step) }),
    );
  });
  return result;
}

/** Live counters per guide. React and Vue load only when their tab opens. */
const LIVE = {
  html: (slot) => {
    const element = /** @type {any} */ (h('rolling-number', { value: '1234.5', locale: 'de-DE', format: '{"style":"currency","currency":"EUR"}' }));
    slot.append(element);
    return Promise.resolve({ add: (step) => (element.value += step), dispose: () => {} });
  },
  react: async (slot) => {
    const [{ createElement, useState }, { createRoot }, { RollingNumber }] = await Promise.all([import('react'), import('react-dom/client'), import('rolling-number/react')]);
    let add = () => {};
    function Counter() {
      const [count, setCount] = useState(42);
      add = (step) => setCount((value) => value + step);
      return createElement(RollingNumber, { value: count, pad: 3 });
    }
    const root = createRoot(slot);
    root.render(createElement(Counter));
    return { add: (step) => add(step), dispose: () => root.unmount() };
  },
  vue: async (slot) => {
    const [{ createApp, h: vh, ref }, { RollingNumber }] = await Promise.all([import('vue'), import('rolling-number/vue')]);
    const count = ref(1999);
    const app = createApp({ setup: () => () => vh(RollingNumber, { value: count.value, locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }) });
    app.mount(slot);
    return { add: (step) => (count.value += step), dispose: () => app.unmount() };
  },
};

const LIVE_LABELS = { html: ['<rolling-number> · de-DE', 250], react: ['React · <RollingNumber pad={3}>', 7], vue: ['Vue · <RollingNumber> · it-IT', 250] };

function guidePanel(guide, disposers) {
  return h(
    'div',
    { class: 'fw-layout' },
    h(
      'div',
      { class: 'fw-intro' },
      h('p', { class: 'lead' }, rich(guide.intro)),
      guide.install ? installBox(INSTALL) : installBox({ unpkg: CDN, jsDelivr: CDN.replace('unpkg.com/rolling-number', 'cdn.jsdelivr.net/npm/rolling-number') }),
    ),
    guide.files.map((file) => codeBlock(file.code, { label: `${guide.name} ${file.name}`, caption: file.name }).element),
    guide.live ? liveResult(...LIVE_LABELS[guide.live], LIVE[guide.live], disposers) : null,
    h('ul', { class: 'notes' }, guide.notes.map((note) => h('li', null, rich(note)))),
  );
}

export function mount(view, { query }) {
  /** @type {(() => void)[]} */
  const disposers = [];
  let selected = query.get('fw');
  if (!selected) {
    try {
      selected = localStorage.getItem(SYNTAX_KEY);
    } catch {
      selected = null;
    }
  }

  const tabs = tabSet(
    FRAMEWORK_GUIDES.map((guide) => ({ id: guide.id, label: guide.name, panel: () => guidePanel(guide, disposers) })),
    {
      label: 'Framework',
      className: 'fw-tabs',
      selected: selected ?? 'html',
      onChange: (id) => {
        // Shareable (#/frameworks?fw=vue) and remembered, like the playground's code tabs.
        history.replaceState(null, '', `#/frameworks?fw=${id}`);
        try {
          if (id !== 'cdn') localStorage.setItem(SYNTAX_KEY, id);
        } catch {
          // Storage blocked.
        }
      },
    },
  );

  view.append(
    h(
      'div',
      { class: 'container' },
      pageHeader({
        eyebrow: 'Frameworks',
        title: 'Use it in your framework',
        lead: 'One core with thin bindings: the same options and the same `rn-start` / `rn-end` events everywhere. The stylesheet is injected automatically the first time a counter is created.',
      }),
      h('section', { 'aria-label': 'Framework guides' }, tabs.element),
      section(
        { id: 'fw-ssr', title: 'Server-side rendering', intro: 'Every entry imports in Node without a DOM. Nothing animates on the server; to show the number before JavaScript runs, render a fallback that the counter hides when it starts. Pass an explicit `locale` so the server and the browser agree.' },
        h(
          'ul',
          { class: 'notes', style: { 'margin-bottom': '16px' } },
          [
            'React / Next.js: `<RollingNumber value={n} staticFallback />`.',
            'Vue / Nuxt: `<RollingNumber :value="n" static-fallback />`; the directive renders `role` and `aria-label`.',
            'Angular: put `<span class="rn-ssr" data-rn-ssr>{{ n }}</span>` inside the host.',
            'Any template engine: the helpers below.',
          ].map((note) => h('li', null, rich(note))),
        ),
        codeBlock(SSR_SNIPPET, { label: 'SSR helpers', caption: 'server.js' }).element,
      ),
      section(
        { id: 'fw-types', title: 'TypeScript and editors', intro: 'Every entry ships typed declarations (ESM and CJS) with JSDoc on each option, a Custom Elements Manifest and VS Code data for plain HTML and CSS.' },
        codeBlock(TYPES_SNIPPET, { label: 'TypeScript setup', caption: 'types' }).element,
      ),
      section(
        { id: 'fw-csp', title: 'Styles, CSP and cascade layers', intro: 'The stylesheet goes through `adoptedStyleSheets` inside `@layer rolling-number`, so your own CSS always wins and a strict CSP needs no exception. Where constructable stylesheets are missing, a `<style>` element takes the nonce you configure.' },
        h('div', { class: 'fw-layout' }, codeBlock(CSP_SNIPPET, { label: 'CSP setup', caption: 'main.js' }).element, codeBlock(LAYER_SNIPPET, { label: 'Layer order', caption: 'app.css' }).element),
      ),
    ),
  );

  return () => disposers.forEach((dispose) => dispose());
}
