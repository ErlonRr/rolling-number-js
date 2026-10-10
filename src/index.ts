/**
 * rolling-number: animated, odometer-style number counter.
 *
 * Entry points:
 * - `rolling-number`: {@link RollingNumberCore} (framework-agnostic engine),
 *   the `<rolling-number>` custom element ({@link RollingNumberElement},
 *   registered automatically on import in the browser) and
 *   {@link defineRollingNumber}.
 * - `rolling-number/register`: registers `<rolling-number>` only.
 * - `rolling-number/react`: `<RollingNumber>` component and `useRollingNumber` hook.
 * - `rolling-number/vue`: `<RollingNumber>` component and `v-rolling-number` directive.
 * - `rolling-number/angular`: standalone `[rollingNumber]` directive.
 * - `rolling-number/jsx`: type-only, types `<rolling-number>` in React JSX.
 * - `rolling-number/vue-element`: type-only, types `<rolling-number>` in Vue templates.
 * - `rolling-number/style.css`: required stylesheet (import once).
 *
 * Options everywhere: `value` (0), `pad` (1), `max` (null), `interpolate`
 * (true), `duration` (400 ms); see {@link RollingNumberOptions}.
 *
 * @packageDocumentation
 */
export { RollingNumberCore, type RollingNumberOptions } from './core';
export { RollingNumberElement, defineRollingNumber, type RollingNumberAttributes } from './element';

import { defineRollingNumber } from './element';

// Auto-register when loaded via UMD / script tag
if (typeof window !== 'undefined' && 'customElements' in window) {
  defineRollingNumber();
}
