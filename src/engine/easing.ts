/**
 * Easing presets, the cubic-bezier solver, the CSS easing parser and the
 * cubic Hermite retarget curve (docs/design/v1.3.md §5.6, §3.3).
 * Owned by WP1. WP0 stub: final signatures, no implementation yet.
 *
 * @internal
 * @module
 */
import type { RollingNumberEasing, RollingNumberEasingName } from '../types';
import type { Easing, EasingFn } from '../internal/contracts';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] engine/easing.${name}: not implemented yet (WP1)`);
}

/** Named easings (`odometer` = cubic-bezier(0.2, 1, 0.3, 1)). */
export const PRESETS = {} as Record<RollingNumberEasingName, EasingFn>;

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  void x1; void y1; void x2; void y2;
  return notImplemented('cubicBezier');
}

/** Parses keywords, presets, `cubic-bezier()`, `linear()` and `steps()`; `null` when invalid. */
export function parseEasing(s: string): EasingFn | null {
  void s;
  return notImplemented('parseEasing');
}

/** Resolves a public easing (preset, CSS string or function) to an {@link Easing}; `null` when invalid. */
export function toEasing(e: RollingNumberEasing): Easing | null {
  void e;
  return notImplemented('toEasing');
}

/** Cubic Hermite progress with start slope `s` (§5.6): `H(p) = s(p³ − 2p² + p) + 3p² − 2p³`. */
export function hermite(s: number): EasingFn {
  void s;
  return notImplemented('hermite');
}

/** Slope `E'(p)` of an easing. */
export function slopeAt(E: Easing | EasingFn, p: number): number {
  void E; void p;
  return notImplemented('slopeAt');
}

/** max |E'| sampled at 65 points. */
export function peakSlope(E: EasingFn): number {
  void E;
  return notImplemented('peakSlope');
}
