/**
 * Keyed digit-columns renderer (docs/design/v1.3.md §4, §3.3). Owned by WP3.
 * WP0 stub: final signature.
 *
 * @internal
 * @module
 */
import type { Formatter, Renderer } from '../internal/contracts';

/** Creates the columns renderer for `host`. */
export function createColumnsRenderer(host: Element, doc: Document, fmt: Formatter): Renderer {
  void host; void doc; void fmt;
  throw new Error('[RollingNumber] renderers/columns.createColumnsRenderer: not implemented yet (WP3)');
}
