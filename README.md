# 🎲 rolling-number

> An animated, odometer-style number counter. Zero dependencies, one API for the **Web Component**, **vanilla JS**, **React / Next.js**, **Vue / Nuxt**, **Angular** and **Svelte** — and it works inside any element: text, buttons, table cells, inputs, textareas and SVG.

![rolling-number banner](https://raw.githubusercontent.com/ErlonRr/rolling-number-js/main/assets/rolling-number-js.png)

<div align="center">

[![npm version](https://img.shields.io/npm/v/rolling-number?color=6366f1&style=flat-square)](https://www.npmjs.com/package/rolling-number)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#)
[![Frameworks](https://img.shields.io/badge/Frameworks-Web%20Component%20%7C%20React%20%7C%20Vue%20%7C%20Angular%20%7C%20Svelte-blue?style=flat-square)](#-use-it-in-your-framework)

</div>

![rolling-number demo animation](https://raw.githubusercontent.com/ErlonRr/rolling-number-js/main/assets/rolling-number-js.gif)

**Try every option in the demo:** clone the repo and run `pnpm install && pnpm dev`. The playground generates the code for your framework from the settings you pick.

---

## Contents

- [Install](#-install)
- [Quick start](#-quick-start)
- [How it works](#-how-it-works)
- [Options](#%EF%B8%8F-options)
- [Formatting numbers](#-formatting-numbers)
- [Events and promises](#-events-and-promises)
- [Works in any element](#-works-in-any-element)
- [Styling](#-styling)
- [Use it in your framework](#-use-it-in-your-framework)
- [Server-side rendering](#%EF%B8%8F-server-side-rendering)
- [Accessibility](#-accessibility)
- [API reference](#-api-reference)
- [TypeScript and IDE support](#-typescript-and-ide-support)
- [Browser support](#-browser-support)
- [Upgrading from 1.2](#%EF%B8%8F-upgrading-from-12)
- [Limitations](#-limitations)

---

## 📦 Install

```bash
pnpm add rolling-number      # or: npm install rolling-number / yarn add rolling-number
```

That's it: **the stylesheet is injected automatically** the first time a counter is created (in every document or shadow root that hosts one). You can still import `rolling-number/style.css` yourself, for example to have the styles in place before JavaScript runs ([details](#style-injection-csp-and-layers)).

| Entry | What you get |
| :--- | :--- |
| `rolling-number` | `RollingNumberCore`, the `rollingNumber()` action, the SSR helpers, and the `<rolling-number>` element (registered on import in the browser) |
| `rolling-number/action` | `RollingNumberCore` and `rollingNumber()` without registering the element (no side effects) |
| `rolling-number/register` | registers `<rolling-number>` only |
| `rolling-number/react` | `<RollingNumber />` and `useRollingNumber()` (React 16.8+, `'use client'`) |
| `rolling-number/vue` | `<RollingNumber />` and `v-rolling-number` (Vue 3) |
| `rolling-number/angular` | standalone `[rollingNumber]` directive (Angular 16+) |
| `rolling-number/ssr` | `renderStaticText()` / `renderStaticHTML()`, DOM-free |
| `rolling-number/iife` | one `<script>` build with a global `RollingNumber` (also on unpkg / jsDelivr) |
| `rolling-number/style.css` | the stylesheet, if you prefer to load it yourself |

---

## 🚀 Quick start

**HTML / Web Component**

```html
<script type="module">import 'rolling-number';</script>

<rolling-number value="1234" pad="4"></rolling-number>
```

```js
const counter = document.querySelector('rolling-number');
counter.value = 5678;                         // animates to 5678
await counter.setValue(10, { duration: 1200 });
```

**React**

```tsx
import { RollingNumber } from 'rolling-number/react';

<RollingNumber value={count} pad={4} />
```

**Vue**

```vue
<script setup>
import { RollingNumber } from 'rolling-number/vue';
</script>

<template>
  <RollingNumber :value="count" :pad="4" />
</template>
```

**Angular**

```ts
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  standalone: true,
  imports: [RollingNumberDirective],
  template: `<span [rollingNumber]="count" [pad]="4"></span>`
})
export class CounterComponent { count = 1234; }
```

**Svelte, Solid, Alpine, Lit or plain DOM**

```js
import { rollingNumber } from 'rolling-number/action';

const counter = rollingNumber(document.querySelector('#total'), { value: 42 });
counter.update({ value: 50 });
```

Every integration takes the [same options](#%EF%B8%8F-options) and fires the [same events](#-events-and-promises).

---

## 🧠 How it works

You give the counter a **value**; when the value changes, the counter animates from what is on screen to the new value.

- **Count** (`interpolate: true`, the default): the number counts through the values in between, like an odometer. Low digits that would move too fast spin as smooth reels, high digits roll forward one step at a time (`9 → 0` always rolls forward).
- **Roll** (`interpolate: false`): each digit rolls straight to its new digit.
- A change in the middle of an animation continues from what is on screen, without jumps.
- With **reduced motion** turned on in the operating system, every change is instant.

Inside a container (`<span>`, `<div>`, `<td>`, `<button>`, …) the counter appends one animated column per digit and leaves your other children alone. Inside `<input>`, `<textarea>`, `<option>` and SVG `<text>` it animates the **text** instead ([details](#-works-in-any-element)).

All counters on a page share one `requestAnimationFrame` loop, which reads and writes the DOM in batches.

---

## ⚙️ Options

Every option is optional and works the same way in every integration. Invalid input never throws: it falls back to the default.

| Option | Attribute | Default | What it does |
| :--- | :--- | :--- | :--- |
| `value` | `value` | `0` | The number to show. Rounded to the displayed precision. |
| `pad` | `pad` | `1` | Minimum integer digits, padded with zeros (`pad: 3` → `007`). 1–64. |
| `max` | `max` | `null` | Display limit, e.g. `99` for a badge. The real value stays in the accessible label. |
| `overflowSuffix` | `overflow-suffix` | `''` | Shown after the digits when the value is above `max`: `'+'` → `99+`. |
| `interpolate` | `interpolate` / `no-interpolate` | `true` | `true` counts through the values; `false` rolls each digit straight to its new digit. |
| `duration` | `duration` | auto | Animation length in ms. Unset: 400 ms when counting, `--rn-duration` (0.5 s) when rolling. `0` = no counting. |
| `easing` | `easing` | auto | A preset (`'odometer'`, `'ease-out-cubic'`, `'ease-out-expo'`, `'ease-in-out'`, `'linear'`, …), a CSS easing (`'cubic-bezier(…)'`, `'linear(…)'`, `'steps(…)'`) or a function. |
| `decimals` | `decimals` | auto | Fixed fraction digits (0–20). Auto: the currency's digits, else 0. |
| `locale` | `locale` | — | BCP 47 locale, e.g. `'de-DE'`. Turns on locale formatting. |
| `format` | `format` (JSON) | — | Intl formatting: currency, percent, unit, sign, grouping ([examples](#-formatting-numbers)). |
| `prefixText` | `prefix-text` | `''` | Static text before the number. |
| `suffixText` | `suffix-text` | `''` | Static text after the number. |
| `mode` | `mode` | `'auto'` | `'columns'` (digit columns) or `'text'` (rewrites the text). `'auto'` picks text for form fields and SVG text. |
| `from` | `from` | — | Value shown at creation; the counter then animates to `value` (an intro). |
| `trigger` | `trigger` | `'immediate'` | `'visible'`: animations wait until the counter is on screen. |
| `label` | `label` | the value | Accessible name: a string where `{value}` is replaced (`'{value} unread messages'`) or a function. |
| `live` | `live` | `'off'` | `'polite'` / `'assertive'`: announce each settled value to screen readers. |
| `injectStyles` | `inject-styles` | `true` | `false` turns off the automatic stylesheet for this counter. |

In React and Vue the options are props (`pad={4}`, `:pad="4"`). In Angular they are inputs: `rollingNumber` (the value), `pad`, `max`, `interpolate`, `duration`, and `rn` + the option name for the others (`rnFormat`, `rnLocale`, `rnPrefixText`, …).

Change options later with `update()` (`undefined` = unchanged, `null` = back to the default):

```js
counter.update({ max: 99, overflowSuffix: '+' });
counter.update({ duration: null }); // automatic duration again
```

---

## 💶 Formatting numbers

Setting `locale` or `format` switches on `Intl.NumberFormat`: separators, currency symbols, units, native digits. The digits still roll; separators and symbols stay in place.

```js
{ value: 1234.5, locale: 'de-DE', format: { style: 'currency', currency: 'EUR' } }   // 1.234,50 €
{ value: 0.256, locale: 'en-US', format: { style: 'percent' }, decimals: 1 }           // 25.6%
{ value: 88, locale: 'en-US', format: { style: 'unit', unit: 'kilometer-per-hour' } }  // 88 km/h
{ value: 12, format: { signDisplay: 'always' } }                                       // +12
{ value: 1234567, locale: 'hi-IN' }                                                    // 12,34,567
{ value: 2024, locale: 'ar-EG' }                                                       // ٢٬٠٢٤ (native digits)
{ value: 150, max: 99, overflowSuffix: '+' }                                           // 99+
{ value: 42, prefixText: '≈ ', suffixText: ' pts' }                                    // ≈ 42 pts
```

- `format` is typed: `{ style: 'currency' }` without `currency` is a type error.
- Without `locale` and `format` the output is plain digits, exactly as in 1.x.
- Pass an explicit `locale` when the server and the browser must produce the same text.

---

## 📡 Events and promises

`setValue()` returns a promise that resolves when the animation ends:

```js
const { value, completed } = await counter.setValue(500);
// completed: false when another value replaced it before it finished, or the counter was destroyed
```

Per-call options:

```js
counter.setValue(10, false);                                  // roll instead of count
counter.setValue(10, { motion: 'none' });                     // instant
counter.setValue(10, { duration: 1500, easing: 'ease-out-expo' });
await counter.whenSettled();                                  // wait for the current animation
counter.finish();                                             // jump to the end now
```

Two DOM events are dispatched on the host (they bubble and cross shadow roots), with `detail = { value, from, animated }`:

| Event | When |
| :--- | :--- |
| `rn-start` | the display starts moving (also for instant changes, with `animated: false`) |
| `rn-end` | the display settled on the final value; the DOM is final |

```js
el.addEventListener('rn-end', (e) => console.log(e.detail.value)); // typed in TypeScript
```

React: `onRnStart` / `onRnEnd` props. Vue: `@rn-start` / `@rn-end`. Angular: `(rnStart)` / `(rnEnd)` outputs.

While a counter animates, its host carries `data-rn-state="animating"`, which you can use in CSS.

---

## 🧩 Works in any element

| Host | What happens |
| :--- | :--- |
| `<span>`, `<div>`, `<b>`, `<td>`, `<li>`, `<button>`, badges, cards, custom elements, SVG `<foreignObject>` | animated digit columns are appended; your other children are kept |
| `<input>` (text, search, tel, url, email, number), `<textarea>` | the value is rewritten frame by frame (**text mode**) |
| `<option>` | the visible text is rewritten (its `value` is untouched) |
| SVG `<text>`, `<tspan>`, `<textPath>` | the text is rewritten |
| `<select>`, `<img>`, other SVG elements, checkbox/range inputs | not supported: a console warning, nothing is written |

In text mode the counter never dispatches `input`/`change` events and never writes into a field the user is typing in (the final value lands on blur, unless the user edited it). Use **read-only or uncontrolled** fields: a framework-controlled input would overwrite the animation with its own value.

`input[type=number]` receives plain numbers (`1234.5`); other fields receive the formatted text (`1,234.50 €`).

---

## 🎨 Styling

The counter inherits the font, size and color of its host. Tune the animation and the look with CSS custom properties on the counter or any ancestor:

```css
.price {
  font: 700 2rem 'JetBrains Mono', monospace;
  color: #6366f1;
  --rn-duration: 800ms;                             /* animation length when the JS duration is unset */
  --rn-easing: cubic-bezier(0.34, 1.56, 0.64, 1);   /* easing when the JS easing is unset */
  --rn-lh: 1.2;                                     /* digit window height, in em */
}
```

| Property | Default | Effect |
| :--- | :--- | :--- |
| `--rn-duration` | `0.5s` | Duration of rolls. A non-default value also times counting (when `duration` is unset). |
| `--rn-easing` | `cubic-bezier(0.2, 1, 0.3, 1)` | Easing of rolls; a non-default value also eases counting. |
| `--rn-lh` | `1` | Height of the digit window (and line height). Raise it if tall glyphs are clipped. |
| `--rn-fill` | — | Background image painted into the glyphs: `--rn-fill: linear-gradient(#f0abfc, #818cf8); color: transparent;` |
| `--rn-bleed` | `0px` | Lets glows and overhangs show outside the digit window: `text-shadow: 0 0 12px gold; --rn-bleed: 12px;` (pair it with a taller `--rn-lh`). |
| `--rn-decoration` | — | Underline or strike-through that stays still while digits roll: `a { --rn-decoration: underline; }` |

**Hooks for your own CSS**: `.rn-rolling-number` (host), `[data-rn-state="animating"]` while moving, `.rn-col` (one per digit, with `data-digit`), `.rn-sign`, `.rn-static[data-rn-part="currency|group|decimal|prefix|suffix|overflow|…"]` for the static parts.

### Style injection, CSP and layers

- The stylesheet is added once per document (and once per shadow root that hosts a counter) through `adoptedStyleSheets`, inside `@layer rolling-number` where supported. Your own unlayered CSS always wins.
- With Tailwind v4 or other cascade layers, declare the library layer first so your layers win too: `@layer rolling-number;`
- Turn injection off everywhere with `configureRollingNumber({ injectStyles: false })` and import `rolling-number/style.css` yourself; per counter with `injectStyles: false`.
- Strict CSP: constructable stylesheets need no `style-src` exception. Where they are not available a `<style>` element is used: pass its nonce with `configureRollingNumber({ nonce })` (the IIFE build reads the nonce of its own `<script>` tag).

---

## 🧰 Use it in your framework

### React / Next.js

```tsx
'use client'; // only needed in Next.js App Router files that use state
import { useRef, useState } from 'react';
import { RollingNumber, useRollingNumber } from 'rolling-number/react';

export function Revenue() {
  const [amount, setAmount] = useState(45200);
  return (
    <RollingNumber
      value={amount}
      locale="en-US"
      format={{ style: 'currency', currency: 'USD' }}
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
}
```

- `<RollingNumber>` renders a `<span>`: any `<span>` prop works (`className` is merged, `ref` gets the span), plus `coreRef` for the `RollingNumberCore` (`coreRef.current.setValue(…)`).
- Removing a prop restores its default; a new but equal `format` object does not restart anything.
- `staticFallback` renders the formatted number on the server, so it is visible before hydration (no hydration warnings).
- Works with Shadcn, MUI, Ant Design and any other library: put the component wherever you would put the number.

### Vue / Nuxt

```vue
<script setup lang="ts">
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
</template>
```

- The component exposes `setValue`, `whenSettled`, `finish`, `getDisplayValue` and `core` through template refs (Vue 3.2+).
- The directive accepts a number, a string or an options object; `target: '.selector'` renders into an element inside the host.
- With SSR the directive renders `role` and `aria-label` on the server; `staticFallback` on the component renders the number too.

### Angular

```ts
import { Component } from '@angular/core';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [RollingNumberDirective],
  template: `
    <span [rollingNumber]="visitors" [pad]="4"></span>

    <span [rollingNumber]="price" rnLocale="it-IT"
          [rnFormat]="{ style: 'currency', currency: 'EUR' }"
          (rnEnd)="done($event.detail.value)" #c="rollingNumber"></span>
    <button (click)="c.setValue(0)">Reset</button>

    <!-- PrimeNG p-inputNumber, Material inputs: animate the inner <input> -->
    <p-inputNumber [rollingNumber]="qty" rnTarget="input" />
  `
})
export class StatsComponent {
  visitors = 1200;
  price = 49.9;
  qty = 3;
  done(value: number) { console.log(value); }
}
```

| Input | Option |
| :--- | :--- |
| `rollingNumber` | `value` |
| `pad`, `max`, `interpolate`, `duration` (also `rnPad`, `rnMax`, `rnInterpolate`, `rnDuration`) | the 1.x options |
| `rnEasing`, `rnDecimals`, `rnLocale`, `rnFormat`, `rnPrefixText`, `rnSuffixText`, `rnOverflowSuffix`, `rnMode`, `rnFrom`, `rnTrigger`, `rnLabel`, `rnLive`, `rnInjectStyles` | the 1.3 options (prefixed so they never clash with inputs of UI libraries such as PrimeNG's `prefix`/`format`) |
| `rnTarget` | `'auto'`, `'host'` or a CSS selector inside the host |

- Static attribute strings are converted (`pad="3"`, `interpolate="false"`), and `strictTemplates` checks every binding.
- The counter runs outside `NgZone` (no change detection per frame) and only in the browser (`isPlatformBrowser`). `(rnStart)`/`(rnEnd)` are emitted inside the zone, only when bound.
- `#c="rollingNumber"` gives the template `setValue`, `whenSettled`, `finish`, `getDisplayValue` and `core`.
- SSR: put the server text in the template, it is hidden when the counter starts: `<span [rollingNumber]="n"><span class="rn-ssr" data-rn-ssr>{{ n }}</span></span>`.

### Svelte, Solid, Alpine, Lit, Stimulus

```svelte
<script>
  import { rollingNumber } from 'rolling-number/action';
  let count = 0;
</script>

<span use:rollingNumber={{ value: count, pad: 3 }}></span>
<button on:click={() => count++}>+1</button>
```

`rollingNumber(node, param)` returns `{ update, destroy, core }`. `update()` takes the **full** option set (omitted options go back to their defaults), as Svelte actions do. The same call works with Solid (`ref={(el) => rollingNumber(el, …)}`), Alpine, Lit or plain DOM code.

### Web Component

```html
<rolling-number value="1234.5" locale="de-DE" format='{"style":"currency","currency":"EUR"}'></rolling-number>
<rolling-number value="150" max="99" overflow-suffix="+"></rolling-number>
<rolling-number value="7" no-interpolate></rolling-number>
```

- Every option is an attribute (kebab-case, `format` as JSON) and a typed property (`el.format = { style: 'percent' }`). Setting a property to `null` restores the default.
- Methods: `setValue()`, `whenSettled()`, `finish()`, `getDisplayValue()`. Events: `rn-start`, `rn-end`.
- `defineRollingNumber('my-counter')` registers the same element under another tag name.
- In React 19 / Vue templates, register the element before rendering, so objects such as `format` reach the property instead of an attribute.

### CDN (no build step)

```html
<script src="https://unpkg.com/rolling-number"></script>
<rolling-number value="42"></rolling-number>
<script>
  RollingNumber.rollingNumber(document.querySelector('#n'), { value: 7 });
</script>
```

The script registers `<rolling-number>` and injects the styles. `data-rn-inject="false"` on the script tag turns injection off.

---

## 🖥️ Server-side rendering

Every entry can be imported in Node without a DOM. Nothing is animated on the server; to show the number before JavaScript runs:

| Setup | How |
| :--- | :--- |
| React / Next.js | `<RollingNumber value={n} staticFallback />` |
| Vue / Nuxt | `<RollingNumber :value="n" static-fallback />`; the directive renders `role` and `aria-label` |
| Angular | the template fallback shown [above](#angular) |
| Any template engine | `renderStaticHTML({ value: 1234, locale: 'en-US' })` → `<span class="rn-ssr" data-rn-ssr>1,234</span>` inside your host, or `renderStaticHTML(options, { tag: 'rolling-number' })` for a full element |
| Plain text | `renderStaticText({ value: 0.25, format: { style: 'percent' } })` → `25%` |

On the client the counter hides the fallback (it does not remove it) and takes over. Pass an explicit `locale` so the server and the browser produce the same text.

---

## ♿ Accessibility

- In columns mode the host gets `role="img"` and an `aria-label` with the real value (formatted, not clamped by `max`), updated once per change, not on every frame. Customize it with `label`.
- The animated digits are `aria-hidden="true"`.
- `live: 'polite'` announces each settled value through a shared live region (one per page, or per open modal), debounced to 300 ms.
- Reduced motion (`prefers-reduced-motion: reduce`) makes every change instant.
- Inside buttons and links, put the counter on its own `<span>` (`<button>Cart <span v-rolling-number="n"></span></button>`), because of `role="img"`.
- In tests, query the accessible name: `getByRole('img', { name: '42' })`.

---

## 📚 API reference

### `RollingNumberCore`

```ts
const core = new RollingNumberCore(element, options?);
```

| Method | Description |
| :--- | :--- |
| `setValue(value, animate?)` | Sets the target; returns `Promise<{ value, completed }>`. `animate`: `true` (count), `false` (roll) or `{ motion, duration, easing }`. |
| `update(options)` | Changes several options (`undefined` = unchanged, `null` = default). |
| `whenSettled()` | Promise for the current animation (resolved at once when idle). |
| `finish()` | Jumps to the target now. |
| `getValue()` / `getDisplayValue()` | The target / the value on screen. |
| `getText()` | The formatted target text, e.g. `"99+"` or `"1.234,50 €"`. |
| `getMode()` | `'columns'` or `'text'`. |
| `getHost()` / `getElement()` | The host element. |
| `isAnimating()` | `true` while the display moves. |
| `setPad()`, `setMax()`, `setInterpolate()`, `setDuration()` | 1.x single-option setters. |
| `render()` | Re-applies the host class after a framework overwrote `className`. |
| `destroy()` | Removes only the nodes the counter created and restores the host. Safe to call twice. |

One counter per element: creating a second one on the same element replaces the first.

### Global functions

| Function | Description |
| :--- | :--- |
| `rollingNumber(node, param)` | The action (see [Svelte](#svelte-solid-alpine-lit-stimulus)). |
| `configureRollingNumber({ injectStyles, nonce })` | Global configuration; call it before the first counter. |
| `injectRollingNumberStyles(root)` | Adds the stylesheet to a document or shadow root yourself. |
| `renderStaticText(options)` / `renderStaticHTML(options, { tag, attrs })` | [SSR helpers](#%EF%B8%8F-server-side-rendering). |
| `defineRollingNumber(tagName?)` | Registers the element (done automatically by `import 'rolling-number'`). |

---

## 🧩 TypeScript and IDE support

Every entry ships typed declarations (ESM and CJS) with JSDoc on every option, so hovering an option shows its default and meaning.

- **Events** are typed on every element: `el.addEventListener('rn-end', (e) => e.detail.value)`.
- **`<rolling-number>` in React JSX**: importing `rolling-number/react` types it; otherwise `import type {} from 'rolling-number/jsx'` once (e.g. in `global.d.ts`).
- **`<rolling-number>` in Vue templates**: `import type {} from 'rolling-number/vue-element'` and mark the tag as a custom element in the Vue plugin (`isCustomElement: (tag) => tag === 'rolling-number'`).
- **Angular**: `strictTemplates` checks every input, output and `#c="rollingNumber"` call.
- **Custom Elements Manifest** (`custom-elements.json`) for Storybook and web-component tooling.
- **VS Code completion** for the tag, its attributes and the `--rn-*` properties in plain HTML/CSS:

```json
{
  "html.customData": ["./node_modules/rolling-number/dist/vscode.html-custom-data.json"],
  "css.customData": ["./node_modules/rolling-number/dist/vscode.css-custom-data.json"]
}
```

---

## 🌍 Browser support

Chrome 87+, Edge 88+, Firefox 78+, Safari 14+. Newer features are used with fallbacks:

| Feature | Fallback |
| :--- | :--- |
| Constructable stylesheets, `@layer` | a `<style>` element / an unlayered sheet |
| `IntersectionObserver` (`trigger: 'visible'`) | animates immediately |
| `lh` unit, `overflow: clip`, `overflow-clip-margin` | `em` heights, `overflow: hidden`, no bleed |
| `prefers-reduced-motion` | animations run normally |

---

## ⬆️ Upgrading from 1.2

1.3 keeps every 1.2 option, default, attribute, export, CSS class and CSS variable. What you may notice:

- **Counting now rolls** the digit columns continuously instead of swapping digits; `9 → 0` rolls forward; new digits and the sign grow in instead of popping; columns no longer change width.
- **You no longer need `import 'rolling-number/style.css'`** (it still works).
- `setValue()` returns a **promise** (S1). If a linter flags floating promises, write `void counter.setValue(x)`.
- `update({ duration: null })` / `setDuration(null)` go back to the **automatic** duration (S2).
- **Rolls are animated by JavaScript** (S3): right after `setValue(v, false)` the DOM is final only at `rn-end`; use `await counter.setValue(v, false)`, `finish()`, or `{ motion: 'none' }` for an instant change.
- A custom `--rn-duration` / `--rn-easing` now also times counting, and an explicit `duration` also times rolls (S4, S5).
- Mid-animation, `data-digit` describes each column, not a number on the path (S6); read `getDisplayValue()` instead.
- `<input>` and `<textarea>` hosts now show the animated value as text instead of invisible columns; `mode: 'columns'` restores 1.2.
- Size: with every feature the root entry is about 21 KB min+gzip (1.2: about 4 KB); the framework bindings add 1–2 KB each.

Details: [`CHANGELOG.md`](./CHANGELOG.md).

---

## 🚧 Limitations

- Compact notation (`1.2K`), scientific notation and variable fraction digits are not animated.
- In columns mode, affixes of right-to-left locales are placed left to right (text mode places them correctly).
- A horizontal `--rn-fill` gradient repeats per glyph.
- The host itself gets the class `rn-rolling-number` (`display: inline-flex`), `role="img"` and an `aria-label`.
- Moving a `<rolling-number>` element in the DOM rebuilds it at its final value.
- Framework-controlled inputs (React controlled, `ngModel`, `v-model`) overwrite the animated text: use read-only or uncontrolled inputs.

---

## 🤝 Contributing

See [`AGENTS.md`](./AGENTS.md) for the architecture, commands and conventions, [`docs/design/v1.3.md`](./docs/design/v1.3.md) for the design, and [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## 📄 License

[MIT](./LICENSE) © Erlon Rr
