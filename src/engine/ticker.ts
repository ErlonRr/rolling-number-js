/**
 * Shared per-window requestAnimationFrame loop with read → write → flush →
 * settled → post phases (docs/design/v1.3.md §5.9, §3.3). Owned by WP1.
 * WP0 stub: final signatures.
 *
 * @internal
 * @module
 */
import type { Tickable } from '../internal/contracts';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] engine/ticker.${name}: not implemented yet (WP1)`);
}

/** Schedules `t` on the window's loop (no-op when already scheduled). */
export function schedule(view: Window, t: Tickable): void {
  void view; void t;
  notImplemented('schedule');
}

/** Removes `t`; cancels the pending frame when it was the last one. */
export function cancel(view: Window, t: Tickable): void {
  void view; void t;
  notImplemented('cancel');
}
