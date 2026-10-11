/**
 * Shared live-region announcer: one ref-counted region per container (each
 * `dialog` / `[aria-modal="true"]`, plus `body`), per-host 300 ms debounce
 * (docs/design/v1.3.md §8.3, §3.3). Owned by WP4. WP0 stub: final signatures.
 *
 * @internal
 * @module
 */

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] a11y.${name}: not implemented yet (WP4)`);
}

/** Retains the region of `host`'s container; returns the release function. */
export function retainAnnouncer(host: Element): () => void {
  void host;
  return notImplemented('retainAnnouncer');
}

/** Announces `text` for `host` (debounced 300 ms per host; the last text wins). */
export function announce(host: Element, text: string, politeness: 'polite' | 'assertive'): void {
  void host; void text; void politeness;
  notImplemented('announce');
}
