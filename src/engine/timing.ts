/**
 * Timing resolution: per call → option → non-default CSS variable → path
 * default (docs/design/v1.3.md §5.8). Owned by WP1. Pure: the CSS values come
 * from the `probe` thunk.
 *
 * @internal
 * @module
 */
import type { RollingNumberEasing } from '../types';
import type { Easing, NormalizedOptions, RollingNumberSetValueOptions, Timing, TimingProbe } from '../internal/contracts';
import { isDefaultCssEasing, peakSlope, PRESETS, toEasing } from './easing';
import { warn } from '../internal/warn';

/** Default of `--rn-easing` as browsers normalize it. */
export const DEFAULT_CSS_EASING = 'cubic-bezier(0.2, 1, 0.3, 1)';
/** Default of `--rn-duration` in ms. */
export const DEFAULT_CSS_DURATION_MS = 500;
/** Count-path default duration in ms (1.x). */
const DEFAULT_COUNT_DURATION_MS = 400;

const TIME_RE = /^([+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)(s|ms)$/;

/**
 * `"0.75s"` → 750, `"500ms"` → 500 (units case-insensitive). `null` when
 * invalid: not a single `<time>`, negative, or non-finite (`""`, `"auto"`,
 * `"calc(…)"`, `"1s, 2s"`).
 */
export function parseCssTime(s: string): number | null {
  if (typeof s !== 'string') return null;
  const m = TIME_RE.exec(s.trim().toLowerCase());
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v < 0) return null;
  const ms = m[2] === 's' ? v * 1000 : v;
  return Number.isFinite(ms) ? ms : null;
}

const pathDefaults: { count?: Easing; roll?: Easing } = {};

/** Path default easings (count: ease-out-cubic, roll: odometer), built once. */
function pathDefault(kind: 'count' | 'roll'): Easing {
  const fn = PRESETS[kind === 'count' ? 'ease-out-cubic' : 'odometer'];
  return (pathDefaults[kind] ??= { fn, peak: peakSlope(fn) });
}

const warnedStrings = new Set<string>();
const warnedFns = new WeakSet<object>();

/** User easing → Easing, or `null` (unset or invalid). Invalid values warn once per value. */
function userEasing(e: RollingNumberEasing | null | undefined): Easing | null {
  if (e === null || e === undefined) return null;
  const res = toEasing(e);
  if (res) return res;
  if (typeof e === 'function') {
    if (warnedFns.has(e)) return null;
    warnedFns.add(e);
  } else {
    const key = String(e);
    if (warnedStrings.has(key)) return null;
    if (warnedStrings.size >= 256) warnedStrings.clear(); // bounded memory
    warnedStrings.add(key);
  }
  warn(`Invalid easing ${typeof e === 'function' ? '(function)' : JSON.stringify(String(e))}; the default easing is used.`);
  return null;
}

/**
 * Resolves the kind, duration, easing and instant flag of a change (§5.8):
 *
 * ```
 * flag    = animate = undefined ∨ animate is an object ? opts.interpolate : !!animate   // 1.2: null, 0, '' roll
 * kind    = call.motion ('count'|'roll') ?? (flag ? 'count' : 'roll')
 * kind    = 'roll' when kind = 'count' ∧ opts.duration = 0 ∧ no call.duration ∧ call.motion ≠ 'count'
 *           (1.x "0 = no counting" applies to the implicit kind; an explicit count is timed as if unset)
 * D       = call.duration ?? (opts.duration > 0 ? opts.duration : non-default CSS ?? (count 400 / roll 500))
 * E       = call.easing ?? opts.easing ?? non-default CSS ?? (count ease-out-cubic / roll odometer)
 * instant = motion 'none' ∨ D ≤ 0 ∨ reducedMotion ∨ !hasRaf
 * ```
 *
 * - `probe` is called at most once, and only when D or E depends on CSS and
 *   the change is not already instant for a reason known without CSS
 *   (`motion: 'none'`, `call.duration ≤ 0`, reduced motion, no rAF); D/E then
 *   use the path defaults. `resolveTiming(o, a, () => null, rm, raf).instant`
 *   is therefore the synchronous part of `instant` (§8.2 step 5).
 * - `probe() === null`, or a computed probe of `0s` + `ease` (our rule is
 *   absent), counts as "CSS missing". A CSS duration equal to the default
 *   (500 ms, the documented quirk) or the default easing count as unset.
 *   A CSS `0s` duration only makes rolls instant; counting keeps 400 ms.
 * - Raw custom properties (`fromCustomProperties`, text mode) are parsed as
 *   written; empty or unparsable values count as unset.
 * - An invalid per-call or option easing warns once and counts as unset; a
 *   non-finite or non-number per-call duration is ignored.
 */
export function resolveTiming(
  opts: Pick<NormalizedOptions, 'duration' | 'easing' | 'interpolate'>,
  animate: boolean | RollingNumberSetValueOptions | undefined,
  probe: () => TimingProbe | null,
  reducedMotion: boolean,
  hasRaf: boolean
): Timing {
  const call: RollingNumberSetValueOptions | null = animate !== null && typeof animate === 'object' ? animate : null;
  // 1.2 counted unless `!animate`: only `undefined` (and an options object) follows the option.
  const flag = animate === undefined || call ? opts.interpolate : !!animate;
  const motion = call ? call.motion : undefined;
  let kind: 'count' | 'roll' = motion === 'count' || motion === 'roll' ? motion : flag ? 'count' : 'roll';

  const rawCallD = call ? call.duration : undefined;
  const callD = typeof rawCallD === 'number' && Number.isFinite(rawCallD) ? rawCallD : undefined;
  let optD = opts.duration;
  if (kind === 'count' && optD === 0 && callD === undefined && motion !== 'count') {
    kind = 'roll';
    optD = null;
  }

  const callE = userEasing(call ? call.easing : undefined);
  const optE = callE ? null : userEasing(opts.easing);

  const instantEarly = motion === 'none' || (callD !== undefined && callD <= 0) || reducedMotion || !hasRaf;
  const needD = callD === undefined && !(optD !== null && optD > 0);
  const needE = !callE && !optE;

  let cssD: number | null = null;
  let cssE: Easing | null = null;
  if (!instantEarly && (needD || needE)) {
    const pr = probe();
    if (pr) {
      const dCss = String(pr.durationCss ?? '').trim();
      const eCss = String(pr.easingCss ?? '').trim();
      const missing = !pr.fromCustomProperties && dCss === '0s' && eCss === 'ease';
      if (!missing) {
        cssD = parseCssTime(dCss);
        if (kind === 'count' && cssD === 0) cssD = null;
        // Browser-normalized (or raw) CSS easing; unparsable values count as unset, silently.
        if (eCss !== '' && eCss !== DEFAULT_CSS_EASING && !isDefaultCssEasing(eCss)) cssE = toEasing(eCss as RollingNumberEasing);
      }
    }
  }

  const D =
    callD !== undefined
      ? Math.max(0, callD)
      : optD !== null && optD > 0
        ? optD
        : cssD !== null && cssD !== DEFAULT_CSS_DURATION_MS
          ? cssD
          : kind === 'count'
            ? DEFAULT_COUNT_DURATION_MS
            : DEFAULT_CSS_DURATION_MS;
  const E = callE ?? optE ?? cssE ?? pathDefault(kind);
  const instant = instantEarly || D <= 0;
  return { kind, D, E, instant };
}
