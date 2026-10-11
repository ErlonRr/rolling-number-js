/**
 * DOM-free SSR helpers: the formatted value as text or as escaped HTML for
 * template engines (docs/design/v1.3.md §2.6, §7). Owned by WP2.
 * WP0 stub: final signatures.
 *
 * @module
 */
import type { RollingNumberOptions } from './types';

/**
 * Formatted `value` (with affixes; `from` is ignored), e.g. `"1,234 pts"`.
 * Pass an explicit `locale` for deterministic output.
 *
 * @param options Counter options.
 * @returns The text a counter shows at rest.
 */
export function renderStaticText(options?: RollingNumberOptions): string {
  void options;
  throw new Error('[RollingNumber] renderStaticText: not implemented yet (WP2)');
}

/**
 * Escaped HTML for template engines. Default:
 * `<span class="rn-ssr" data-rn-ssr>…</span>` (to place inside a host).
 * With `{ tag: 'rolling-number' }`: a `<rolling-number>` element with the
 * option attributes and the fallback child. With any other tag (e.g.
 * `'span'`): `<span class="rn-rolling-number" role="img" aria-label="…"
 * data-rn-ssr>…fallback child…</span>`, which the core adopts on the client.
 * `attrs` are added, escaped.
 *
 * @param options Counter options.
 * @param init Host tag and extra attributes.
 * @returns An HTML string.
 */
export function renderStaticHTML(
  options?: RollingNumberOptions,
  init?: { tag?: string; attrs?: Record<string, string> }
): string {
  void options;
  void init;
  throw new Error('[RollingNumber] renderStaticHTML: not implemented yet (WP2)');
}
