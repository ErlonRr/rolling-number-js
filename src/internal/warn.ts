/**
 * The console warning helper shared by every module: one `console` guard and
 * one `[RollingNumber]` prefix instead of one per call site. DOM-free.
 *
 * @internal
 * @module
 */

/** `console.warn('[RollingNumber] ' + message, ...details)` when a console is available. */
export function warn(message: string, ...details: unknown[]): void {
  if (typeof console != 'undefined' && typeof console.warn == 'function') console.warn('[RollingNumber] ' + message, ...details);
}
