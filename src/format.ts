/**
 * Number formatting (plain 1.x path and Intl), layouts, motion layouts and the
 * label (docs/design/v1.3.md §7, §3.3). Owned by WP2. WP0 stub: final signatures.
 *
 * @internal
 * @module
 */
import type { Formatter, NormalizedOptions } from './internal/contracts';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] format.${name}: not implemented yet (WP2)`);
}

/** Formatter for the normalized options (cached by key). */
export function createFormatter(o: NormalizedOptions): Formatter {
  void o;
  return notImplemented('createFormatter');
}

/** Accessible label of `value` (§7.4): default text, `{value}` template or function. */
export function resolveLabel(o: NormalizedOptions, f: Formatter, value: number, overflow: boolean): string {
  void o; void f; void value; void overflow;
  return notImplemented('resolveLabel');
}
