/**
 * Easing presets, the cubic-bezier solver, the CSS easing parser and the
 * cubic Hermite retarget curve (docs/design/v1.3.md §5.6, §3.3).
 * Owned by WP1. Pure math: no DOM access.
 *
 * @internal
 * @module
 */
import type { RollingNumberEasing, RollingNumberEasingName } from '../types';
import type { Easing, EasingFn } from '../internal/contracts';

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress. Outside
 * (0, 1) it returns 0 / 1. `x1`/`x2` must be in [0, 1] (the CSS rule;
 * {@link parseEasing} rejects other values): the x polynomial is then monotone
 * and the solver (Newton, then bisection) always converges.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  if (x1 === y1 && x2 === y2) return (p) => (p > 0 ? (p < 1 ? p : 1) : 0);
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x) => {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    let t = x;
    // Newton: quadratic convergence from t = x for every well-behaved curve.
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x;
      if (Math.abs(e) < 1e-12) return ((ay * t + by) * t + cy) * t;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-9) break;
      t -= e / d;
      if (!(t >= 0 && t <= 1)) break;
    }
    // Bisection fallback (flat x' near an end, e.g. x1 = 0 or x2 = 1).
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 64; i++) {
      const sx = ((ax * t + bx) * t + cx) * t;
      if (Math.abs(sx - x) < 1e-12) break;
      if (sx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

/** Normalizer of the exponential preset so that it ends exactly on 1 without a jump. */
const EXPO_END = 1 - 2 ** -10;

/**
 * Named easings. CSS keywords are their standard cubic-beziers; `odometer` is
 * `cubic-bezier(0.2, 1, 0.3, 1)` (the `--rn-easing` default); the others are
 * the usual polynomial/exponential curves (`ease-out-expo` is normalized to end
 * exactly on 1 at p = 1 with no jump).
 */
export const PRESETS: Record<RollingNumberEasingName, EasingFn> = {
  linear: (p) => p,
  ease: /*#__PURE__*/ cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': /*#__PURE__*/ cubicBezier(0.42, 0, 1, 1),
  'ease-out': /*#__PURE__*/ cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': /*#__PURE__*/ cubicBezier(0.42, 0, 0.58, 1),
  'ease-out-cubic': (p) => 1 - (1 - p) ** 3,
  'ease-in-out-cubic': (p) => (p < 0.5 ? 4 * p * p * p : 1 - (2 - 2 * p) ** 3 / 2),
  'ease-out-quart': (p) => 1 - (1 - p) ** 4,
  'ease-out-expo': (p) => (p >= 1 ? 1 : (1 - 2 ** (-10 * p)) / EXPO_END),
  odometer: /*#__PURE__*/ cubicBezier(0.2, 1, 0.3, 1)
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A CSS `<number>` (no units). */
const NUM_RE = /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/;
/** A CSS `<percentage>`. */
const PCT_RE = /^([+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)%$/;
/** A CSS `<integer>`. */
const INT_RE = /^\+?\d+$/;
/** `name(args)` with no whitespace between the name and the parenthesis (CSS function token). */
const FN_RE = /^([a-z-]+)\(([^()]*)\)$/;

function num(s: string): number | null {
  const t = s.trim();
  if (!NUM_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** `steps(n, position)` per CSS Easing (the "before flag" is irrelevant for progress in [0, 1]). */
function stepsFn(n: number, position: 'start' | 'end' | 'none' | 'both'): EasingFn {
  const jumps = position === 'none' ? n - 1 : position === 'both' ? n + 1 : n;
  const add = position === 'start' || position === 'both' ? 1 : 0;
  return (p) => {
    const x = p > 0 ? (p < 1 ? p : 1) : 0;
    let step = Math.floor(x * n) + add;
    if (step > jumps) step = jumps;
    return step / jumps;
  };
}

/** `<step-position>` keywords of `steps()`. */
const STEP_POSITIONS: Record<string, 'start' | 'end' | 'none' | 'both'> = {
  'jump-start': 'start', start: 'start', 'jump-end': 'end', end: 'end', 'jump-none': 'none', 'jump-both': 'both'
};

function parseSteps(args: string): EasingFn | null {
  const parts = args.split(',');
  if (parts.length > 2) return null;
  const count = parts[0].trim();
  if (!INT_RE.test(count)) return null;
  const n = Number(count);
  if (!(n >= 1) || !Number.isSafeInteger(n)) return null;
  const kw = parts.length === 2 ? parts[1].trim() : 'jump-end';
  if (!hasOwn(STEP_POSITIONS, kw)) return null;
  const position = STEP_POSITIONS[kw];
  if (position === 'none' && n < 2) return null;
  return stepsFn(n, position);
}

/** Parses the 4 arguments of `cubic-bezier()`; `null` when invalid (x1/x2 outside [0, 1]). */
function parseBezierArgs(args: string): [number, number, number, number] | null {
  const parts = args.split(',');
  if (parts.length !== 4) return null;
  const v: number[] = [];
  for (const part of parts) {
    const n = num(part);
    if (n === null) return null;
    v.push(n);
  }
  if (v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null;
  return [v[0], v[1], v[2], v[3]];
}

/** `linear()` per CSS Easing 2: stops with optional 1–2 percentages, implicit positions interpolated. */
function parseLinear(args: string): EasingFn | null {
  const stops = args.split(',');
  if (stops.length < 2) return null;
  const xs: Array<number | null> = [];
  const ys: number[] = [];
  let largest = -Infinity;
  for (let i = 0; i < stops.length; i++) {
    const tokens = stops[i].trim().split(/\s+/);
    if (tokens.length > 3 || tokens[0] === '') return null;
    let output: number | null = null;
    let outputAt = -1;
    const pcts: number[] = [];
    for (let j = 0; j < tokens.length; j++) {
      const pm = PCT_RE.exec(tokens[j]);
      if (pm) {
        const v = Number(pm[1]);
        if (!Number.isFinite(v)) return null;
        pcts.push(v / 100);
        continue;
      }
      const n = num(tokens[j]);
      if (n === null || output !== null) return null;
      output = n;
      outputAt = j;
    }
    if (output === null) return null;
    // `<number> && <percentage>{1,2}`: the percentages are adjacent, so the number is first or last.
    if (tokens.length === 3 && outputAt === 1) return null;
    // Inputs: the stop's percentages, else 0 for the first stop and 1 for the last; each one is
    // at least the largest input so far. Other stops get an implicit (interpolated) input.
    const inputs = pcts.length > 0 ? pcts : i === 0 ? [0] : i === stops.length - 1 ? [1] : null;
    if (inputs) {
      for (const x of inputs) {
        largest = Math.max(x, largest);
        xs.push(largest);
        ys.push(output);
      }
    } else {
      xs.push(null);
      ys.push(output);
    }
  }
  // Runs of implicit inputs: interpolate between the closest known neighbours.
  const n = xs.length;
  const X = new Float64Array(n);
  const Y = Float64Array.from(ys);
  for (let i = 0; i < n; i++) {
    const xi = xs[i];
    if (xi !== null) {
      X[i] = xi;
      continue;
    }
    let j = i;
    while (xs[j] === null) j++;
    const a = X[i - 1];
    const b = xs[j] as number;
    for (let m = i; m < j; m++) X[m] = a + ((b - a) * (m - i + 1)) / (j - i + 1);
    i = j - 1;
  }
  return (p) => {
    let a = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (X[i] <= p) {
        a = i;
        break;
      }
    }
    if (a === n - 1) a--;
    const x0 = X[a];
    const x1 = X[a + 1];
    if (x0 === x1) return Y[a + 1];
    return Y[a] + ((Y[a + 1] - Y[a]) * (p - x0)) / (x1 - x0);
  };
}

/**
 * Parses CSS keywords (`linear`, `ease*`, `step-start`, `step-end`), preset
 * names, `cubic-bezier()`, `linear()` (including the browser-normalized
 * `linear(0 0%, 0.5 30%, 1 100%)` form and implicit positions) and `steps()`
 * (`jump-start|jump-end|jump-none|jump-both|start|end`). Case-insensitive.
 * `null` when invalid.
 */
export function parseEasing(s: string): EasingFn | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  if (t === '') return null;
  if (hasOwn(PRESETS, t)) return PRESETS[t as RollingNumberEasingName];
  if (t === 'step-start') return stepsFn(1, 'start');
  if (t === 'step-end') return stepsFn(1, 'end');
  const m = FN_RE.exec(t);
  if (!m) return null;
  switch (m[1]) {
    case 'cubic-bezier': {
      const v = parseBezierArgs(m[2]);
      return v ? cubicBezier(v[0], v[1], v[2], v[3]) : null;
    }
    case 'linear':
      return parseLinear(m[2]);
    case 'steps':
      return parseSteps(m[2]);
    default:
      return null;
  }
}

/**
 * `true` when `s` is `cubic-bezier(0.2, 1, 0.3, 1)` (the `--rn-easing`
 * default) in any spelling, e.g. the raw custom-property text
 * `cubic-bezier(.2,1,.3,1)`.
 */
export function isDefaultCssEasing(s: string): boolean {
  const m = FN_RE.exec(s.trim().toLowerCase());
  if (!m || m[1] !== 'cubic-bezier') return false;
  const v = parseBezierArgs(m[2]);
  return v !== null && v[0] === 0.2 && v[1] === 1 && v[2] === 0.3 && v[3] === 1;
}

/** Wraps a user function: exact 0/1 at the ends, non-finite results and exceptions → linear. */
function wrapUser(f: (progress: number) => number): EasingFn {
  return (p) => {
    if (!(p > 0)) return 0;
    if (p >= 1) return 1;
    let y: number;
    try {
      y = Number(f(p));
    } catch {
      return p;
    }
    return Number.isFinite(y) ? y : p;
  };
}

/** A user function is valid when it returns finite numbers without throwing on the 63 interior sample points. */
function validUser(f: (progress: number) => number): boolean {
  try {
    for (let i = 1; i < 64; i++) {
      if (!Number.isFinite(Number(f(i / 64)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const fnCache = new WeakMap<(progress: number) => number, Easing | null>();
const strCache = new Map<string, Easing | null>();
const STR_CACHE_MAX = 64;

/**
 * Resolves a public easing (preset name, CSS string or function) to an
 * {@link Easing}. Functions are wrapped (0 at 0, 1 at 1; a non-finite result
 * or an exception at run time gives linear progress). `null` when invalid:
 * an unknown/invalid string, or a function that throws or returns a
 * non-finite value on the sample grid. The caller warns.
 */
export function toEasing(e: RollingNumberEasing): Easing | null {
  if (typeof e === 'function') {
    const hit = fnCache.get(e);
    if (hit !== undefined) return hit;
    let res: Easing | null = null;
    if (validUser(e)) {
      const fn = wrapUser(e);
      res = { fn, peak: peakSlope(fn) };
    }
    fnCache.set(e, res);
    return res;
  }
  if (typeof e !== 'string') return null;
  const key = e.trim().toLowerCase();
  const hit = strCache.get(key);
  if (hit !== undefined) return hit;
  const fn = parseEasing(key);
  const res = fn ? { fn, peak: peakSlope(fn) } : null;
  if (strCache.size >= STR_CACHE_MAX) strCache.clear();
  strCache.set(key, res);
  return res;
}

/**
 * Cubic Hermite progress with start slope `s` and end slope 0 (§5.6):
 * `H(p) = s(p³ − 2p² + p) + 3p² − 2p³`. Monotone for s ∈ [0, 3];
 * `hermite(3)` is ease-out-cubic.
 */
export function hermite(s: number): EasingFn {
  return (p) => {
    const p2 = p * p;
    const p3 = p2 * p;
    return s * (p3 - 2 * p2 + p) + 3 * p2 - 2 * p3;
  };
}

/** Slope `E'(p)` by a central difference (h = 1e−4, one-sided at the ends of [0, 1]). */
export function slopeAt(E: Easing | EasingFn, p: number): number {
  const fn = typeof E === 'function' ? E : E.fn;
  const h = 1e-4;
  const a = Math.max(0, p - h);
  const b = Math.min(1, p + h);
  return (fn(b) - fn(a)) / (b - a);
}

/** max |E'| sampled at 65 points (p = i/64). */
export function peakSlope(E: Easing | EasingFn): number {
  const fn = typeof E === 'function' ? E : E.fn;
  let m = 0;
  for (let i = 0; i <= 64; i++) {
    const s = Math.abs(slopeAt(fn, i / 64));
    if (s > m) m = s;
  }
  return m;
}
