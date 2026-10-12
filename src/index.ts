/**
 * rolling-number: animated, odometer-style number counter.
 *
 * Entry points:
 * - `rolling-number`: {@link RollingNumberCore} (framework-agnostic engine),
 *   the `<rolling-number>` custom element ({@link RollingNumberElement},
 *   registered automatically on import in the browser),
 *   {@link defineRollingNumber}, the {@link rollingNumber} action, the SSR
 *   helpers and the global {@link configureRollingNumber}.
 * - `rolling-number/register`: registers `<rolling-number>` only.
 * - `rolling-number/action`: core + action, without side effects.
 * - `rolling-number/ssr`: DOM-free `renderStaticText` / `renderStaticHTML`.
 * - `rolling-number/iife`: script-tag build (global `RollingNumber`).
 * - `rolling-number/react`: `<RollingNumber>` component and `useRollingNumber` hook.
 * - `rolling-number/vue`: `<RollingNumber>` component and `v-rolling-number` directive.
 * - `rolling-number/angular`: standalone `[rollingNumber]` directive.
 * - `rolling-number/jsx`: type-only, types `<rolling-number>` in React JSX.
 * - `rolling-number/vue-element`: type-only, types `<rolling-number>` in Vue templates.
 * - `rolling-number/style.css`: the stylesheet (also injected automatically).
 *
 * Options everywhere: see {@link RollingNumberOptions}.
 *
 * @packageDocumentation
 */
export { RollingNumberCore } from './core';
export { RollingNumberElement, defineRollingNumber, type RollingNumberAttributes } from './element';
export { rollingNumber, type RollingNumberActionParam, type RollingNumberActionReturn } from './action';
export { configureRollingNumber, injectRollingNumberStyles } from './styles';
export { renderStaticText, renderStaticHTML } from './ssr';
export type {
  RollingNumberConfig,
  RollingNumberEasing,
  RollingNumberEasingName,
  RollingNumberEvent,
  RollingNumberEventDetail,
  RollingNumberEventMap,
  RollingNumberFormat,
  RollingNumberFormatBase,
  RollingNumberLabelInfo,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger,
  RollingNumberUnit,
  RollingNumberUpdate
} from './types';

import { defineRollingNumber } from './element';

// Auto-register when loaded via UMD / script tag
if (typeof window !== 'undefined' && 'customElements' in window) {
  defineRollingNumber();
}
