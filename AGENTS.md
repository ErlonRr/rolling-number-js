# AGENTS.md

Guide for AI coding agents and human contributors working on **rolling-number** (npm package `rolling-number`, repo `rolling-number-js`).

## Purpose and constraints

An animated, odometer-style number counter: one framework-agnostic core plus thin bindings (Web Component, React, Vue 3, Angular).

- **Zero runtime dependencies.** Frameworks are optional `peerDependencies` (`react >=16.8`, `vue >=3`, `@angular/core` and `@angular/common` `>=16`) and are never bundled. Never add a runtime dependency.
- **Framework-agnostic core.** `src/core.ts` must not import any framework. Adapters only translate framework lifecycles into `RollingNumberCore` calls.
- **Injectable into any container host** (`span`, `div`, badges, cards, custom elements). The core appends its own nodes and must leave the host's other children alone. Form controls and replaced elements (`input`, `textarea`, `img`, `svg`, …) are not supported in 1.x; the core only warns.
- **Non-breaking within 1.x.** Keep every public API, option name, default (`value 0`, `pad 1`, `max null`, `interpolate true`, `duration 400`), export path, the `<rolling-number>` tag, the CSS classes (`.rn-rolling-number`, `.rn-col`, `.rn-sizer`, `.rn-scale`, `.rn-cell`, `.rn-sign`, `.rn-interpolating`) and the CSS variables (`--rn-duration`, `--rn-easing`, `--rn-lh`). Additive changes only; breaking ideas go to the v2.0 list in `docs/AUDIT.md`.

## Architecture map

```
src/
  core.ts                 RollingNumberCore, RollingNumberOptions, RN_DEFAULTS, normalizeOptions (all logic lives here)
  rolling-number.css      layout + CSS roll; extracted to dist/style.css (never injected by JS)
  element.ts              <rolling-number> custom element (light DOM), defineRollingNumber(), HTMLElementTagNameMap
  index.ts                root entry: core + element, auto-registers <rolling-number> in the browser
  register.ts             entry that only registers the element
  jsx.ts                  type-only: <rolling-number> in React JSX (React.JSX and global JSX)
  vue-element.ts          type-only: <rolling-number> in Vue templates (GlobalComponents)
  react/                  RollingNumber (forwardRef, createElement, no JSX) + useRollingNumber hook
  vue/                    RollingNumber component + vRollingNumber directive
  angular/                standalone RollingNumberDirective ([rollingNumber]), compiled by ngc
tests/                    vitest + happy-dom (core, element, css, adapters, SSR) and *.test-d.ts type tests
scripts/                  build-types.mjs (.d.ts/.d.cts), smoke.mjs, ng-aot-check.mjs, vscode-custom-data.mjs
custom-elements-manifest.config.mjs   CEM analyzer config (dist/custom-elements.json)
index.html                demo page (imports ./src/index)
docs/AUDIT.md             audit of v1.2.1: finding ids (B.., I.., C..) and the roadmap
```

**Data flow.** Framework prop/attribute → adapter → `new RollingNumberCore(host, options)` on mount, then `core.update(changedFields)` or a single setter (`setValue`, `setPad`, `setMax`, `setInterpolate`, `setDuration`) on change, and `core.destroy()` on unmount. The Web Component's property setters only reflect to attributes; `attributeChangedCallback` is the only path to the core.

**Rendering.** `render()` diffs against cached state: the host gets `rn-rolling-number`, `role="img"` and `aria-label` (the target value, written only when it changes); the core owns an optional `.rn-sign` and one `.rn-col` per digit (`.rn-sizer` + `.rn-scale` with ten `.rn-cell`s). The digit shown is selected by `data-digit="N"` on the column, which the CSS maps to `translateY(-N*10%)`.

**Animation model.**
- `interpolate: true` (default): a `requestAnimationFrame` loop eases `displayValue` (easeOutCubic over `duration` ms, start time taken from the first rAF timestamp, progress clamped to [0,1]). While it runs the host has `data-rn-state="animating"` and `.rn-interpolating`, and CSS transitions are off. On the last frame the final digits are rendered, styles are flushed (`offsetWidth`), then the state is cleared.
- `interpolate: false`: `data-digit` changes directly and the CSS transition (`--rn-duration`, `--rn-easing`) rolls each column.
- `prefers-reduced-motion: reduce`: no rAF, values are applied immediately; the CSS media query disables transitions.

**Lifecycle invariants.** One live core per host (module-level `WeakMap`; a new core destroys the previous one). `destroy()` removes only the core's nodes, restores the previous `role`/`aria-label`/class and makes the instance inert. Safe to call twice.

## Commands

Use **pnpm**.

| Command | What it does |
| :--- | :--- |
| `pnpm install` | Install dev dependencies |
| `pnpm dev` | Vite dev server for the demo (`index.html`) |
| `pnpm build` | `tsc` check, `ngc` partial compilation of the Angular entry, Vite library build (ESM + CJS), declarations (`scripts/build-types.mjs`), Custom Elements Manifest and VS Code custom data (`pnpm cem`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` (happy-dom unit tests and type tests) |
| `pnpm smoke` | After `build`: imports every export in plain Node (ESM and CJS) and checks bundle invariants (no bundled `jsx-runtime`, `'use client'` banner, manifest) |
| `pnpm check:ng-aot` | After `build`: ngc-compiles a `strictTemplates` component against `rolling-number/angular` and links `dist/angular.js` (and `@angular/common`) with the Angular linker, then loads it without `@angular/compiler` |
| `pnpm lint:pkg` | `publint` and `attw --pack` (node16 profile) |
| `pnpm build:demo` | Builds the demo into `dist-demo/` |
| `pnpm preview` | Serves the built demo |

`prepublishOnly` runs `typecheck`, `build`, `test`, `smoke`, `check:ng-aot` and `lint:pkg` (`build` comes before `test` because a few tests read `dist/`). `check:ng-aot` compiles a `strictTemplates` component against the built Angular entry with ngc and links `dist/angular.js` with the Angular linker. Run at least `typecheck` and `test` before handing work back, and `build` + `smoke` + `check:ng-aot` + `lint:pkg` when you touch packaging, entries or types.

## Conventions

- **Style**: TypeScript strict, 2-space indent, single quotes, semicolons. JSDoc on every public symbol (it is published in the `.d.ts`, the manifest and the IDE data). Avoid `@word` inside JSDoc code samples: TypeScript parses it as a tag.
- **Defaults live in one place**: `RN_DEFAULTS` in `src/core.ts`. Adapters import it; never hard-code `0`, `1`, `null`, `true`, `400` elsewhere. `RN_DEFAULTS` and `normalizeOptions` are internal (not re-exported from the package root).
- **Normalization rules** (in `normalizeOptions` and the setters): `value` non-finite → 0, clamped to ±`MAX_SAFE_INTEGER`, displayed with symmetric rounding; `pad` non-finite or < 1 → 1, floored, max 64; `max` `null`/`''`/negative/non-finite → `null`, floored; `interpolate` `null`/`undefined` → true, the string `'false'` → false, otherwise `Boolean()`; `duration` negative → 0, non-finite → 400 (at creation) or unchanged (`setDuration`/`update`). In `core.update()`, `undefined` fields mean "unchanged", so adapters must pass the default (not `undefined`) when a prop is removed.
- **No `innerHTML`** anywhere in the library (Trusted Types). Create nodes with `createElement` and remove only nodes you created.
- **Realm-safe DOM**: never use `instanceof HTMLElement` or the global `document` in the core; check `nodeType === 1` and use `host.ownerDocument`.
- **SSR-safe imports**: no DOM access at module top level. Guard with `typeof window/document/HTMLElement !== 'undefined'`; the element extends an `HTMLElement` shim when it is missing. Adapters create the core only on the client (effects, `onMounted`, `isPlatformBrowser`).
- **Adapters must merge classes**: the host keeps `rn-rolling-number` whatever the framework does (React joins `className`, Vue declares the class on the vnode). Never put framework-managed children inside the host.
- **Angular**: inputs are getter/setter pairs that coerce strings; core work runs in `NgZone.runOutsideAngular`. The entry is compiled by `ngc` (`tsconfig.build.json`, partial mode) and bundled by a Vite plugin in `vite.config.ts`; TypeScript stays on `~5.5` for `@angular/compiler-cli` 18.
- **React**: no JSX in `src/react` (use `createElement`) so no `react/jsx-runtime` is bundled; the `'use client'` banner is added to the react entry only.
- **CSS**: the stylesheet is not injected by JS (planned for 1.3). New CSS needs fallbacks (`1lh` after `calc(var(--rn-lh, 1) * 1em)`, `overflow: clip` after `hidden`).
- **Types**: the JSX and Vue element typings live in type-only entries (`rolling-number/jsx`, `rolling-number/vue-element`) so non-React/Vue users never need those type packages. Update `custom-elements-manifest.config.mjs` and the JSDoc tags in `element.ts` (`@attr`, `@cssprop`) when the element's API changes.
- **Docs**: keep `README.md` accurate to the code and add an entry under `## [Unreleased]` in `CHANGELOG.md`, citing audit ids where relevant.
- **Git**: work on a branch, never commit directly to `main`.

## Roadmap

`docs/AUDIT.md` lists every known bug and improvement with ids, scenarios and fix sketches. Section 5 assigns them to releases: v1.2.x (non-breaking fixes, done in 1.2.2), v1.3 (additive features: continuous odometer, text mode for inputs, style injection, `Intl` formatting, events) and v2.0 (breaking: `.rn-root` subtree, no `role="img"` on the host, pure root entry). Do not pull v1.3/v2.0 items into a patch release.

## Agent skills

`skills-lock.json` pins the agent skills used on this project (a11y-debugging, accessibility, chrome-devtools, javascript-pro, memory-leak-audit, memory-leak-debugging, modern-web-guidance, web-component-design). They are installed into `.agents/` by the skills tooling that maintains the lock file. That folder is gitignored, so after cloning reinstall them with that tool; do not commit `.agents/`.
