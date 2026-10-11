/**
 * Automatic stylesheet injection (`adoptedStyleSheets` per Document /
 * ShadowRoot in `@layer rolling-number`) and the global configuration
 * (docs/design/v1.3.md §9). Owned by WP5. WP0 stub: the configuration slot
 * works; injection is a no-op until WP5.
 *
 * @module
 */
import type { RollingNumberConfig } from './types';

/** Global slot shared by the ESM and CJS copies of the package. */
const CONFIG_KEY = Symbol.for('rolling-number.config');

/** The live global configuration (created on first access). @internal */
export function getConfig(): Required<RollingNumberConfig> {
  const g = globalThis as unknown as Record<symbol, Required<RollingNumberConfig> | undefined>;
  let config = g[CONFIG_KEY];
  if (!config) {
    config = { injectStyles: true, nonce: null };
    g[CONFIG_KEY] = config;
  }
  return config;
}

/**
 * Global configuration of rolling-number. Call it before the first counter is
 * created; later calls apply to roots injected afterwards.
 *
 * @param config `injectStyles: false` turns automatic style injection off
 *   everywhere (import `rolling-number/style.css` yourself); `nonce` is used
 *   by the `<style>` fallback under a strict CSP.
 *
 * @example
 * ```ts
 * import { configureRollingNumber } from 'rolling-number';
 * configureRollingNumber({ injectStyles: false });
 * ```
 */
export function configureRollingNumber(config: RollingNumberConfig): void {
  const current = getConfig();
  if (!config || typeof config !== 'object') return;
  if (config.injectStyles !== undefined) current.injectStyles = config.injectStyles !== false;
  if (config.nonce !== undefined) current.nonce = config.nonce ?? null;
}

/**
 * Injects the stylesheet into `root` (for `injectStyles: false` setups, or to
 * pre-warm a shadow root). Idempotent.
 *
 * @param root A Document or a ShadowRoot.
 */
export function injectRollingNumberStyles(root: Document | ShadowRoot): void {
  void root;
}

/**
 * Makes sure the stylesheet is present in `host`'s root (O(1) when it already
 * is). No-op when injection is off globally or for this instance.
 * @internal
 */
export function ensureStyles(host: Element, perInstance: boolean): void {
  void host;
  void perInstance;
}
