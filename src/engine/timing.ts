/**
 * Timing resolution: per call → option → non-default CSS variable → path
 * default (docs/design/v1.3.md §5.8). Owned by WP1. WP0 stub: final signatures.
 *
 * @internal
 * @module
 */
import type { NormalizedOptions, RollingNumberSetValueOptions, Timing, TimingProbe } from '../internal/contracts';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] engine/timing.${name}: not implemented yet (WP1)`);
}

/** Default of `--rn-easing` as browsers normalize it. */
export const DEFAULT_CSS_EASING = 'cubic-bezier(0.2, 1, 0.3, 1)';
/** Default of `--rn-duration` in ms. */
export const DEFAULT_CSS_DURATION_MS = 500;

/** Resolves the kind, duration, easing and instant flag of a change. */
export function resolveTiming(
  opts: Pick<NormalizedOptions, 'duration' | 'easing' | 'interpolate'>,
  animate: boolean | RollingNumberSetValueOptions | undefined,
  probe: () => TimingProbe | null,
  reducedMotion: boolean,
  hasRaf: boolean
): Timing {
  void opts; void animate; void probe; void reducedMotion; void hasRaf;
  return notImplemented('resolveTiming');
}

/** `"0.75s"` → 750, `"500ms"` → 500; `null` when invalid. */
export function parseCssTime(s: string): number | null {
  void s;
  return notImplemented('parseCssTime');
}
