/**
 * Script-tag build (`dist/rolling-number.iife.js`, global `RollingNumber`;
 * docs/design/v1.3.md §2.8, §9, §10). Owned by WP5.
 *
 * The global exposes exactly: `RollingNumberCore`, `RollingNumberElement`,
 * `defineRollingNumber`, `rollingNumber`, `configureRollingNumber`,
 * `injectRollingNumberStyles`, `renderStaticText`, `renderStaticHTML`.
 *
 * On load it reads its own `<script>` tag: `nonce` (CSP nonce for the
 * `<style>` fallback) and `data-rn-inject="false"` (no automatic style
 * injection), then registers `<rolling-number>`. The stylesheet is embedded
 * and injected at runtime, so no CSS link is needed. Everything is guarded by
 * `typeof document`, so importing the file in Node does not throw.
 *
 * @example
 * ```html
 * <script src="https://unpkg.com/rolling-number" nonce="r4nd0m"></script>
 * <rolling-number value="42"></rolling-number>
 * ```
 *
 * @packageDocumentation
 */
import { defineRollingNumber } from './element';
import { configureRollingNumber } from './styles';
import type { RollingNumberConfig } from './types';

export { RollingNumberCore } from './core';
export { RollingNumberElement, defineRollingNumber } from './element';
export { rollingNumber } from './action';
export { configureRollingNumber, injectRollingNumberStyles } from './styles';
export { renderStaticText, renderStaticHTML } from './ssr';

/** Configuration written on the loading `<script>` tag (null when there is none, e.g. a module or a bundler). */
function scriptConfig(doc: Document): RollingNumberConfig | null {
  const script = doc.currentScript as HTMLScriptElement | null;
  if (!script || typeof script.getAttribute !== 'function') return null;
  const config: RollingNumberConfig = {};
  // Browsers hide the nonce attribute after insertion; the property keeps it.
  const nonce = script.nonce || script.getAttribute('nonce');
  if (nonce) config.nonce = nonce;
  if (script.getAttribute('data-rn-inject') === 'false') config.injectStyles = false;
  return config;
}

if (typeof document !== 'undefined') {
  const config = scriptConfig(document);
  if (config) configureRollingNumber(config);
  defineRollingNumber();
}
