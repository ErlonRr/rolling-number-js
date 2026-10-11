/**
 * Shared IntersectionObserver per Document (threshold 0.25) for
 * `trigger: 'visible'` (docs/design/v1.3.md §8.3, §3.3). Owned by WP4.
 * WP0 stub: final signature.
 *
 * @internal
 * @module
 */

/**
 * Observes `el`. `visible` is null until the first callback (null counts as
 * not visible). Without IntersectionObserver or a defaultView, `cb(true)` is
 * called synchronously and `visible` is true.
 */
export function observeVisibility(
  el: Element,
  cb: (visible: boolean) => void
): { stop(): void; readonly visible: boolean | null } {
  void el; void cb;
  throw new Error('[RollingNumber] visibility.observeVisibility: not implemented yet (WP4)');
}
