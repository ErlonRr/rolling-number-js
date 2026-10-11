/**
 * Script-tag build (`dist/rolling-number.iife.js`, global `RollingNumber`).
 * Owned by WP5 (docs/design/v1.3.md §9, §10). Reads its `<script>` tag's
 * `nonce` and `data-rn-inject="false"`, then registers `<rolling-number>`.
 * Everything is guarded by `typeof document`, so importing it in Node does
 * not throw.
 *
 * @example
 * ```html
 * <script src="https://unpkg.com/rolling-number"></script>
 * <rolling-number value="42"></rolling-number>
 * ```
 *
 * @packageDocumentation
 */
import { defineRollingNumber } from './element';
import { configureRollingNumber } from './styles';

export { RollingNumberCore } from './core';
export { RollingNumberElement, defineRollingNumber } from './element';
export { rollingNumber } from './action';
export { configureRollingNumber, injectRollingNumberStyles } from './styles';
export { renderStaticText, renderStaticHTML } from './ssr';

if (typeof document !== 'undefined') {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script) {
    const nonce = script.nonce || script.getAttribute('nonce');
    if (nonce) configureRollingNumber({ nonce });
    if (script.getAttribute('data-rn-inject') === 'false') configureRollingNumber({ injectStyles: false });
  }
  defineRollingNumber();
}
