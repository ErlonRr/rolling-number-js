# 🎲 rolling-number-js

> A lightweight, zero-dependency **Rolling Number Animation** library: a framework-agnostic core, a native Web Component (`<rolling-number>`), and dedicated bindings for **Angular** (PrimeNG, Material, NG-ZORRO), **React/Next.js** (Shadcn, MUI, AntD) and **Vue 3** (Vuetify, Element Plus, PrimeVue). Svelte and any other framework can use the Web Component or the core directly.

![rolling-number-js banner](https://raw.githubusercontent.com/ErlonRr/rolling-number-js/main/assets/rolling-number-js.png)

<div align="center">

[![npm version](https://img.shields.io/npm/v/rolling-number?color=6366f1&style=flat-square)](https://www.npmjs.com/package/rolling-number)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/rolling-number?color=10b981&label=minzipped&style=flat-square)](https://bundlephobia.com/package/rolling-number)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#)
[![Framework Agnostic](https://img.shields.io/badge/Frameworks-Angular%20%7C%20React%20%7C%20Vue%20%7C%20Svelte%20%7C%20Vanilla-blue?style=flat-square)](#-svelte-and-other-frameworks)

</div>

---

## ⚡ Preview

![rolling-number-js demo animation](https://raw.githubusercontent.com/ErlonRr/rolling-number-js/main/assets/rolling-number-js.gif)

---

## ✨ Features

- ⚡ **Lightweight**: zero runtime dependencies. The core is about **2.7 KB** min+gzip (about **3.3 KB** together with the Web Component); each framework binding adds about 1 KB.
- 🔄 **Two animation modes**:
  - **Interpolation (default, `interpolate: true`)**: a small `requestAnimationFrame` loop counts through the intermediate numbers (`1 → 2 → … → 50`) with `easeOutCubic` easing over `duration` ms. Each frame only writes the digits that changed; CSS transitions are switched off while it runs.
  - **CSS roll (`interpolate: false`)**: the digits jump to the new value and each column slides with a CSS `transform: translateY` transition (`--rn-duration`, `--rn-easing`), which runs on the compositor.
- 🌐 **Native framework subpaths (tree-shakable)**:
  - `rolling-number`: core (`RollingNumberCore`) and Web Component
  - `rolling-number/register`: registers `<rolling-number>` only
  - `rolling-number/angular`: standalone directive for **Angular 16+** (Ivy partial compilation; PrimeNG, Angular Material, NG-ZORRO)
  - `rolling-number/react`: `<RollingNumber />` component and `useRollingNumber` hook for **React 16.8+**, marked `'use client'` (Shadcn, MUI, AntD)
  - `rolling-number/vue`: `<RollingNumber />` component and `v-rolling-number` directive for **Vue 3** (Vuetify, Element Plus, PrimeVue)
- 🛡️ **Robust input handling**: invalid values never throw. `NaN`, `''`, `null`, numeric strings and huge numbers are normalized ([details](#input-normalization)).
- ♿ **Accessible**: `role="img"` with an `aria-label` holding the real value, decorative digit strips marked `aria-hidden="true"`, and `prefers-reduced-motion` support.
- 🌍 **RTL-safe**: digits always read left to right, even inside `dir="rtl"` text.
- 🖥️ **SSR-safe imports**: every entry can be imported in Node (Next.js, Nuxt, Angular SSR, SvelteKit). The counter is created only in the browser.
- 🎨 **Customizable**: fonts, colors, digit window height and the CSS roll are plain CSS, with a `data-rn-state="animating"` hook for styling the running animation.
- 🧩 **Typed everywhere**: JSDoc on every public symbol, typed JSX and Vue templates, a Custom Elements Manifest and VS Code HTML/CSS custom data.

---

## 📦 Installation

Install using **pnpm** (recommended), npm, or yarn:

```bash
# Using pnpm
pnpm add rolling-number

# Using npm
npm install rolling-number

# Using yarn
yarn add rolling-number
```

### 🎨 Import the stylesheet (required)

The JavaScript does **not** inject any CSS. Without `rolling-number/style.css` (`dist/style.css`) every column shows the whole `0123456789` strip. Import it **once** per app:

| Setup | How |
| :--- | :--- |
| Vite, webpack, Next.js, Nuxt, Vue CLI | `import 'rolling-number/style.css';` in your entry or in any component |
| Angular CLI | add `@import 'rolling-number/style.css';` to `src/styles.css` (or add `node_modules/rolling-number/dist/style.css` to `"styles"` in `angular.json`). A CSS `import` inside a component `.ts` file is **not** loaded by the Angular application builder. |
| Plain HTML | `<link rel="stylesheet" href="/node_modules/rolling-number/dist/style.css">` (or copy the file to your assets) |

### Where to put it

Use a **container element** as the host: `<span>`, `<div>`, `<b>`, `<strong>`, a badge or tag body, and so on. The digits are added as child nodes of the host.

> ⚠️ `<input>`, `<textarea>`, `<select>`, `<img>`, `<svg>` and other void or replaced elements are **not supported in 1.x**. They cannot display child nodes, so the counter would be invisible (a console warning is printed). Put the counter **next to** the input instead. A text mode for form controls is planned for 1.3.

---

## 🅰️ Angular UI Library Integrations (PrimeNG, Material, NG-ZORRO)

All examples assume the stylesheet is in your global styles:

```css
/* src/styles.css */
@import 'rolling-number/style.css';
```

### 1. PrimeNG 19 (`p-inputNumber` / `p-tag`)
```typescript
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-demo',
  standalone: true,
  imports: [FormsModule, InputNumberModule, TagModule, RollingNumberDirective],
  template: `
    <!-- The input stays a normal input; the animated total sits next to it -->
    <p-inputNumber [(ngModel)]="price" inputId="price"></p-inputNumber>
    <strong>Total: $<span [rollingNumber]="price" [pad]="2"></span></strong>

    <!-- Projected into the tag body -->
    <p-tag severity="info">
      <span [rollingNumber]="cartItems" [max]="99"></span>
    </p-tag>
  `
})
export class DemoComponent {
  price = 1250;
  cartItems = 42;
}
```

### 2. Angular Material (`mat-chip` / `mat-card`)
```typescript
import { Component } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-material-demo',
  standalone: true,
  imports: [MatChipsModule, RollingNumberDirective],
  template: `
    <mat-chip-option selected>
      Balance: $<span [rollingNumber]="balance" [pad]="2"></span>
    </mat-chip-option>
  `
})
export class MaterialDemoComponent {
  balance = 850;
}
```

### 3. NG-ZORRO (Ant Design Angular)
```typescript
import { Component } from '@angular/core';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { RollingNumberDirective } from 'rolling-number/angular';

@Component({
  selector: 'app-ant-demo',
  standalone: true,
  imports: [NzStatisticModule, RollingNumberDirective],
  template: `
    <nz-statistic [nzValue]="usersCount" [nzTitle]="'Active Users'" [nzValueTemplate]="rolling"></nz-statistic>
    <ng-template #rolling let-value>
      <span [rollingNumber]="value" pad="3"></span>
    </ng-template>
  `
})
export class AntDemoComponent {
  usersCount = 1420;
}
```

### Angular notes

- **Inputs**: `[rollingNumber]` (the value), `pad`, `max`, `interpolate`, `duration`. Static string attributes are coerced: `rollingNumber="42"`, `pad="3"`, `duration="600"`, `interpolate="false"` (also `"0"`, `"off"`), and a bare `interpolate` attribute means `true`. `null`/`undefined` fall back to the defaults, and `strictTemplates` type-checks the bindings.
- **Zone-friendly**: the core and its animation frames run outside `NgZone`, so an animation does not trigger change detection on every frame. Works with zoneless apps too.
- **SSR-safe**: the core is created only when `isPlatformBrowser()` is true. On the server the host is rendered as-is.
- Compiled with `@angular/compiler-cli` 18 in Ivy partial mode (`minVersion` 16.0.0), so the Angular linker processes it in AOT builds from Angular 16 on. Each release runs `check:ng-aot`, which compiles a `strictTemplates` component against the package and links it with the Angular linker. It uses `@angular/core` and `@angular/common`, which every Angular app already has.
- Hosts whose tag name contains `-input` (for example `<p-inputNumber>`) get an inner `<span class="rn-angular-target">`, kept for backward compatibility. Prefer a separate `<span>` next to the input, as shown above.

---

## ⚛️ React & Next.js UI Library Integrations (Shadcn UI, MUI, AntD)

### 1. Shadcn UI / Tailwind CSS
```tsx
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RollingNumber } from 'rolling-number/react';
import 'rolling-number/style.css';

export function ShadcnStatCard() {
  const [revenue, setRevenue] = useState(45200);

  return (
    <Card className="w-80">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
        <Badge variant="secondary">Live</Badge>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-indigo-500">
          $<RollingNumber value={revenue} pad={5} />
        </div>
      </CardContent>
    </Card>
  );
}
```

### 2. MUI (Material UI)
```tsx
import { useState } from 'react';
import { Card, Typography, Chip } from '@mui/material';
import { RollingNumber } from 'rolling-number/react';
import 'rolling-number/style.css';

export function MuiStat() {
  const [count, setCount] = useState(1280);

  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="subtitle2" color="text.secondary">
        Active Subscribers
      </Typography>
      <Typography variant="h3" color="primary" sx={{ my: 1, fontWeight: 'bold' }}>
        <RollingNumber value={count} pad={4} />
      </Typography>
      <Chip label="+12% this week" color="success" size="small" />
    </Card>
  );
}
```

### 3. Ant Design (AntD)
```tsx
import { Statistic } from 'antd';
import { RollingNumber } from 'rolling-number/react';
import 'rolling-number/style.css';

export function AntdStat({ value }: { value: number }) {
  return (
    <Statistic
      title="Feedback Score"
      value={value}
      formatter={() => <RollingNumber value={value} pad={2} />}
    />
  );
}
```

### React notes

- **`<RollingNumber>`** renders a `<span>` and accepts the options as props plus any `<span>` attribute (`id`, `style`, `aria-*`, event handlers, …). `children` and `dangerouslySetInnerHTML` are not accepted, because the counter owns the span content.
- **`className` is merged** with `rn-rolling-number`, so conditional classes (`className={active ? 'a' : 'b'}`) never break the layout.
- **`ref` is forwarded** to the `<span>` (`forwardRef`), so it works with Radix `asChild`, MUI `Tooltip` and similar.
- Removing a prop restores its default.
- **`useRollingNumber(ref, options)`** attaches a counter to any element you render. It follows the element if it mounts late (`show && <span ref={ref} />`) or is replaced, and returns a ref to the `RollingNumberCore`:

```tsx
import { useRef } from 'react';
import { useRollingNumber } from 'rolling-number/react';

function Price({ amount }: { amount: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const core = useRollingNumber(ref, { value: amount, pad: 4, duration: 800 });
  return <span ref={ref} onClick={() => core.current?.setValue(0)} />;
}
```

- **Next.js App Router**: `rolling-number/react` ships with a `'use client'` banner, so it can be rendered from Server Components. On the server it renders an empty `<span class="rn-rolling-number">` that fills in on hydration.
- Peer range is React 16.8+ (tested with 18 and 19). The bundle uses `createElement` only, so it never pulls in a `react/jsx-runtime` of its own.

---

## 🟢 Vue 3 UI Library Integrations (Vuetify, Element Plus, PrimeVue)

### 1. PrimeVue (`InputNumber` / `Badge`)
```vue
<script setup>
import { ref } from 'vue';
import InputNumber from 'primevue/inputnumber';
import Badge from 'primevue/badge';
import { vRollingNumber } from 'rolling-number/vue';
import 'rolling-number/style.css';

const val = ref(1500);
</script>

<template>
  <div class="flex gap-4 items-center">
    <!-- The input stays a normal input; the animated value sits next to it -->
    <InputNumber v-model="val" />
    <strong v-rolling-number="val"></strong>

    <!-- Rendered inside the badge's default slot -->
    <Badge severity="info">
      <span v-rolling-number="{ value: val, max: 999 }"></span>
    </Badge>
  </div>
</template>
```

### 2. Vuetify 3 (`v-card` / `v-chip`)
```vue
<script setup>
import { ref } from 'vue';
import { RollingNumber } from 'rolling-number/vue';
import 'rolling-number/style.css';

const downloads = ref(8420);
</script>

<template>
  <v-card class="pa-4" elevation="3">
    <v-card-title>App Downloads</v-card-title>
    <div class="text-h3 font-weight-bold text-primary">
      <RollingNumber :value="downloads" :pad="4" />
    </div>
  </v-card>
</template>
```

### 3. Element Plus (`el-card` / `el-tag`)
```vue
<script setup>
import { ref } from 'vue';
import { vRollingNumber } from 'rolling-number/vue';
import 'rolling-number/style.css';

const score = ref(980);
</script>

<template>
  <el-card>
    <template #header>Performance Score</template>
    <span class="score" v-rolling-number="score"></span>
    <el-tag type="success">
      <span v-rolling-number="{ value: score, max: 999 }"></span>
    </el-tag>
  </el-card>
</template>
```

### Vue notes

- **`<RollingNumber>`** renders a `<span class="rn-rolling-number">`. Vue merges your `class`/`style`/`aria-*` attributes with it, so a dynamic `:class` never removes the library class. `interpolate` also accepts the string `"false"` (`interpolate="false"`). Only the props that changed are forwarded to the core.
- **`v-rolling-number`** accepts a number, a numeric string, or an options object (typed as `RollingNumberBinding`, including `interpolate` and `duration`). Parent re-renders that do not change the binding cost nothing (a `:class` change on the host only puts the library class back). Fields left `undefined` keep their current value.
- **SSR (Nuxt)**: the component renders an empty span on the server and the directive adds nothing (`getSSRProps`); the counter starts on the client.

---

## 🧡 Svelte and other frameworks

There is no dedicated Svelte package. Use the Web Component, or wrap the core in a two-line action.

**Web Component** (Svelte 5 / SvelteKit shown; Svelte 4 works the same with `let` and `on:click`):

```svelte
<script>
  import 'rolling-number/register';
  import 'rolling-number/style.css';

  let count = $state(0); // Svelte 5 syntax
</script>

<rolling-number value={count} pad="3" max="999"></rolling-number>
<button onclick={() => count++}>+1</button>
```

**Action** on any element:

```svelte
<script>
  import { RollingNumberCore } from 'rolling-number';
  import 'rolling-number/style.css';

  function rollingNumber(node, options) {
    const core = new RollingNumberCore(node, options);
    return { update: (next) => core.update(next), destroy: () => core.destroy() };
  }

  let score = $state(120);
</script>

<span use:rollingNumber={{ value: score, pad: 3 }}></span>
```

Both are SSR-safe in SvelteKit: the imports do nothing on the server and actions only run in the browser. The same `new RollingNumberCore(el, options)` / `update()` / `destroy()` pattern works with Solid, Lit, Alpine, Stimulus or plain DOM code.

---

## 🌐 Web Component & Vanilla JS

### Web Component (`<rolling-number>`)
```typescript
import 'rolling-number/register'; // or: import 'rolling-number'
import 'rolling-number/style.css';
```

```html
<rolling-number value="1234" pad="4"></rolling-number>
<rolling-number value="7" max="99" interpolate="false" duration="600"></rolling-number>
```

```typescript
const el = document.querySelector('rolling-number')!; // typed as RollingNumberElement
el.value = 1200;   // properties are reflected to attributes
el.max = null;     // null/undefined remove the attribute and restore the default
```

- Every option is both an attribute (string) and a property (typed). Setting a property to `null` or `undefined` restores the default instead of throwing, which also covers React 19 removing a prop.
- Properties assigned **before** the element is defined (for example by a framework that renders before your `import`) are picked up when it upgrades.
- **Custom tag names**: `defineRollingNumber('my-counter')` registers the same element under another name. It can be called for as many names as you like, and calling it for a name that is already defined does nothing.

```typescript
import { defineRollingNumber } from 'rolling-number';
defineRollingNumber('my-counter'); // <my-counter value="5"></my-counter>
```

> `import 'rolling-number'` and `import 'rolling-number/register'` register `<rolling-number>` automatically in the browser (and do nothing in Node).

### Vanilla JS API
```typescript
import { RollingNumberCore } from 'rolling-number';
import 'rolling-number/style.css';

const counter = new RollingNumberCore(document.getElementById('counter')!, {
  value: 42,
  pad: 3,
  max: 99
});

counter.setValue(128);        // animated (interpolate: true)
counter.setValue(0, false);   // immediate
counter.update({ pad: 2, duration: 800 });
counter.isAnimating();        // true while an interpolation runs
counter.destroy();            // restores the host as it was
```

---

## ⚙️ API & Configuration

### Options (all bindings, all optional)

| Property / Attribute | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `value` | `number` | `0` | The value to display and animate to. Decimals are rounded for display (`1.5` → `2`, `-1.5` → `-2`); negative values show a `−` sign. |
| `pad` | `number` | `1` | Minimum number of digit columns, padded with leading zeros (`pad: 3` shows `7` as `007`). Range 1–64. |
| `max` | `number \| null` | `null` | Upper bound of the **displayed** absolute value, e.g. `99` for a notification badge: `150` is shown as `99` (there is no `99+` suffix in 1.x). The `aria-label` still announces the real value. `null` means no limit. |
| `interpolate` | `boolean` | `true` | Count through the intermediate numbers with `requestAnimationFrame`. `false` (or the string `"false"`) jumps to the new value and lets each column roll with the CSS transition. |
| `duration` | `number` | `400` | Interpolation duration in **milliseconds** (only used when `interpolate` is on). `0` disables interpolation. |

### Input normalization

Invalid input never throws. Each option is normalized the same way in the core, the Web Component and every framework binding:

| Option | Normalization |
| :--- | :--- |
| `value` | Numeric strings are accepted. `NaN`, `Infinity`, `null`, `''` and non-numeric strings become `0`. The magnitude is clamped to `Number.MAX_SAFE_INTEGER`. |
| `pad` | Non-finite or `< 1` becomes `1`. Decimals are floored and the value is clamped to `64`. |
| `max` | `null`, `undefined`, `''`, negative or non-finite becomes `null` (no limit). Decimals are floored. |
| `interpolate` | `null` and `undefined` become `true` (the default). The string `"false"` is `false`; anything else is `Boolean(x)`. |
| `duration` | Negative becomes `0` (no interpolation). Non-finite becomes `400` at creation; later, `setDuration()` and `update()` ignore non-finite input and keep the current duration. |

### `RollingNumberCore` methods

| Method | Description |
| :--- | :--- |
| `new RollingNumberCore(el, options?)` | Attaches a counter to `el` and renders the initial value without animation. A second core on the same element replaces the first one. Works with elements from iframes and other windows. |
| `setValue(value, animate = interpolate)` | Sets a new target. A call during an animation restarts it from the number currently shown. |
| `getValue()` | Returns the target value (already the final value during an animation). |
| `update(options)` | Applies several options at once; `undefined` fields are left unchanged. |
| `setPad(n)`, `setMax(n \| null)`, `setInterpolate(b)`, `setDuration(ms)` | Update a single option. |
| `getElement()` | Returns the host element. |
| `isAnimating()` | `true` while an interpolation is running. |
| `render()` | Re-applies the host class after a framework overwrote `className`. Setters already render when needed. |
| `destroy()` | Cancels the animation, removes only the nodes the core created and restores the host's previous `role`, `aria-label` and class. Other children are left alone. Safe to call twice; the instance does nothing afterwards. |

---

## 🎨 Customization (CSS)

```css
rolling-number, .rn-rolling-number {
  font-family: 'JetBrains Mono', monospace;
  font-size: 2.5rem;
  color: #6366f1;

  --rn-lh: 1.1;                                     /* digit window height, in em */
  --rn-duration: 0.6s;                              /* CSS roll (interpolate: false) */
  --rn-easing: cubic-bezier(0.34, 1.56, 0.64, 1);   /* CSS roll (interpolate: false) */
}
```

| Variable | Default | Effect |
| :--- | :--- | :--- |
| `--rn-duration` | `0.5s` | Duration of each column's CSS roll. Used when `interpolate` is `false`; in the default interpolation mode the timing comes from the `duration` option. |
| `--rn-easing` | `cubic-bezier(0.2, 1, 0.3, 1)` | Easing of the CSS roll (same scope as `--rn-duration`). |
| `--rn-lh` | `1` | Height of the digit window as a multiple of the font size; it is also the counter's `line-height`. Raise it if tall glyphs are clipped. Setting `line-height` directly on the counter also works in browsers that support the `lh` unit (Chrome 109+, Edge 109+, Firefox 120+, Safari 16.4+); in older browsers the window follows `--rn-lh` only, so set `--rn-lh` instead. |

**Animation state hook.** While an interpolation runs, the host carries `data-rn-state="animating"` (plus the legacy `rn-interpolating` class). Both are removed when it ends:

```css
.rn-rolling-number[data-rn-state="animating"] {
  color: #10b981;
}
```

**Class names**: the host gets `.rn-rolling-number`; inside it you will find `.rn-sign` (the minus sign) and one `.rn-col` per digit containing `.rn-sizer`, `.rn-scale` and ten `.rn-cell`s.

**Reduced motion.** When the user has *reduce motion* enabled (`prefers-reduced-motion: reduce`), value changes are applied immediately and the CSS transitions are disabled.

**RTL.** The counter is isolated with `direction: ltr; unicode-bidi: isolate`, so `1234` and `−42` read correctly inside `dir="rtl"` content.

---

## ♿ Accessibility

- The host gets `role="img"` and an `aria-label` with the target value (rounded, not clamped by `max`). It is updated only when the value changes, not on every animation frame.
- The digit strips and the sign are `aria-hidden="true"`.
- Because of `role="img"`, put the counter on its own `<span>` **inside** buttons and links (`<button>Cart <span v-rolling-number="n"></span></button>`), not on the button itself. An `aria-label` you set on the host is replaced while the counter is attached and restored by `destroy()`.
- In tests, query the accessible name rather than the text: `getByRole('img', { name: '42' })`. The element's `textContent` contains the digit strips.

---

## 🖥️ SSR

- Every entry (`rolling-number`, `/register`, `/react`, `/vue`, `/angular`) can be imported in Node without a DOM. Custom element registration only happens when `window.customElements` exists.
- Nothing is animated or measured on the server; the counter is built on the client:
  - **React**: an empty `<span class="rn-rolling-number …">`, filled in on hydration. The entry is marked `'use client'`.
  - **Vue**: the component renders an empty span and the directive adds nothing.
  - **Angular**: the directive skips the core on the server (`isPlatformBrowser`).
  - **Web Component**: `<rolling-number value="42">` is serialized as-is and upgraded in the browser.
- Do not put fallback text inside the host (for example `<span>42</span>`): existing children are kept, so the digits would be added after it.

---

## 🌍 Browser support

The JavaScript targets Vite's default `modules` baseline (ES2020: Chrome 87+, Edge 88+, Firefox 78+, Safari 14+). The Web Component needs Custom Elements v1, which these browsers have. Newer CSS features are used with fallbacks:

| Feature | Fallback |
| :--- | :--- |
| `lh` unit (digit window height) | `calc(var(--rn-lh, 1) * 1em)` (follows `--rn-lh` only, not a `line-height` set directly on the counter) |
| `overflow: clip` | `overflow: hidden` |
| `customElements.getName()` (extra tag names) | internal bookkeeping |
| `matchMedia('(prefers-reduced-motion)')` | animations run normally |

---

## 🚧 Known limitations in 1.x

These are planned for later releases (see [`docs/AUDIT.md`](./docs/AUDIT.md), section 5):

- **Form controls and replaced elements** (`<input>`, `<textarea>`, `<select>`, `<img>`, `<svg>`, …) cannot host the counter. A text mode is planned for 1.3.
- In the default interpolation mode the number **counts** (each frame shows the next number); the columns do not physically roll. In `interpolate: false` mode the columns roll along the `0–9` strip, so `9 → 0` rolls back through `8…1`. A continuous odometer is planned for 1.3.
- `max` clamps the display; there is no `99+` suffix or number formatting (separators, decimals) yet.
- The CSS is not injected automatically, and the counter renders in light DOM (no shadow root, no `::part`).
- The host itself gets `display: inline-flex`, `role="img"` and an `aria-label`. Use a dedicated `<span>`/`<div>` rather than a `<td>`, `<li>`, `<button>` or `<a>`.
- `text-shadow` glows and glyph overhang outside the digit window are clipped.
- Moving a `<rolling-number>` element in the DOM rebuilds it and jumps to the final value.

---

## 🧩 TypeScript & IDE Support

Every entry ships typed declarations (ESM `.d.ts` and CJS `.d.cts`) with JSDoc (defaults, units, accepted ranges, examples), so hovering an option in your editor explains it. They resolve with `moduleResolution` `bundler`, `node16`/`nodenext` and the legacy `node`.

**`<rolling-number>` in React JSX.** Importing `rolling-number/react` already types the custom element. If you only use the custom element, opt in once (e.g. in `global.d.ts`):

```typescript
import type {} from 'rolling-number/jsx';
```

```tsx
<rolling-number value={count} pad={3} max={99} interpolate="false" />
```

Both React 18 (global `JSX`) and React 19 (`React.JSX`) are supported. `pad="x"` and other invalid values are type errors. Exported type: `RollingNumberJSXProps`.

**Vue templates (Volar / vue-tsc).** Components and directives imported locally in `<script setup>` are typed out of the box. `rolling-number/vue` declares nothing globally; if you register them globally (`app.component('RollingNumber', RollingNumber)`, `app.directive('rolling-number', vRollingNumber)`), add the typing yourself in `env.d.ts`:

```typescript
import type { RollingNumber, vRollingNumber } from 'rolling-number/vue';

declare module 'vue' {
  interface GlobalComponents {
    RollingNumber: typeof RollingNumber;
  }
  interface GlobalDirectives {
    vRollingNumber: typeof vRollingNumber;
  }
}
```

To type the raw custom element, opt in once in `env.d.ts`:

```typescript
import type {} from 'rolling-number/vue-element';
```

and tell Vue that the tag is a custom element (`compilerOptions.isCustomElement: (tag) => tag === 'rolling-number'` in the Vue Vite plugin). If you type the component globally as above, Volar resolves `<rolling-number>` to the component first, so use either the component or the custom element in a given project. Exported types: `RollingNumberProps`, `RollingNumberBinding` and `RollingNumberElementComponent`.

**Angular.** The `[rollingNumber]` directive inputs are typed, so `strictTemplates` rejects invalid bindings.

**DOM.** `document.querySelector('rolling-number')` and `document.createElement('rolling-number')` return `RollingNumberElement` (`HTMLElementTagNameMap`). `RollingNumberAttributes` describes the markup form of the options.

**Custom Elements Manifest.** The package ships [`custom-elements.json`](https://github.com/webcomponents/custom-elements-manifest) (`"customElements"` field in `package.json`, also importable as `rolling-number/custom-elements.json`) for Storybook, linters, and other web component tooling.

**VS Code HTML and CSS completion.** Add the generated custom data to `.vscode/settings.json` to get autocomplete and hover docs for `<rolling-number>`, its attributes, and the `--rn-*` CSS variables in plain HTML and CSS files:

```json
{
  "html.customData": ["./node_modules/rolling-number/dist/vscode.html-custom-data.json"],
  "css.customData": ["./node_modules/rolling-number/dist/vscode.css-custom-data.json"]
}
```

---

## 🤝 Contributing

See [`AGENTS.md`](./AGENTS.md) for the architecture, commands and conventions, and [`CHANGELOG.md`](./CHANGELOG.md) for release notes.

---

## 📄 License

[MIT](./LICENSE) © Erlon Rr
