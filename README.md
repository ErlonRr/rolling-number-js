# 🎲 rolling-number-js

> An ultra-fast, zero-dependency, GPU-accelerated **Rolling Number Animation** library, native Web Component (`<rolling-number>`), and dedicated framework integrations for **Angular**, **React/Next.js**, and **Vue 3**.

![rolling-number-js banner](./assets/rolling-number-js.png)

<div align="center">

[![npm version](https://img.shields.io/npm/v/rolling-number?color=6366f1&style=flat-square)](https://www.npmjs.com/package/rolling-number)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/rolling-number?color=10b981&label=minzipped&style=flat-square)](https://bundlephobia.com/package/rolling-number)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#)
[![Framework Agnostic](https://img.shields.io/badge/Frameworks-Angular%20%7C%20React%20%7C%20Vue%20%7C%20Svelte%20%7C%20Vanilla-blue?style=flat-square)](#)

</div>

---

## ⚡ Preview

![rolling-number-js demo animation](./assets/rolling-number-js.gif)

---

## ✨ Features

- ⚡ **Ultra Fast & Lightweight**: Zero external runtime dependencies for core library. Core engine is **< 1.5 KB** gzipped.
- 🚀 **Hardware Accelerated (60 FPS)**: Powered by pure CSS `translateY` transitions on GPU compositor threads. No blocking JS loops.
- 🌐 **Native Framework Subpaths**:
  - `rolling-number` — Core Vanilla JS & Web Component
  - `rolling-number/angular` — Standalone Directive for **Angular 16-19+** (Supports PrimeNG 19, Material, etc.)
  - `rolling-number/react` — React Component (`<RollingNumber />`) & Hook (`useRollingNumber`)
  - `rolling-number/vue` — Vue 3 Directive (`v-rolling-number`) & Component (`<RollingNumber />`)
- ♿ **Accessible**: Built-in screen reader support (`role="img"`, dynamic `aria-label`, decorative rungs marked with `aria-hidden="true"`).
- 🎨 **Fully Customizable**: Style font sizes, colors, duration, and easing curves using simple CSS variables.

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

---

## 🅰️ Angular Integration (including PrimeNG 19, Material, etc.)

Attach `[rollingNumber]` to **ANY** HTML element, text container, or UI library component like PrimeNG 19 `<p-inputNumber>`:

```typescript
import { Component } from '@angular/core';
import { RollingNumberDirective } from 'rolling-number/angular';
import 'rolling-number/style.css';

@Component({
  selector: 'app-demo',
  standalone: true,
  imports: [RollingNumberDirective],
  template: `
    <!-- Simple HTML Element -->
    <span [rollingNumber]="totalAmount" [pad]="2"></span>

    <!-- On PrimeNG 19 InputNumber or Custom Component -->
    <p-inputNumber [(ngModel)]="totalAmount" [rollingNumber]="totalAmount" [pad]="2"></p-inputNumber>
  `
})
export class DemoComponent {
  totalAmount = 1250;
}
```

---

## ⚛️ React & Next.js Integration

```tsx
import { useState } from 'react';
import { RollingNumber } from 'rolling-number/react';
import 'rolling-number/style.css';

export function ReactCounter() {
  const [count, setCount] = useState(42);

  return (
    <div>
      <RollingNumber value={count} pad={3} className="my-counter" />
      <button onClick={() => setCount(c => c + 10)}>Add</button>
    </div>
  );
}
```

Or using the custom React Hook (`useRollingNumber`):

```tsx
import { useRef } from 'react';
import { useRollingNumber } from 'rolling-number/react';
import 'rolling-number/style.css';

export function HookCounter({ value }: { value: number }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  useRollingNumber(spanRef, { value, pad: 2 });

  return <span ref={spanRef} />;
}
```

---

## 🟢 Vue 3 Integration

```vue
<script setup>
import { ref } from 'vue';
import { RollingNumber, vRollingNumber } from 'rolling-number/vue';
import 'rolling-number/style.css';

const val = ref(99);
</script>

<template>
  <!-- Via Vue Component -->
  <RollingNumber :value="val" :pad="2" />

  <!-- Or via Vue Directive -->
  <span v-rolling-number="val"></span>
</template>
```

---

## 🌐 Web Component & Vanilla JS

### Web Component (`<rolling-number>`)
```typescript
import 'rolling-number/register';
import 'rolling-number/style.css';
```

```html
<rolling-number value="1234" pad="4"></rolling-number>
```

### Vanilla JS API
```typescript
import { RollingNumberCore } from 'rolling-number';
import 'rolling-number/style.css';

const counter = new RollingNumberCore(document.getElementById('counter'), {
  value: 42,
  pad: 3,
  max: 99
});

counter.setValue(128);
```

---

## ⚙️ API & Configuration

### Properties & Attributes

| Property / Attribute | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `value` | `number` | `0` | The numeric value to display and animate to. |
| `pad` | `number` | `1` | Minimum number of digit columns (pads leading zeros). |
| `max` | `number \| null` | `null` | Maximum value limit (e.g. `99` for notification counters like `99+`). |

---

## 🎨 Customization (CSS Variables)

```css
rolling-number, .rn-rolling-number {
  --rn-duration: 0.6s;
  --rn-easing: cubic-bezier(0.34, 1.56, 0.64, 1);

  font-family: 'JetBrains Mono', monospace;
  font-size: 2.5rem;
  color: #6366f1;
}
```

---

## 📄 License

[MIT](./LICENSE) © Erlon Rr
