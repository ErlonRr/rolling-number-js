// api.js — Reference: entries, options, methods, events, CSS custom properties and global functions.
// Tables turn into cards on phones (see .ref-table in styles.css).

import { h, jumpNav, pageHeader, refTable, rich, section } from '../ui.js';

const ENTRIES = [
  ['`rolling-number`', '`RollingNumberCore`, the `rollingNumber()` action, the SSR helpers and the `<rolling-number>` element (registered on import in the browser).'],
  ['`rolling-number/action`', '`RollingNumberCore` and `rollingNumber()` without registering the element: no side effects.'],
  ['`rolling-number/register`', 'Registers `<rolling-number>` only.'],
  ['`rolling-number/react`', '`<RollingNumber />` and `useRollingNumber()` (React 16.8+, `\'use client\'`).'],
  ['`rolling-number/vue`', '`<RollingNumber />` and `v-rolling-number` (Vue 3).'],
  ['`rolling-number/angular`', 'The standalone `[rollingNumber]` directive (Angular 16+).'],
  ['`rolling-number/ssr`', '`renderStaticText()` and `renderStaticHTML()`, DOM-free.'],
  ['`rolling-number/iife`', 'One `<script>` build with a global `RollingNumber` (also on unpkg and jsDelivr).'],
  ['`rolling-number/style.css`', 'The stylesheet, if you prefer to load it yourself.'],
];

const OPTIONS = [
  ['`value`', '`value`', '`0`', 'The number to show, rounded to the displayed precision.'],
  ['`pad`', '`pad`', '`1`', 'Minimum integer digits, padded with zeros (`pad: 3` → `007`). 1–64.'],
  ['`max`', '`max`', '`null`', 'Display limit, e.g. `99` for a badge. The real value stays in the accessible label.'],
  ['`overflowSuffix`', '`overflow-suffix`', "`''`", "Shown after the digits when the value is above `max`: `'+'` → `99+`."],
  ['`interpolate`', '`interpolate` / `no-interpolate`', '`true`', '`true` counts through the values; `false` rolls each digit straight to its new digit.'],
  ['`duration`', '`duration`', 'auto', 'Animation length in ms. Unset: 400 ms when counting, `--rn-duration` (0.5 s) when rolling. `0` = no counting.'],
  ['`easing`', '`easing`', 'auto', "A preset (`'odometer'`, `'ease-out-cubic'`, `'ease-out-expo'`, `'linear'`, …), a CSS easing (`cubic-bezier(…)`, `linear(…)`, `steps(…)`) or a function."],
  ['`decimals`', '`decimals`', 'auto', "Fixed fraction digits (0–20). Auto: the currency's digits, else 0."],
  ['`locale`', '`locale`', '—', "BCP 47 locale, e.g. `'de-DE'`. Turns on locale formatting."],
  ['`format`', '`format` (JSON)', '—', 'Intl options: currency, percent, unit, sign, grouping, numbering system.'],
  ['`prefixText`', '`prefix-text`', "`''`", 'Static text before the number.'],
  ['`suffixText`', '`suffix-text`', "`''`", 'Static text after the number.'],
  ['`mode`', '`mode`', "`'auto'`", "`'columns'` (digit columns) or `'text'` (rewrites the text). Auto picks text for form fields and SVG text."],
  ['`from`', '`from`', '—', 'Value shown at creation; the counter then animates to `value` (an intro).'],
  ['`trigger`', '`trigger`', "`'immediate'`", "`'visible'`: animations wait until the counter is on screen."],
  ['`label`', '`label`', 'the value', "Accessible name: a string where `{value}` is replaced (`'{value} unread messages'`) or a function."],
  ['`live`', '`live`', "`'off'`", "`'polite'` / `'assertive'`: announce each settled value to screen readers."],
  ['`injectStyles`', '`inject-styles`', '`true`', '`false` turns off the automatic stylesheet for this counter.'],
];

const METHODS = [
  ['`setValue(value, animate?)`', 'Sets the target; returns `Promise<{ value, completed }>`. `animate`: `true` (count), `false` (roll) or `{ motion, duration, easing }`.'],
  ['`update(options)`', 'Changes several options (`undefined` = unchanged, `null` = back to the default).'],
  ['`whenSettled()`', 'Promise for the current animation (resolved at once when idle).'],
  ['`finish()`', 'Jumps to the target now.'],
  ['`getValue()` / `getDisplayValue()`', 'The target / the value on screen.'],
  ['`getText()`', 'The formatted target text, e.g. `"99+"` or `"1.234,50 €"`.'],
  ['`getMode()`', "`'columns'` or `'text'`."],
  ['`isAnimating()`', '`true` while the display moves.'],
  ['`destroy()`', 'Removes only the nodes the counter created and restores the host. Safe to call twice.'],
];

const EVENTS = [
  ['`rn-start`', 'The display starts moving (also for instant changes, with `animated: false`). `detail = { value, from, animated }`.'],
  ['`rn-end`', 'The display settled on the final value; the DOM is final.'],
];

const CSS_PROPERTIES = [
  ['`--rn-duration`', '`0.5s`', 'Duration of rolls. A non-default value also times counting (when `duration` is unset).'],
  ['`--rn-easing`', '`cubic-bezier(0.2, 1, 0.3, 1)`', 'Easing of rolls; a non-default value also eases counting.'],
  ['`--rn-lh`', '`1`', 'Height of the digit window (and line height). Raise it if tall glyphs are clipped.'],
  ['`--rn-fill`', '—', 'Background image painted into the glyphs (pair it with `color: transparent`).'],
  ['`--rn-bleed`', '`0px`', 'Lets glows and overhangs show outside the digit window (pair it with a taller `--rn-lh`).'],
  ['`--rn-decoration`', '—', 'Underline or strike-through that stays still while the digits roll.'],
];

const CSS_HOOKS = [
  ['`.rn-rolling-number`', 'The host.'],
  ['`[data-rn-state="animating"]`', 'On the host while it moves.'],
  ['`.rn-col`', 'One per digit, with `data-digit`.'],
  ['`.rn-sign`', 'The minus sign.'],
  ['`.rn-static[data-rn-part]`', 'Static parts: `currency`, `group`, `decimal`, `prefix`, `suffix`, `overflow`, …'],
];

const FUNCTIONS = [
  ['`rollingNumber(node, param)`', 'The action for Svelte, Solid, Alpine and Lit: returns `{ update, destroy, core }`.'],
  ['`configureRollingNumber({ injectStyles, nonce })`', 'Global configuration; call it before the first counter.'],
  ['`injectRollingNumberStyles(root)`', 'Adds the stylesheet to a document or shadow root yourself.'],
  ['`renderStaticText(options)` / `renderStaticHTML(options, { tag, attrs })`', 'Server-side rendering helpers (also in `rolling-number/ssr`).'],
  ['`defineRollingNumber(tagName?)`', 'Registers the element (done by `import \'rolling-number\'`), optionally under another tag.'],
];

export function mount(view) {
  view.append(
    h(
      'div',
      { class: 'container' },
      pageHeader({
        eyebrow: 'Reference',
        title: 'API',
        lead: 'Every option is optional and works the same way in every integration; invalid input never throws, it falls back to the default. The full guide is in the [README](https://github.com/ErlonRr/rolling-number-js#readme).',
      }),
      jumpNav([
        ['api-options', 'Options'],
        ['api-methods', 'Methods'],
        ['api-events', 'Events'],
        ['api-css', 'CSS'],
        ['api-functions', 'Functions'],
        ['api-entries', 'Entries'],
      ]),
      section(
        { id: 'api-options', title: 'Options', intro: 'Attributes on `<rolling-number>`, props in React and Vue. Angular inputs: `rollingNumber` (the value), `pad`, `max`, `interpolate`, `duration`, and `rn` + the option name for the others (`rnFormat`, `rnLocale`, …).' },
        refTable('Options', ['Option', 'Attribute', 'Default', 'What it does'], OPTIONS),
      ),
      section(
        { id: 'api-methods', title: 'Methods', intro: '`new RollingNumberCore(element, options)`. The element, the action and every binding wrap this class; the element and the Vue and Angular bindings expose `setValue`, `whenSettled`, `finish` and `getDisplayValue` too.' },
        refTable('Methods', ['Method', 'Description'], METHODS),
      ),
      section(
        { id: 'api-events', title: 'Events', intro: 'Dispatched on the host; they bubble and cross shadow roots. React: `onRnStart` / `onRnEnd`. Vue: `@rn-start` / `@rn-end`. Angular: `(rnStart)` / `(rnEnd)`.' },
        refTable('Events', ['Event', 'When'], EVENTS),
      ),
      section(
        { id: 'api-css', title: 'CSS', intro: 'The counter inherits font, size and color. Set these on the counter or any ancestor.' },
        refTable('CSS custom properties', ['Property', 'Default', 'Effect'], CSS_PROPERTIES),
        h('div', { style: { 'margin-top': '16px' } }, refTable('CSS hooks', ['Selector', 'Matches'], CSS_HOOKS)),
      ),
      section({ id: 'api-functions', title: 'Functions' }, refTable('Functions', ['Function', 'Description'], FUNCTIONS)),
      section(
        { id: 'api-entries', title: 'Entries', intro: 'Import only what you use; every entry is typed (ESM and CJS).' },
        refTable('Package entries', ['Entry', 'What you get'], ENTRIES),
      ),
      h('p', { class: 'muted', style: { 'margin-top': '32px' } }, rich('Browser support: Chrome 87+, Edge 88+, Firefox 78+, Safari 14+. Reduced motion makes every change instant.')),
    ),
  );
}
