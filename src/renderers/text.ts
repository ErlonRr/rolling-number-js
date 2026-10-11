/**
 * Text-mode renderer for form controls, `<option>`, SVG text and
 * `mode: 'text'` (docs/design/v1.3.md §6, §3.3). Owned by WP4.
 * WP0 stub: final signatures.
 *
 * @internal
 * @module
 */
import type { Formatter, Renderer } from '../internal/contracts';
import type { RollingNumberMode } from '../types';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] renderers/text.${name}: not implemented yet (WP4)`);
}

/** Creates the text renderer for `host`. */
export function createTextRenderer(host: Element, doc: Document, fmt: Formatter): Renderer {
  void host; void doc; void fmt;
  return notImplemented('createTextRenderer');
}

/** Resolves `mode` for `host` (§6 table). */
export function resolveMode(host: Element, mode: RollingNumberMode): 'columns' | 'text' | 'unsupported' {
  void host; void mode;
  return notImplemented('resolveMode');
}
