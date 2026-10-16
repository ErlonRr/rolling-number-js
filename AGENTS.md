# AGENTS.md

Guide for AI coding agents and human contributors working on **rolling-number** (npm package `rolling-number`, repo `rolling-number-js`).

## Purpose and constraints

An animated, odometer-style number counter: one framework-agnostic core plus thin bindings (Web Component, generic action, React, Vue 3, Angular).

- **Zero runtime dependencies.** Frameworks are optional `peerDependencies` (`react >=16.8`, `vue >=3`, `@angular/core` and `@angular/common` `>=16`) and are never bundled. Never add a runtime dependency.
- **Framework-agnostic core.** `src/core.ts` and the modules it uses must not import any framework. Adapters only translate framework lifecycles into `RollingNumberCore` calls.
- **Any host.** Container hosts (`span`, `div`, badges, …) get digit columns appended after their own children, which stay untouched. Text-like `<input>`, `<textarea>`, `<option>` and SVG `<text>`/`<tspan>`/`<textPath>` get text mode; other void/replaced elements only warn.
- **Non-breaking within 1.x.** Keep every public API, option name, default (`value 0`, `pad 1`, `max null`, `interpolate true`, `duration` auto = 400 ms counting), export path, the `<rolling-number>` tag, the CSS classes (`.rn-rolling-number`, `.rn-col`, `.rn-sizer`, `.rn-scale`, `.rn-cell`, `.rn-sign`, `.rn-interpolating`) and the CSS variables (`--rn-duration`, `--rn-easing`, `--rn-lh`). The 1.3 behavior changes are exactly S1–S6 of `docs/design/v1.3.md` §0. Additive changes only; breaking ideas go to the v2.0 list (`docs/AUDIT.md` §5, `docs/design/v1.3.md` §13).

## Architecture map

`docs/design/v1.3.md` is the normative spec (public API §2, module contracts §3.3 in `src/internal/contracts.ts`, DOM/CSS §4, animation math §5, text mode §6, formatting §7, core §8, styles §9).

```
src/
  types.ts                public types (options, format union, easings, events, settled, config); types only
  options.ts              OPTION_KEYS, LAYOUT_KEYS, OPTION_ATTRIBUTES, RN_DEFAULTS_13, resolveOptions, normalizeField, normalize*
  internal/contracts.ts   inter-module interfaces (Formatter, Renderer, Plan, FrameState, Tickable, …)
  core.ts                 RollingNumberCore orchestrator, getResolved; 1.2 shims RN_DEFAULTS / normalizeOptions
  engine/easing.ts        presets, cubic-bezier solver, CSS easing parser, hermite, peakSlope
  engine/odometer.ts      plan / sample / restState / retargetCurve (pure math, §5)
  engine/timing.ts        resolveTiming, parseCssTime (§5.8)
  engine/ticker.ts        shared per-window rAF ticker (read → write → flush → settled → post)
  format.ts               plain + Intl formatter, layouts, motionLayout, quantize, resolveLabel
  renderers/columns.ts    keyed columns DOM (begin / measure / frame / rest)
  renderers/text.ts       text mode writer, resolveMode
  a11y.ts                 shared live region per container
  visibility.ts           shared IntersectionObserver (trigger: 'visible')
  styles.ts               configureRollingNumber, ensureStyles, injectRollingNumberStyles
  ssr.ts                  renderStaticText / renderStaticHTML (DOM-free)
  css/defaults.css        :root { --rn-duration; --rn-easing } (dist/style.css only)
  css/rules.css           every rule; injected (?inline) and shipped
  rolling-number.css      @import defaults + rules → dist/style.css (unlayered)
  element.ts              <rolling-number> (light DOM), defineRollingNumber, HTMLElementTagNameMap
  action.ts               rollingNumber(node, param) action
  index.ts, register.ts, action-entry.ts, ssr-entry.ts, iife.ts   entries (iife: global RollingNumber)
  jsx.ts, vue-element.ts  type-only: <rolling-number> in React JSX / Vue templates
  react/ vue/ angular/    bindings (angular compiled by ngc, partial mode)
tests/                    vitest + happy-dom unit tests, *.test-d.ts type tests, engine/ property tests,
                          helpers/ (fake rAF ticker, IntersectionObserver), vue-types/ (vue-tsc fixture)
tests/visual/             Playwright specs on the built dist/ (see "Visual suite")
scripts/                  build-types, smoke (+ smoke-manifest), size gate, ng-aot-check, vscode-custom-data
docs/design/v1.3.md       the 1.3 spec; docs/AUDIT.md the audit of 1.2.1 (finding ids B.., I.., C..)
index.html, demo/         demo site: shell + hash-routed pages in demo/pages (vite.config.demo.ts)
```

## Data flow

Framework prop/attribute → adapter → `new RollingNumberCore(host, options)` on mount, then `core.update(changed)` or `setValue(v, animate)` on change, and `core.destroy()` on unmount. Option lists are never hard-coded: everything iterates `OPTION_KEYS` / `OPTION_ATTRIBUTES`. Absent props/attributes are passed as `null` (= default; for `duration`/`easing` = "unset", S5), never as `RN_DEFAULTS.x`. The element's property setters only reflect to attributes and `attributeChangedCallback` is the only path to the core (exception: function `easing`/`label`, kept in a private slot).

`setValue` (§8.2): normalize → quantize (`A1`) → label → join/finish/re-plan when the target is already in flight → `ensureStyles` → wait if `trigger: 'visible'` and not visible → instant path (microtask `rn-start`/`rn-end` with `animated: false`) or `renderer.begin()` + ticker + watchdog (`D + 1000 ms`, finishes motions whose frames never come). Promises resolve after `rn-end`.

## Rendering

- **Columns mode** (§4): the host gets `rn-rolling-number`, `role="img"`, `aria-label` (written only when it changes). The core owns one contiguous block: optional `.rn-static` prefix/literal tokens, `.rn-sign` (U+2212), one `.rn-col` per digit (`.rn-sizer` + `.rn-scale` with exactly 10 `.rn-cell`s and a `::after` wrap cell), separators, `.rn-static[data-rn-part=overflow]`. Every owned node has a `data-rn-key` (`i0` = units, `f1` = tenths, `sign`, `ovf`, …); reconciliation is keyed, so columns keep identity across length changes.
- At rest the digit is selected by `data-digit` (`translateY(-N*10%)`, the 1.2 rules). While moving the core writes an inline `transform` on `.rn-scale`, and `--rn-in`/`--rn-w` + `data-rn-in` on entering/leaving nodes (inserted collapsed, measured in the read phase). `rest()` removes every inline style and marker.
- **Text mode** (§6): the renderer writes `value` / `.text` / a text node per frame, only when the string changes; never `input`/`change` events, never into a focused control (guarded blur write).

## Animation model

- One JS engine for everything (§5): `interpolate: true` counts (windowed-carry columns + speed-limited reels), `interpolate: false` rolls each digit to its target (forward through the wrap cell). Every plan starts from the displayed state; count→count retargets keep velocity (Hermite curve). Count plans clamp progress to [0, 1]; roll plans allow overshoot.
- Timing (§5.8): per call → option → non-default `--rn-duration`/`--rn-easing` (read from the sizer's computed `animation-duration`/`animation-timing-function`) → 400 ms ease-out-cubic (count) / 0.5 s odometer (roll). The core never writes the CSS variables.
- Frame pipeline (§5.9): one rAF per window for all counters: read (timing probe, `measure()`), write (`sample` → `frame`, or `rest` when done), flush (one computed-style read if something settled), settled (remove `data-rn-state`/`.rn-interpolating`), post (`rn-start`/`rn-end`, promises, live announcements).
- Instant: `motion: 'none'`, `duration ≤ 0` in the call, `prefers-reduced-motion: reduce`, no rAF, a focused text control, or a roll with `--rn-duration: 0s` (detected in the read phase).

## Lifecycle invariants

One live core per host (module-level `WeakMap`; a new core destroys the previous one). `destroy()` cancels the ticker and watchdog, releases the observer and live region, removes only the core's nodes, restores role/label/class and the hidden SSR fallback, resolves pending promises `completed: false`, dispatches nothing and makes the instance inert. Safe to call twice. The element remembers that its `from` intro was consumed (no replay on DOM moves).

## Commands

Use **pnpm**.

| Command | What it does |
| :--- | :--- |
| `pnpm install` | Install dev dependencies |
| `pnpm dev` | Vite dev server for the demo site (`index.html` + `demo/`) |
| `pnpm build` | `tsc` check, `ngc` partial compilation of the Angular entry, Vite library build (ESM + CJS), the IIFE build, declarations, Custom Elements Manifest and VS Code data |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` (happy-dom unit tests, engine property tests, type tests) |
| `pnpm test:visual` | Playwright on Chromium, Firefox and WebKit against the built package (builds, then starts `pnpm preview`; see below) |
| `pnpm smoke` | After `build`: imports every entry in Node (ESM and CJS; `./iife` import-only) and checks bundle invariants and the manifest |
| `pnpm check:ng-aot` | After `build`: ngc `strictTemplates` compile against `rolling-number/angular` + Angular linker run |
| `pnpm check:vue-types` | `vue-tsc` on `tests/vue-types` (SFC template typing) |
| `pnpm lint:pkg` | `publint` and `attw --pack` (node16 profile) |
| `pnpm size` | Size gate per entry (esbuild, gzip); CI fails over budget |
| `pnpm build:demo` | Builds the demo into `dist-demo/` (needs `pnpm build` first: `rolling-number` is aliased to `dist/`) |
| `pnpm preview` | Serves the built demo, plus `/dist/` and `/fixtures/` for the visual suite |

`prepublishOnly` runs `typecheck`, `build`, `test`, `smoke`, `check:ng-aot`, `check:vue-types`, `lint:pkg` and `size` (`build` before `test`: a few tests read `dist/`). Run at least `typecheck` and `test` before handing work back; `build` + `smoke` + `check:ng-aot` + `lint:pkg` + `size` when you touch packaging, entries or types; `test:visual` when you touch rendering, CSS, timing or styles.

### Visual suite (`tests/visual`)

- Served by `pnpm preview` (`vite.config.demo.ts`): `/` is the built demo, `/dist/**` the built package, `/fixtures/**` the static pages of `tests/visual/fixtures` (unbundled; `csp*.html` get a `Content-Security-Policy` header). Fixtures import `/dist/*.js` directly, so specs always test the build. `RN_VISUAL_BASE_URL` reuses a running server; `RN_VISUAL_SERVER` overrides the command (CI builds first).
- `tests/visual/_harness.ts`: `openStage` (installs `page.clock`, waits for `html[data-ready]`, freezes time), `addCounter`/`setValue` on the stage page, `runMotion` (16 ms frames until `data-rn-state` is gone), `motionStats` (max step, backward movement), `presenceOf`, `leftovers`, `visibleDigits`, `recordEvents`, and `decodePng`/`diffImages`/`lineRows`/`inkPixels`.
- Screenshot policy: no stored baselines. Pixel assertions compare two screenshots taken in the same run (same engine and fonts), so they hold on any OS; chosen frames are only attached to the report. `page.clock` is per browser context (two pages share it) and fakes `performance.now()`.
- Known failures are `test.fixme` with the reason (currently: Firefox replays a pinned 1.2 `.rn-scale` transition after a motion, B17). WebKit needs the Playwright system libraries (`playwright install --with-deps`); CI has them.

## Conventions

- **Style**: TypeScript strict, 2-space indent, single quotes, semicolons. JSDoc on every public symbol (it ships in the `.d.ts`, the manifest and the IDE data). Avoid `@word` inside JSDoc code samples: TypeScript parses it as a tag.
- **Spec first**: interfaces in `src/types.ts` and `src/internal/contracts.ts` follow `docs/design/v1.3.md` verbatim; change the spec together with them.
- **Defaults and normalization live in `src/options.ts`** (`RN_DEFAULTS_13`, `resolveOptions`, `normalizeField`; §2.2 rules). Adapters never hard-code defaults or option lists. `RN_DEFAULTS` / `normalizeOptions` in `core.ts` are frozen 1.2 shims. In `update()`, `undefined` = unchanged and `null` = default.
- **No `innerHTML`** anywhere in the library (Trusted Types). Create nodes with `createElement` and remove only nodes you created.
- **CSP-safe styling**: write styles through CSSOM (`style.setProperty`), never `setAttribute('style', …)`; the stylesheet goes through `adoptedStyleSheets` (or the nonce'd `<style>` fallback).
- **Realm-safe DOM**: no `instanceof HTMLElement` or global `document` in the core; check `nodeType === 1` and use `host.ownerDocument` / its `defaultView`.
- **SSR-safe imports**: no DOM access at module top level; `rolling-number/ssr` and `/action` must import in Node without DOM globals. Adapters create the core only on the client (effects, `onMounted`, `isPlatformBrowser`).
- **One frame loop**: never add a private `requestAnimationFrame` or CSS transition for digits; schedule through `engine/ticker.ts` and keep reads in the read phase.
- **Adapters merge classes**: the host keeps `rn-rolling-number` whatever the framework does. Never put framework-managed children inside a columns host (except the `.rn-ssr` fallback).
- **Angular**: inputs are coerced getter/setter pairs; core work runs in `NgZone.runOutsideAngular`; outputs emit through the zone only when observed. Compiled by `ngc` (`tsconfig.build.json`, partial mode); TypeScript stays on `~5.5` for `@angular/compiler-cli` 18.
- **React**: no JSX in `src/react` (`createElement`), so no `react/jsx-runtime` is bundled; the `'use client'` banner is added to the react entry only.
- **CSS**: one source (`src/css/rules.css`) for the injected sheet and `dist/style.css`; no `:root` in it (defaults live in `var()` fallbacks). New CSS needs fallbacks (`1lh` after `calc(var(--rn-lh, 1) * 1em)`, `overflow: clip` after `hidden`). A stylesheet pinned at 1.2 must still render the rest state.
- **Types**: JSX and Vue element typings live in the type-only entries `rolling-number/jsx` and `rolling-number/vue-element`. When the element's API changes, update `custom-elements-manifest.config.mjs`, the `@attr`/`@fires`/`@cssprop` JSDoc in `element.ts` and `scripts/smoke-manifest.mjs`.
- **Docs**: keep `README.md` accurate to the code and add an entry under `## [Unreleased]` in `CHANGELOG.md`, citing audit ids where relevant.
- **Git**: work on a branch, never commit directly to `main`.

## Roadmap

`docs/AUDIT.md` lists every known bug and improvement with ids; `docs/design/v1.3.md` §12 (compatibility and risks) and §13 (deferred) cover 1.3. v2.0 (breaking): `.rn-root` owned subtree with an untouched host, no `role="img"` on the host, clean `textContent`, a pure root entry, removing the Angular `-input` heuristic, reconnect semantics, optional shadow DOM with `::part`. Do not pull v2.0 items into a 1.x release.

## Agent skills

`skills-lock.json` pins the agent skills used on this project (a11y-debugging, accessibility, chrome-devtools, javascript-pro, memory-leak-audit, memory-leak-debugging, modern-web-guidance, web-component-design). They are installed into `.agents/` by the skills tooling that maintains the lock file. That folder is gitignored, so after cloning reinstall them with that tool; do not commit `.agents/`.
