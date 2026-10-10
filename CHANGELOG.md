# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Ids such as `B15` or `I05` refer to the findings in [`docs/AUDIT.md`](./docs/AUDIT.md).

## [Unreleased] — 1.2.2

Patch release: bug fixes only. Every public API, option name, default, export path, the `<rolling-number>` tag, the CSS class names and the `--rn-duration`/`--rn-easing` variables are unchanged.

### Fixed

**Packaging**
- `rolling-number/angular` failed to load ("Standard Angular field decorators are not supported in JIT mode") and had no Ivy metadata for AOT. It is now built with `ngc` in partial compilation mode (`ɵɵngDeclareDirective`), so the Angular linker processes it in apps on Angular 16 and later (B01).
- `rolling-number/react` bundled React 18's `react/jsx-runtime` (21.7 KB), which crashed on React 19 / Next 15 and needed `process` without a bundler. All `react`, `react-dom`, `vue` and `@angular/*` subpaths are now external, and the component uses `createElement` (B02).
- `rolling-number/react` now starts with `'use client'`, so it can be used from Next.js Server Components (B35).
- Type declarations now resolve under `moduleResolution` `node16`/`nodenext` (ESM and CJS, with `.d.cts` files for `require`) and under the legacy `node` resolution through `typesVersions` (B21).
- The published tarball only contains `dist/` (`files: ["dist"]`). The README images were about 90% of the package (I14).

**Core**
- Invalid options are normalized instead of producing `NaN` columns, exponent digits or exceptions. `NaN`, `''` and non-numeric strings become `0`, `max` must be a non-negative integer or `null`, `pad` is limited to 1–64, values are clamped to `Number.MAX_SAFE_INTEGER`, negative values round symmetrically (`-1.5` → `-2`), and a non-finite `duration` becomes `400` while a negative one still disables interpolation (`0`) (B15, B30, C5).
- The first animation frame could have a negative elapsed time and flash a minus sign. The start time now comes from the first `requestAnimationFrame` timestamp and progress is clamped to [0, 1] (B32).
- On the last frame, the final digits are rendered and styles are flushed before CSS transitions are re-enabled, so the columns no longer roll backwards at the end of an animation (B17).
- `destroy()` no longer uses `innerHTML`. It removes only the nodes the core created and restores the host's previous `role`, `aria-label` and class, so existing content survives and Trusted Types CSPs no longer throw (B12, C4).
- A second core on the same host destroys the first instead of duplicating the digits (`42` → `4242`) (B37).
- The host check is realm-safe and nodes are created in the host's own document, so elements from iframes and other windows work (B36).
- `prefers-reduced-motion: reduce` is respected. Value changes are applied immediately and CSS transitions are disabled (B29).
- A one-time console warning is printed for hosts that cannot show children (`<input>`, `<textarea>`, `<select>`, `<img>`, `<svg>`, …) (B05).
- Fewer DOM writes per frame. Column references are cached, `aria-label` is written only when it changes, and unchanged renders return early (I05).

**CSS**
- Digits stay in order inside `dir="rtl"` content (`direction: ltr; unicode-bidi: isolate`) (B08).
- Find-in-page and `scrollIntoView` can no longer scroll a digit column and show the wrong digit (`overflow: clip`) (B40).
- A `line-height` set on the counter no longer shows parts of two digits. The window height and the line-height now come from the same value (`--rn-lh`, `1lh`) (B20). In browsers without the `lh` unit the window follows `--rn-lh` only, as before.
- `will-change: transform` is applied only while animating (I06).

**Web Component**
- Importing `rolling-number` or `rolling-number/register` in Node or during SSR no longer throws `HTMLElement is not defined` (B03).
- Properties set before the element was defined are applied on upgrade instead of shadowing the accessors (B10).
- Property setters no longer throw on `null`/`undefined`, which now restore the default. Setters only reflect to the attribute, so `setValue` runs once per change instead of twice (B16).
- `defineRollingNumber('my-counter')` no longer throws `NotSupportedError` after the automatic registration. Each extra tag gets its own subclass (B27).

**React**
- `<RollingNumber>` forwards its `ref` to the `<span>` (B25). A React 19 callback ref that returns a cleanup function gets its cleanup called on detach, as on a plain `<span>`.
- `className` is merged with `rn-rolling-number` instead of replacing it (B07).
- `children` and `dangerouslySetInnerHTML` are rejected by the types and ignored at runtime, so they can no longer wipe the digits (B13).
- `useRollingNumber` attaches to elements that mount late or are replaced, and only calls `update()` when an option changes. It uses `useLayoutEffect` in the browser and `useEffect` on the server (B26, B35).

**Vue**
- The `v-rolling-number` binding type includes `interpolate` and `duration`. Parent re-renders that do not change the binding no longer re-render the counter (B31, I05).
- The `<RollingNumber>` component declares `rn-rolling-number` on its vnode, so a dynamic `:class` no longer removes it. It forwards only the props that changed (B07, I05).
- `v-rolling-number` puts `rn-rolling-number` (and the animating markers) back when a re-render changes only the host's `:class` (B07).
- The directive provides `getSSRProps`, for server rendering.

**Angular**
- The core is created only in the browser (`isPlatformBrowser`), so SSR no longer fails with `document is not defined` (B04).
- The core, setters and animation frames run outside `NgZone`, so an animation no longer triggers app-wide change detection on every frame (B24).
- The wrapper span for `*-input` hosts is created with the host's `ownerDocument` and removed on destroy (B36, B23 partial).
- String inputs are coerced: `pad="3"`, `duration="600"`, `interpolate="false"` (also `"0"`/`"off"`), a bare `interpolate` attribute means `true`, and `null`/`undefined` or non-numeric strings mean the default (the input getters never return `NaN`). This works on Angular 16.0 without `booleanAttribute` (B38).

**Documentation**
- README: removed claims that were false or misleading. Interpolation uses a rAF loop, so "no blocking JS loops" and the `99+` description of `max` were dropped, and the CSS variables only affect the `interpolate: false` roll. The PrimeNG and PrimeVue examples no longer place the counter on input components, and the Angular examples load the stylesheet globally. Added a Svelte recipe and sections on the required stylesheet, input normalization, the core API, accessibility, SSR, browser support and known limitations (I15).

### Added
- `RollingNumberCore#getElement()` and `RollingNumberCore#isAnimating()`.
- `data-rn-state="animating"` attribute on the host while an interpolation runs, a styling hook that frameworks do not clobber. The `rn-interpolating` class is still set (B07).
- `--rn-lh` CSS variable (default `1`): the digit window height in em, which is also the counter's line-height (B20).
- Internal shared defaults and normalization (`RN_DEFAULTS`, `normalizeOptions` in `src/core.ts`), used by the core and every adapter.
- Vue: the component's `interpolate` prop accepts the string `"false"`. New types `RollingNumberBinding` and `RollingNumberProps`.
- Typing: `HTMLElementTagNameMap['rolling-number']` (I22), `RollingNumberAttributes`, `RollingNumberJSXProps`, and two type-only entries: `rolling-number/jsx` (types `<rolling-number>` in React JSX, also loaded by `rolling-number/react`) and `rolling-number/vue-element` (types it in Vue templates).
- JSDoc on every public symbol, a Custom Elements Manifest (`dist/custom-elements.json`, `"customElements"` field) and VS Code custom data (`dist/vscode.html-custom-data.json`, `dist/vscode.css-custom-data.json`).
- `./package.json` and the JSON files in the `exports` map.
- Scripts: `typecheck`, `test` (vitest + happy-dom), `smoke` (imports every entry in plain Node, ESM and CJS), `check:ng-aot` (ngc `strictTemplates` compile against the package and Angular linker run on `dist/angular.js`), `lint:pkg` (publint + attw) and `prepublishOnly`, which builds before testing (I13, B01).
- `CHANGELOG.md` and `AGENTS.md`.

### Changed
- `@angular/common` (`>=16.0.0`) is a new optional peer dependency of `rolling-number/angular`. It is used for `isPlatformBrowser` and is already present in every Angular app.
- `destroy()` restores the host instead of emptying it. Content that was in the host before the counter stays in place.
- The minus sign is inserted right before the first digit column instead of at the very start of the host. Hosts with no other content render exactly as before.
- After `destroy()` an instance never touches the DOM again: `render()` and `setValue()` do nothing.
- Creating a core on a host that already has one destroys the previous core.
- Root `line-height` is `var(--rn-lh, 1)`; sign, sizer and cells use `var(--rn-lh, 1)` too, and inherit the root's line-height in browsers that support the `lh` unit.
- `update({ interpolate: null })` and `setInterpolate(null)` fall back to the default (`true`) like the constructor, instead of `false`.
- The npm package no longer contains `assets/` (banner and GIF); the README loads them from GitHub.
- Build: the Angular entry is compiled with `ngc` (`@angular/compiler-cli` 18), TypeScript is pinned to `~5.5.4`, and the React source moved from `RollingNumber.tsx` to `RollingNumber.ts`.

## [1.2.1] — 2026-08-08

### Changed
- README: updated wording, features list and documentation of the `interpolate` and `duration` options.
- Demo: new theme and palette, updated banner and GIF.

## [1.2.0] — 2026-08-08

### Added
- Progressive value interpolation with `requestAnimationFrame` and `easeOutCubic`: new `interpolate` (default `true`) and `duration` (default `400` ms) options in the core, the Web Component and every adapter, plus `setInterpolate()`/`setDuration()`.
- Demo: language switcher and a Vercel deployment config.

## [1.1.1] — 2026-08-08

### Fixed
- README images use raw GitHub URLs so they render on npm. Added `repository`, `homepage` and `bugs` metadata.

### Added
- README integration examples for PrimeNG 19, Angular Material, NG-ZORRO, Shadcn UI, MUI, Ant Design, Vuetify, Element Plus and PrimeVue.
- Demo favicon.

## [1.1.0] — 2026-08-07

### Added
- Framework subpaths: `rolling-number/angular` (standalone `[rollingNumber]` directive), `rolling-number/react` (`<RollingNumber>` and `useRollingNumber`) and `rolling-number/vue` (`<RollingNumber>` and `v-rolling-number`).

## [1.0.0] — 2026-08-07

### Added
- Initial release: `RollingNumberCore` engine, `<rolling-number>` Web Component, `style.css` and the demo page.
- pnpm setup, MIT license and README.

[Unreleased]: https://github.com/ErlonRr/rolling-number-js/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/ErlonRr/rolling-number-js/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/ErlonRr/rolling-number-js/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/ErlonRr/rolling-number-js/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ErlonRr/rolling-number-js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ErlonRr/rolling-number-js/releases/tag/v1.0.0
