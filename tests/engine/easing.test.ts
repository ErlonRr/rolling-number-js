import { describe, expect, it } from 'vitest';
import type { RollingNumberEasing, RollingNumberEasingName } from '../../src/types';
import {
  cubicBezier, hermite, isDefaultCssEasing, parseEasing, peakSlope, PRESETS, slopeAt, toEasing
} from '../../src/engine/easing';
import { loose } from '../helpers';

/** Independent oracle: solves x(t) = x by plain bisection to machine precision, returns y(t). */
function bezierOracle(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

const NAMES: RollingNumberEasingName[] = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'ease-out-cubic', 'ease-in-out-cubic', 'ease-out-quart', 'ease-out-expo', 'odometer'
];

describe('PRESETS', () => {
  it('defines every RollingNumberEasingName, exact at 0 and 1, monotone', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      const fn = PRESETS[name];
      expect(fn(0), name).toBe(0);
      expect(fn(1), name).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 1000; i++) {
        const y = fn(i / 1000);
        expect(y, `${name} @${i / 1000}`).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = y;
      }
    }
  });

  it('CSS keywords are their standard cubic-beziers; odometer = cubic-bezier(0.2, 1, 0.3, 1)', () => {
    const refs: Array<[RollingNumberEasingName, [number, number, number, number]]> = [
      ['ease', [0.25, 0.1, 0.25, 1]],
      ['ease-in', [0.42, 0, 1, 1]],
      ['ease-out', [0, 0, 0.58, 1]],
      ['ease-in-out', [0.42, 0, 0.58, 1]],
      ['odometer', [0.2, 1, 0.3, 1]]
    ];
    for (const [name, [a, b, c, d]] of refs) {
      for (let i = 0; i <= 200; i++) {
        const x = i / 200;
        expect(Math.abs(PRESETS[name](x) - bezierOracle(a, b, c, d, x)), `${name} @${x}`).toBeLessThan(1e-9);
      }
    }
  });

  it('polynomial and exponential presets follow their formulas', () => {
    for (let i = 0; i <= 100; i++) {
      const p = i / 100;
      expect(PRESETS.linear(p)).toBe(p);
      expect(PRESETS['ease-out-cubic'](p)).toBeCloseTo(1 - (1 - p) ** 3, 14);
      expect(PRESETS['ease-out-quart'](p)).toBeCloseTo(1 - (1 - p) ** 4, 14);
      expect(PRESETS['ease-in-out-cubic'](p)).toBeCloseTo(p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2, 14);
      expect(PRESETS['ease-out-expo'](p)).toBeCloseTo((1 - 2 ** (-10 * p)) / (1 - 2 ** -10), 14);
    }
    // ease-out-expo has no jump at the end
    expect(1 - PRESETS['ease-out-expo'](0.999)).toBeLessThan(1e-4);
  });
});

describe('cubicBezier (g)', () => {
  it('matches published reference values', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.25)).toBeCloseTo(0.4085, 4);
    expect(ease(0.5)).toBeCloseTo(0.8024, 4);
    expect(cubicBezier(0.42, 0, 1, 1)(0.5)).toBeCloseTo(0.3154, 4);
    expect(cubicBezier(0, 0, 0.58, 1)(0.5)).toBeCloseTo(0.6846, 4);
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.25)).toBeCloseTo(0.1292, 4);
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 12);
  });

  it('agrees with a bisection oracle on hard curves (Newton + bisection fallback)', () => {
    // Well-conditioned curves (x'(t) > 0 inside): 1e-9 on [0.01, 0.99], 1e-7 near the ends,
    // where x1 = 0 / x2 = 1 with y ≠ x makes dy/dx infinite and the oracle itself is ~1e-8.
    // Singular curves (x'(t) = 0 at an interior t): y(x) has cube-root conditioning, so double
    // precision in x bounds every solver (the oracle included) to ~5e-6 in y.
    const regular: Array<[number, number, number, number]> = [
      [0, 0, 1, 1], [0, 1, 1, 0], [0, 0.5, 0, 1], [1, 0, 1, 1], [0, 0, 0, 1],
      [0.3, -0.6, 0.7, 1.6], [0.5, -1, 0.5, 2], [0.16, 1, 0.3, 1], [0.99, 0.01, 0.01, 0.99]
    ];
    const singular: Array<[number, number, number, number]> = [[1, 0, 0, 1], [1, 0.5, 0, 0.5]];
    const check = (curves: Array<[number, number, number, number]>, inner: number, outer: number) => {
      for (const [a, b, c, d] of curves) {
        const fn = cubicBezier(a, b, c, d);
        expect(fn(0)).toBe(0);
        expect(fn(1)).toBe(1);
        for (let i = 1; i < 1000; i++) {
          const x = i / 1000;
          const tol = i >= 10 && i <= 990 ? inner : outer;
          expect(Math.abs(fn(x) - bezierOracle(a, b, c, d, x)), `(${a},${b},${c},${d}) @${x}`).toBeLessThan(tol);
        }
      }
    };
    check(regular, 1e-9, 1e-7);
    check(singular, 1e-5, 1e-5);
  });

  it('is symmetric where the curve is, and clamps outside (0, 1)', () => {
    const io = cubicBezier(0.42, 0, 0.58, 1);
    for (let i = 0; i <= 100; i++) expect(io(i / 100) + io(1 - i / 100)).toBeCloseTo(1, 12);
    expect(io(-0.5)).toBe(0);
    expect(io(1.5)).toBe(1);
    expect(io(Number.NaN)).toBe(0);
  });
});

describe('parseEasing (h)', () => {
  it('parses keywords, preset names and is case-insensitive', () => {
    for (const name of NAMES) expect(parseEasing(name)).toBe(PRESETS[name]);
    expect(parseEasing('  EASE-IN ')).toBe(PRESETS['ease-in']);
    const start = parseEasing('step-start');
    const end = parseEasing('step-end');
    expect(start?.(0)).toBe(1);
    expect(start?.(0.5)).toBe(1);
    expect(end?.(0)).toBe(0);
    expect(end?.(0.99)).toBe(0);
    expect(end?.(1)).toBe(1);
  });

  it('parses cubic-bezier() and rejects invalid control points', () => {
    const fn = parseEasing('cubic-bezier(0.25, 0.1, 0.25, 1)');
    expect(fn?.(0.25)).toBeCloseTo(0.4085, 4);
    expect(parseEasing('cubic-bezier(.2,1,.3,1)')?.(0.5)).toBeCloseTo(PRESETS.odometer(0.5), 12);
    expect(parseEasing('cubic-bezier(0.3, -0.6, 0.7, 1.6)')).not.toBeNull();
    expect(parseEasing('cubic-bezier(0, 0, 1e0, 1)')).not.toBeNull();
    for (const bad of [
      'cubic-bezier(1.1, 0, 0.5, 1)', 'cubic-bezier(-0.1, 0, 0.5, 1)', 'cubic-bezier(0, 0, 1)',
      'cubic-bezier(0, 0, 1, 1, 1)', 'cubic-bezier(a, 0, 1, 1)', 'cubic-bezier (0, 0, 1, 1)',
      'cubic-bezier(0, 0, 1, 1', 'cubic-bezier(0,,1,1)', 'cubic-bezier(1., 0, 1, 1)'
    ]) {
      expect(parseEasing(bad), bad).toBeNull();
    }
  });

  it('parses linear(), including the browser-normalized form and implicit positions', () => {
    const norm = parseEasing('linear(0 0%, 0.5 30%, 1 100%)');
    expect(norm).not.toBeNull();
    expect(norm?.(0)).toBe(0);
    expect(norm?.(0.15)).toBeCloseTo(0.25, 12);
    expect(norm?.(0.3)).toBeCloseTo(0.5, 12);
    expect(norm?.(0.65)).toBeCloseTo(0.75, 12);
    expect(norm?.(1)).toBe(1);
    // authored form of the same curve (what the browser normalizes, §14.2)
    const authored = parseEasing('linear(0, 0.5 30%, 1)');
    for (let i = 0; i <= 20; i++) expect(authored?.(i / 20)).toBeCloseTo(norm?.(i / 20) ?? NaN, 12);
    // implicit positions are spread evenly
    const even = parseEasing('linear(0, 0.25, 1)');
    expect(even?.(0.5)).toBeCloseTo(0.25, 12);
    expect(even?.(0.75)).toBeCloseTo(0.625, 12);
    // two percentages = a flat segment; percentages may come before the number
    const flat = parseEasing('linear(0, 0.5 25% 75%, 1)');
    expect(flat?.(0.5)).toBeCloseTo(0.5, 12);
    expect(flat?.(0.875)).toBeCloseTo(0.75, 12);
    expect(parseEasing('linear(0, 25% 75% 0.5, 1)')?.(0.5)).toBeCloseTo(0.5, 12);
    // positions never go backwards (clamped to the largest so far)
    expect(parseEasing('linear(0 50%, 1 20%)')?.(0.5)).toBe(1);
    for (const bad of [
      'linear(1)', 'linear()', 'linear(0, )', 'linear(0 10% 20% 30%, 1)', 'linear(0 abc, 1)',
      'linear(0 10%, 1 2)', 'linear(0 25% 1, 1)', 'linear(10%, 1)'
    ]) {
      expect(parseEasing(bad), bad).toBeNull();
    }
  });

  it('parses steps() with every position keyword', () => {
    const je = parseEasing('steps(4, jump-end)');
    expect([0, 0.24, 0.25, 0.5, 0.99, 1].map((p) => je?.(p))).toEqual([0, 0, 0.25, 0.5, 0.75, 1]);
    const dflt = parseEasing('steps(4)');
    expect([0, 0.25, 0.99, 1].map((p) => dflt?.(p))).toEqual([0, 0.25, 0.75, 1]);
    const end = parseEasing('steps(4, end)');
    expect(end?.(0.5)).toBe(0.5);
    const js = parseEasing('steps(4, jump-start)');
    expect([0, 0.25, 0.99, 1].map((p) => js?.(p))).toEqual([0.25, 0.5, 1, 1]);
    expect(parseEasing('steps(4, start)')?.(0)).toBe(0.25);
    const jn = parseEasing('steps(4, jump-none)');
    expect([0, 0.25, 0.5, 0.75, 1].map((p) => jn?.(p))).toEqual([0, 1 / 3, 2 / 3, 1, 1]);
    const jb = parseEasing('steps(4, jump-both)');
    expect([0, 0.25, 0.99, 1].map((p) => jb?.(p))).toEqual([0.2, 0.4, 0.8, 1]);
    for (const bad of ['steps(0)', 'steps(-1)', 'steps(2.5)', 'steps(1, jump-none)', 'steps(4, middle)', 'steps(4,)', 'steps()', 'steps(4, end, 1)']) {
      expect(parseEasing(bad), bad).toBeNull();
    }
  });

  it('returns null on anything else', () => {
    for (const bad of ['', '   ', 'bogus', 'ease-in-quad', 'initial', 'var(--x)', 'ease ease', 'linear(0, 1) x', '(0, 1)']) {
      expect(parseEasing(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseEasing(loose<string>(42))).toBeNull();
    expect(parseEasing(loose<string>(null))).toBeNull();
  });
});

describe('isDefaultCssEasing', () => {
  it('recognizes the default bezier in any spelling', () => {
    expect(isDefaultCssEasing('cubic-bezier(0.2, 1, 0.3, 1)')).toBe(true);
    expect(isDefaultCssEasing(' cubic-bezier(.2,1,.3,1) ')).toBe(true);
    expect(isDefaultCssEasing('cubic-bezier(0.2, 1, 0.3, 0.9)')).toBe(false);
    expect(isDefaultCssEasing('odometer')).toBe(false);
    expect(isDefaultCssEasing('')).toBe(false);
  });
});

describe('hermite / slopeAt / peakSlope (f)', () => {
  it('hermite(3) ≡ ease-out-cubic within 1e-12', () => {
    const h = hermite(3);
    for (let i = 0; i <= 1000; i++) {
      const p = i / 1000;
      expect(Math.abs(h(p) - PRESETS['ease-out-cubic'](p))).toBeLessThan(1e-12);
    }
  });

  it('hermite(s) starts with slope s, ends flat on 1, and is monotone for s in [0, 3]', () => {
    for (const s of [-1, -0.5, 0, 0.5, 1, 2, 3]) {
      const h = hermite(s);
      expect(h(0)).toBe(0);
      expect(h(1)).toBeCloseTo(1, 14);
      expect(slopeAt(h, 0)).toBeCloseTo(s, 3);
      expect(slopeAt(h, 1)).toBeCloseTo(0, 3);
      if (s >= 0) {
        let prev = 0;
        for (let i = 1; i <= 1000; i++) {
          const y = h(i / 1000);
          expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = y;
        }
      }
    }
    // s = -1: the dip continuing the old direction is H(1/9) = -0.0535 (§5.6 rounds it to 5.3%)
    let min = 0;
    for (let i = 0; i <= 1000; i++) min = Math.min(min, hermite(-1)(i / 1000));
    expect(min).toBeLessThan(0);
    expect(min).toBeCloseTo(-13 / 243, 6);
  });

  it('slopeAt accepts an Easing or a function; peakSlope samples 65 points', () => {
    expect(slopeAt(PRESETS.linear, 0.5)).toBeCloseTo(1, 12);
    expect(slopeAt({ fn: PRESETS.linear, peak: 1 }, 0)).toBeCloseTo(1, 12);
    expect(peakSlope(PRESETS.linear)).toBeCloseTo(1, 12);
    expect(peakSlope(PRESETS['ease-out-cubic'])).toBeCloseTo(3, 3);
    expect(peakSlope({ fn: PRESETS['ease-out-cubic'], peak: 0 })).toBeCloseTo(3, 3);
    // the maximum of ease-in-out-cubic is at p = 0.5 (a sample point)
    expect(peakSlope(PRESETS['ease-in-out-cubic'])).toBeCloseTo(3, 2);
  });
});

describe('toEasing', () => {
  it('resolves presets and CSS strings with their peak slope', () => {
    for (const name of NAMES) {
      const e = toEasing(name);
      expect(e?.fn).toBe(PRESETS[name]);
      expect(e?.peak).toBeCloseTo(peakSlope(PRESETS[name]), 12);
    }
    expect(toEasing('linear')).toBe(toEasing('linear')); // cached
    const css = toEasing('cubic-bezier(0.3, -0.6, 0.7, 1.6)');
    expect(css).not.toBeNull();
    expect(css?.peak).toBeGreaterThan(1);
    expect(toEasing(loose<RollingNumberEasing>('bogus'))).toBeNull();
    expect(toEasing(loose<RollingNumberEasing>(42))).toBeNull();
    expect(toEasing(loose<RollingNumberEasing>(null))).toBeNull();
  });

  it('wraps functions: exact ends, runtime non-finite or throwing values give linear progress', () => {
    let calls = 0;
    const user = (p: number) => {
      calls++;
      return p > 0.995 ? Number.NaN : p * p;
    };
    const e = toEasing(user);
    expect(e).not.toBeNull();
    expect(e?.fn(0)).toBe(0);
    expect(e?.fn(1)).toBe(1);
    expect(e?.fn(0.5)).toBe(0.25);
    expect(e?.fn(0.999)).toBe(0.999);
    expect(Number.isFinite(e?.peak)).toBe(true);
    expect(toEasing(user)).toBe(e); // cached per function
    expect(calls).toBeGreaterThan(0);

    const offEnds = toEasing(() => 0.5);
    expect(offEnds?.fn(0)).toBe(0);
    expect(offEnds?.fn(1)).toBe(1);

    let n = 0;
    const flaky = toEasing((p) => {
      if (++n > 200) throw new Error('late failure');
      return p;
    });
    expect(flaky).not.toBeNull();
    expect(flaky?.fn(0.3)).toBe(0.3); // throws now → linear
  });

  it('rejects functions that throw or return non-finite values on the sample grid', () => {
    expect(toEasing(() => Number.NaN)).toBeNull();
    expect(toEasing((p) => (p > 0.5 ? Number.POSITIVE_INFINITY : p))).toBeNull();
    expect(toEasing(() => {
      throw new Error('nope');
    })).toBeNull();
  });
});
