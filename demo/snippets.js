// snippets.js — Install commands, code generation for the playground and the framework guides. No DOM here.

export const INSTALL = {
  pnpm: 'pnpm add rolling-number',
  npm: 'npm install rolling-number',
  yarn: 'yarn add rolling-number',
  bun: 'bun add rolling-number',
};

export const CDN = '<script src="https://unpkg.com/rolling-number"></script>';

// --- Code generation ------------------------------------------------------------

const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A JavaScript literal for an option value. */
export function literal(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${key}: ${literal(item)}`).join(', ')} }`;
  return String(value);
}

const kebab = (name) => name.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase());
const attr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Angular inputs without the `rn` prefix (the 1.x options). */
const ANGULAR_PLAIN = new Set(['pad', 'max', 'interpolate', 'duration']);

/**
 * Code for the given options (only the non-default ones, `value` first) in each syntax.
 * `className` is added to the host when the playground also exports CSS.
 */
export const GENERATORS = {
  html(options, className) {
    const attrs = Object.entries(options).map(([name, value]) => {
      if (name === 'format') return `format='${JSON.stringify(value)}'`;
      if (name === 'interpolate' && value === false) return 'no-interpolate';
      return `${kebab(name)}="${attr(value)}"`;
    });
    if (className) attrs.push(`class="${className}"`);
    return `<script type="module">import 'rolling-number';</script>

<rolling-number
  ${attrs.join('\n  ')}
></rolling-number>

<script type="module">
  const counter = document.querySelector('rolling-number');
  counter.value = 5678;                       // animates; or: await counter.setValue(5678)
  counter.addEventListener('rn-end', (e) => console.log(e.detail.value));
</script>`;
  },

  js(options, className) {
    const body = Object.entries(options).map(([name, value]) => `${name}: ${literal(value)}`);
    return `import { RollingNumberCore } from 'rolling-number/action';

// Any element works: span, td, button, input, textarea, SVG text…
const el = document.querySelector('#counter');${className ? ` // <span id="counter" class="${className}">` : ''}
const counter = new RollingNumberCore(el, {
  ${body.join(',\n  ')}
});

await counter.setValue(5678);                 // resolves when the animation ends
el.addEventListener('rn-end', (e) => console.log(e.detail.value));`;
  },

  react(options, className) {
    const props = Object.entries(options).map(([name, value]) => {
      if (name === 'value') return 'value={count}';
      if (typeof value === 'string') return `${name}=${JSON.stringify(value)}`;
      if (typeof value === 'object' && value !== null) return `${name}={${literal(value)}}`;
      return `${name}={${value}}`;
    });
    if (className) props.push(`className="${className}"`);
    return `import { useState } from 'react';
import { RollingNumber } from 'rolling-number/react';

export function Counter() {
  const [count, setCount] = useState(${literal(options.value)});
  return (
    <RollingNumber
      ${props.join('\n      ')}
      onRnEnd={(e) => console.log(e.detail.value)}
    />
  );
}`;
  },

  vue(options, className) {
    const props = Object.entries(options).map(([name, value]) => {
      if (name === 'value') return ':value="count"';
      if (typeof value === 'string') return `${kebab(name)}="${attr(value)}"`;
      return `:${kebab(name)}="${attr(literal(value))}"`;
    });
    if (className) props.push(`class="${className}"`);
    return `<script setup lang="ts">
import { ref } from 'vue';
import { RollingNumber } from 'rolling-number/vue';

const count = ref(${literal(options.value)});
</script>

<template>
  <RollingNumber
    ${props.join('\n    ')}
    @rn-end="(e) => console.log(e.detail.value)"
  />
</template>`;
  },

  angular(options, className) {
    const inputs = Object.entries(options).map(([name, value]) => {
      if (name === 'value') return '[rollingNumber]="count"';
      const input = ANGULAR_PLAIN.has(name) ? name : 'rn' + name[0].toUpperCase() + name.slice(1);
      return typeof value === 'string' ? `${input}="${attr(value)}"` : `[${input}]="${attr(literal(value))}"`;
    });
    if (className) inputs.push(`class="${className}"`);
    return `import { Component } from '@angular/core';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [RollingNumberDirective],
  template: \`
    <span
      ${inputs.join('\n      ')}
      (rnEnd)="onEnd($event.detail.value)"
    ></span>
  \`,
})
export class CounterComponent {
  count = ${literal(options.value)};
  onEnd(value: number) { console.log(value); }
}`;
  },

  svelte(options, className) {
    const { value, ...rest } = options;
    const body = ['value: count', ...Object.entries(rest).map(([name, item]) => `${name}: ${literal(item)}`)];
    return `<script>
  import { rollingNumber } from 'rolling-number/action';
  let count = ${literal(value)};
</script>

<span${className ? ` class="${className}"` : ''} use:rollingNumber={{ ${body.join(', ')} }}></span>
<button on:click={() => (count += 100)}>+100</button>`;
  },
};

export const SYNTAXES = [
  { id: 'html', label: 'HTML' },
  { id: 'js', label: 'JavaScript' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'angular', label: 'Angular' },
  { id: 'svelte', label: 'Svelte' },
];

export const SYNTAX_NOTES = {
  html: 'Attributes are kebab-case and `format` is JSON. Every attribute is also a typed property: `el.format = { style: \'percent\' }`.',
  js: 'The core attaches to any element. `rolling-number/action` has no side effects; `rolling-number` also registers the element.',
  react: 'Works in Next.js (the entry is marked `\'use client\'`). Add `staticFallback` to render the number on the server too.',
  vue: 'Also a directive on any element: `<td v-rolling-number="{ value: count }">`. Template refs expose `setValue()`.',
  angular: 'Standalone directive, Angular 16+. `#c="rollingNumber"` gives the template `c.setValue()`; `rnTarget` animates an inner `<input>`.',
  svelte: 'The same action works with Solid, Lit and Alpine. `update()` receives the full option set.',
};

// --- Framework guides ------------------------------------------------------------

/** @type {{ id: string, name: string, intro: string, install?: boolean, files: { name: string, code: string }[], notes: string[], live?: string }[]} */
export const FRAMEWORK_GUIDES = [
  {
    id: 'html',
    name: 'HTML',
    intro: 'A standard custom element: import the package once and use `<rolling-number>` anywhere. Every option is an attribute and a typed property.',
    install: true,
    live: 'html',
    files: [
      {
        name: 'index.html',
        code: `<script type="module">import 'rolling-number';</script>

<rolling-number value="1234.5" locale="de-DE"
  format='{"style":"currency","currency":"EUR"}'></rolling-number>
<rolling-number value="150" max="99" overflow-suffix="+"></rolling-number>
<rolling-number value="7" no-interpolate></rolling-number>

<script type="module">
  const el = document.querySelector('rolling-number');
  el.value = 4321;                                  // animates
  await el.setValue(5000, { duration: 1200 });      // resolves at the end
  el.addEventListener('rn-end', (e) => console.log(e.detail.value));
</script>`,
      },
    ],
    notes: [
      'Setting a property to `null` restores the default (`el.max = null`).',
      'Methods: `setValue()`, `whenSettled()`, `finish()`, `getDisplayValue()`. Events: `rn-start`, `rn-end`.',
      '`defineRollingNumber(\'my-counter\')` registers the same element under another tag name.',
    ],
  },
  {
    id: 'js',
    name: 'JavaScript',
    intro: 'Attach a counter to an element you already have — a `<span>`, a table cell, a button badge, an `<input>` or SVG `<text>` — with the core class or the `rollingNumber()` action.',
    install: true,
    files: [
      {
        name: 'counter.js',
        code: `import { RollingNumberCore, rollingNumber } from 'rolling-number/action';

// Class: full control
const core = new RollingNumberCore(document.querySelector('#revenue'), {
  value: 0,
  locale: 'en-US',
  format: { style: 'currency', currency: 'USD' },
});
const { completed } = await core.setValue(48200);   // true when it got there
core.setValue(10, false);                            // roll each digit instead of counting
core.setValue(10, { motion: 'none' });               // instant

// Action: one call, then update() with the full option set
const badge = rollingNumber(document.querySelector('.badge'), { value: 3, max: 99, overflowSuffix: '+' });
badge.update({ value: 120, max: 99, overflowSuffix: '+' });   // shows 99+
badge.destroy();`,
      },
    ],
    notes: [
      'One counter per element: creating a second one on the same element replaces the first.',
      '`destroy()` removes only the nodes the counter created and restores the element.',
      'In `<input>`, `<textarea>`, `<option>` and SVG text the value is rewritten frame by frame (text mode).',
    ],
  },
  {
    id: 'react',
    name: 'React',
    intro: '`<RollingNumber>` renders a `<span>` with the counter inside; `useRollingNumber()` attaches one to an element you render. React 16.8+, React 19 and Next.js.',
    install: true,
    live: 'react',
    files: [
      {
        name: 'Revenue.tsx',
        code: `'use client'; // only in Next.js App Router files that use state
import { useRef, useState } from 'react';
import { RollingNumber, useRollingNumber } from 'rolling-number/react';

export function Revenue() {
  const [amount, setAmount] = useState(45200);
  return (
    <RollingNumber
      value={amount}
      locale="en-US"
      format={{ style: 'currency', currency: 'USD' }}
      staticFallback                      // the number is in the server HTML too
      onRnEnd={(e) => console.log('settled at', e.detail.value)}
      className="text-3xl font-bold"
    />
  );
}

// On an element you render yourself:
function Badge({ count }: { count: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useRollingNumber(ref, { value: count, max: 99, overflowSuffix: '+' });
  return <span ref={ref} className="badge" />;
}`,
      },
    ],
    notes: [
      'Any `<span>` prop works (`className` is merged, `ref` gets the span), plus `coreRef` for the `RollingNumberCore`.',
      'Removing a prop restores its default; a new but equal `format` object does not restart anything.',
      'Works with shadcn/ui, MUI, Ant Design or any component library: put it where you would put the number.',
    ],
  },
  {
    id: 'vue',
    name: 'Vue',
    intro: 'A component and a `v-rolling-number` directive for Vue 3 and Nuxt. The component exposes its methods through template refs.',
    install: true,
    live: 'vue',
    files: [
      {
        name: 'Score.vue',
        code: `<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { RollingNumber, vRollingNumber, type RollingNumberInstance } from 'rolling-number/vue';

const score = ref(1200);
const counter = shallowRef<RollingNumberInstance | null>(null);
</script>

<template>
  <!-- component -->
  <RollingNumber ref="counter" :value="score" :pad="4" @rn-end="(e) => console.log(e.detail.value)" />
  <button @click="counter?.setValue(0)">Reset</button>

  <!-- directive on any element -->
  <td v-rolling-number="{ value: score, locale: 'it-IT', format: { style: 'currency', currency: 'EUR' } }"></td>
  <el-tag><span v-rolling-number="score"></span></el-tag>
</template>`,
      },
    ],
    notes: [
      'The component exposes `setValue`, `whenSettled`, `finish`, `getDisplayValue` and `core` (Vue 3.2+).',
      'The directive takes a number, a string or an options object; `target: \'.selector\'` renders into an element inside the host.',
      'With SSR the directive renders `role` and `aria-label` on the server; `static-fallback` on the component renders the number too.',
    ],
  },
  {
    id: 'angular',
    name: 'Angular',
    intro: 'A standalone `[rollingNumber]` directive for Angular 16+. It runs outside `NgZone`, so no change detection on every frame.',
    install: true,
    files: [
      {
        name: 'stats.component.ts',
        code: `import { Component } from '@angular/core';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [RollingNumberDirective],
  template: \`
    <span [rollingNumber]="visitors" [pad]="4"></span>

    <span [rollingNumber]="price" rnLocale="it-IT"
          [rnFormat]="{ style: 'currency', currency: 'EUR' }"
          (rnEnd)="done($event.detail.value)" #c="rollingNumber"></span>
    <button (click)="c.setValue(0)">Reset</button>

    <!-- PrimeNG p-inputNumber, Material inputs: animate the inner <input> -->
    <p-inputNumber [rollingNumber]="qty" rnTarget="input" />
  \`,
})
export class StatsComponent {
  visitors = 1200;
  price = 49.9;
  qty = 3;
  done(value: number) { console.log(value); }
}`,
      },
    ],
    notes: [
      'Inputs: `rollingNumber` (the value), `pad`, `max`, `interpolate`, `duration`, and `rn` + the option name for the others (`rnFormat`, `rnLocale`, `rnPrefixText`, …).',
      '`strictTemplates` checks every binding; static strings such as `pad="3"` are converted.',
      'SSR: put the server text in the template, it is hidden when the counter starts: `<span class="rn-ssr" data-rn-ssr>{{ n }}</span>`.',
    ],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    intro: 'The `rollingNumber` action works as a Svelte action and as a plain function for Solid, Alpine, Lit or Stimulus.',
    install: true,
    files: [
      {
        name: 'Counter.svelte',
        code: `<script>
  import { rollingNumber } from 'rolling-number/action';
  let count = 0;
</script>

<span use:rollingNumber={{ value: count, pad: 3 }}></span>
<button on:click={() => count++}>+1</button>`,
      },
      {
        name: 'Solid, Alpine',
        code: `// Solid
<span ref={(el) => rollingNumber(el, { value: count() })} />

// Alpine
<span x-data="{ n: 5 }"
      x-init="const c = rollingNumber($el, n); $watch('n', (v) => c.update(v))"></span>`,
      },
    ],
    notes: [
      '`rollingNumber(node, param)` returns `{ update, destroy, core }`.',
      '`update()` takes the full option set: omitted options go back to their defaults, as Svelte actions do.',
    ],
  },
  {
    id: 'cdn',
    name: 'CDN',
    intro: 'No build step: one script tag registers `<rolling-number>`, injects the styles and exposes a global `RollingNumber`.',
    files: [
      {
        name: 'index.html',
        code: `<script src="https://unpkg.com/rolling-number"></script>

<rolling-number value="42"></rolling-number>
<span id="n"></span>

<script>
  RollingNumber.rollingNumber(document.querySelector('#n'), { value: 7 });
</script>`,
      },
    ],
    notes: [
      'Also on jsDelivr: `https://cdn.jsdelivr.net/npm/rolling-number`.',
      'Strict CSP: the script passes its own `nonce` to the injected styles; `data-rn-inject="false"` turns injection off.',
    ],
  },
];

export const SSR_SNIPPET = `import { renderStaticHTML, renderStaticText } from 'rolling-number/ssr';

renderStaticText({ value: 0.25, format: { style: 'percent' } });
// → '25%'

renderStaticHTML({ value: 1234, locale: 'en-US' });
// → '<span class="rn-ssr" data-rn-ssr>1,234</span>'  (put it inside your host)

renderStaticHTML({ value: 1234 }, { tag: 'rolling-number' });
// → a full <rolling-number> element with its fallback`;

export const TYPES_SNIPPET = `// global.d.ts — <rolling-number> in JSX and Vue templates (the wrappers are typed already)
import type {} from 'rolling-number/jsx';
import type {} from 'rolling-number/vue-element';

// Events are typed on every element
el.addEventListener('rn-end', (e) => e.detail.value);

// .vscode/settings.json — completion for the tag, its attributes and the --rn-* properties
{
  "html.customData": ["./node_modules/rolling-number/dist/vscode.html-custom-data.json"],
  "css.customData": ["./node_modules/rolling-number/dist/vscode.css-custom-data.json"]
}`;

export const CSP_SNIPPET = `import { configureRollingNumber } from 'rolling-number';

// Call once, before the first counter:
configureRollingNumber({ nonce: window.__CSP_NONCE__ });   // for the <style> fallback
// or load the CSS yourself:
configureRollingNumber({ injectStyles: false });
import 'rolling-number/style.css';`;

export const LAYER_SNIPPET = `/* Tailwind v4 or your own cascade layers: declare the library layer first, so yours win */
@layer rolling-number;
@import "tailwindcss";`;
