import { describe, expect, it, vi } from 'vitest';
import type { NormalizedOptions, Timing, TimingProbe } from '../../src/internal/contracts';
import type { RollingNumberEasing, RollingNumberSetValueOptions } from '../../src/types';
import { DEFAULT_CSS_DURATION_MS, DEFAULT_CSS_EASING, parseCssTime, resolveTiming } from '../../src/engine/timing';
import { PRESETS } from '../../src/engine/easing';
import { loose } from '../helpers';

type TimingOpts = Pick<NormalizedOptions, 'duration' | 'easing' | 'interpolate'>;

const opts = (o: Partial<TimingOpts> = {}): TimingOpts => ({ duration: null, easing: null, interpolate: true, ...o });

/** A probe thunk returning computed (or raw) CSS values, counting its calls. */
function probe(durationCss: string, easingCss: string, fromCustomProperties = false) {
  const fn = vi.fn((): TimingProbe | null => ({ durationCss, easingCss, fromCustomProperties }));
  return fn;
}
const unsetCss = () => probe('0.5s', DEFAULT_CSS_EASING);
const missingCss = () => probe('0s', 'ease');

const same = (a: (p: number) => number, b: (p: number) => number) => {
  for (let i = 0; i <= 20; i++) expect(a(i / 20)).toBeCloseTo(b(i / 20), 12);
};

function run(
  o: Partial<TimingOpts>,
  animate: boolean | RollingNumberSetValueOptions | undefined,
  pr: () => TimingProbe | null = unsetCss(),
  reduced = false,
  hasRaf = true
): Timing {
  return resolveTiming(opts(o), animate, pr, reduced, hasRaf);
}

describe('parseCssTime (h)', () => {
  it.each([
    ['0.75s', 750], ['500ms', 500], ['0s', 0], ['0ms', 0], ['.5s', 500], ['1.2S', 1200], ['250MS', 250],
    [' 2s ', 2000], ['1e3ms', 1000], ['+1s', 1000], ['0.5s', 500]
  ])('%j → %d', (s, ms) => {
    expect(parseCssTime(s)).toBeCloseTo(ms, 9);
  });

  it.each(['', '  ', 'auto', '-1s', '1s, 2s', 'calc(1s)', '10', 's', 'ms', '1 s', 'NaNs', 'infinitys', '1sec', '1.s'])(
    '%j → null',
    (s) => {
      expect(parseCssTime(s)).toBeNull();
    }
  );

  it('rejects non-strings', () => {
    expect(parseCssTime(loose<string>(500))).toBeNull();
  });
});

describe('resolveTiming (i): path defaults, CSS, quirks', () => {
  it('defaults: count 400 ms ease-out-cubic, roll 500 ms odometer', () => {
    const c = run({}, undefined);
    expect(c).toMatchObject({ kind: 'count', D: 400, instant: false });
    same(c.E.fn, PRESETS['ease-out-cubic']);
    const r = run({ interpolate: false }, undefined);
    expect(r).toMatchObject({ kind: 'roll', D: DEFAULT_CSS_DURATION_MS, instant: false });
    same(r.E.fn, PRESETS.odometer);
  });

  it('cssMissing (0s + ease) and a null probe use the path defaults', () => {
    for (const pr of [missingCss(), vi.fn(() => null)]) {
      const c = run({}, true, pr);
      expect(c).toMatchObject({ kind: 'count', D: 400, instant: false });
      same(c.E.fn, PRESETS['ease-out-cubic']);
      const r = run({}, false, pr);
      expect(r).toMatchObject({ kind: 'roll', D: 500, instant: false });
      same(r.E.fn, PRESETS.odometer);
    }
  });

  it('default-equals quirk: --rn-duration 0.5s and the default easing count as unset', () => {
    const pr = probe('0.5s', DEFAULT_CSS_EASING);
    expect(run({}, true, pr).D).toBe(400);
    expect(run({}, false, pr).D).toBe(500);
    // raw custom properties in another spelling are recognized too
    const raw = probe('500ms', 'cubic-bezier(.2,1,.3,1)', true);
    const c = run({}, true, raw);
    expect(c.D).toBe(400);
    same(c.E.fn, PRESETS['ease-out-cubic']);
  });

  it('a non-default --rn-duration / --rn-easing drives both paths (S4)', () => {
    const pr = () => probe('0.75s', 'linear');
    const c = run({}, true, pr());
    expect(c).toMatchObject({ kind: 'count', D: 750, instant: false });
    same(c.E.fn, PRESETS.linear);
    const r = run({}, false, pr());
    expect(r).toMatchObject({ kind: 'roll', D: 750, instant: false });
    same(r.E.fn, PRESETS.linear);
  });

  it('browser-normalized easings are parsed (linear() with percentages, steps())', () => {
    const t = run({}, true, probe('1.2s', 'linear(0 0%, 0.5 30%, 1 100%)'));
    expect(t.D).toBe(1200);
    expect(t.E.fn(0.3)).toBeCloseTo(0.5, 12);
    expect(run({}, false, probe('1s', 'steps(4, jump-end)')).E.fn(0.3)).toBe(0.25);
    // an unparsable CSS easing is ignored silently
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    same(run({}, true, probe('1s', 'frobnicate(1)')).E.fn, PRESETS['ease-out-cubic']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a CSS 0s duration makes rolls instant; counting keeps 400 ms', () => {
    const roll = run({}, false, probe('0s', DEFAULT_CSS_EASING));
    expect(roll).toMatchObject({ kind: 'roll', D: 0, instant: true });
    const count = run({}, true, probe('0s', DEFAULT_CSS_EASING));
    expect(count).toMatchObject({ kind: 'count', D: 400, instant: false });
    // 0s with a non-default easing: the easing still drives counting
    const c2 = run({}, true, probe('0s', 'linear'));
    expect(c2).toMatchObject({ kind: 'count', D: 400, instant: false });
    same(c2.E.fn, PRESETS.linear);
  });

  it('duration 0 (option) = 1.x "no counting": count becomes a roll timed by CSS', () => {
    const t = run({ duration: 0 }, true, probe('0.75s', DEFAULT_CSS_EASING));
    expect(t).toMatchObject({ kind: 'roll', D: 750, instant: false });
    same(t.E.fn, PRESETS.odometer);
    expect(run({ duration: 0 }, undefined, unsetCss())).toMatchObject({ kind: 'roll', D: 500, instant: false });
    // with CSS 0s the roll is instant
    expect(run({ duration: 0 }, undefined, probe('0s', DEFAULT_CSS_EASING))).toMatchObject({ kind: 'roll', instant: true });
    // an explicit per-call duration keeps counting
    expect(run({ duration: 0 }, { duration: 300 })).toMatchObject({ kind: 'count', D: 300, instant: false });
    // a roll with duration 0 also ignores the option (D from CSS)
    expect(run({ duration: 0, interpolate: false }, undefined)).toMatchObject({ kind: 'roll', D: 500 });
  });

  it('option duration > 0 times both paths (S5); call duration wins', () => {
    expect(run({ duration: 250 }, true, probe('0.75s', 'linear'))).toMatchObject({ kind: 'count', D: 250 });
    expect(run({ duration: 250 }, false, probe('0.75s', 'linear'))).toMatchObject({ kind: 'roll', D: 250 });
    expect(run({ duration: 250 }, { duration: 900 })).toMatchObject({ D: 900 });
  });

  it('easing priority: call → option → CSS → path default', () => {
    const css = () => probe('1s', 'linear');
    same(run({ easing: 'ease-in' }, true, css()).E.fn, PRESETS['ease-in']);
    same(run({ easing: 'ease-in' }, { easing: 'ease-out-quart' }, css()).E.fn, PRESETS['ease-out-quart']);
    same(run({}, true, css()).E.fn, PRESETS.linear);
    const fn = (p: number) => p * p;
    expect(run({ easing: fn }, true).E.fn(0.5)).toBe(0.25);
    expect(run({}, { easing: 'cubic-bezier(0, 0, 1, 1)' }).E.fn(0.3)).toBeCloseTo(0.3, 12);
  });

  it('an invalid easing warns once per value and counts as unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = loose<RollingNumberEasing>('cubic-bezier(2, 0, 1, 1)');
    same(run({ easing: bad }, true, probe('1s', 'linear')).E.fn, PRESETS.linear);
    same(run({ easing: bad }, true).E.fn, PRESETS['ease-out-cubic']);
    same(run({}, { easing: bad }).E.fn, PRESETS['ease-out-cubic']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('[RollingNumber]');
    const badFn = () => Number.NaN;
    same(run({ easing: badFn }, true).E.fn, PRESETS['ease-out-cubic']);
    same(run({ easing: badFn }, true).E.fn, PRESETS['ease-out-cubic']);
    expect(warn).toHaveBeenCalledTimes(2);
    // invalid per-call easing falls back to the option easing
    same(run({ easing: 'ease-in' }, { easing: loose<RollingNumberEasing>('nope') }).E.fn, PRESETS['ease-in']);
  });

  it('raw custom properties (text mode): parsed as written, empty = unset, no cssMissing rule', () => {
    const t = run({}, true, probe('750ms', 'ease-in', true));
    expect(t.D).toBe(750);
    same(t.E.fn, PRESETS['ease-in']);
    const empty = run({}, false, probe('', '', true));
    expect(empty).toMatchObject({ kind: 'roll', D: 500, instant: false });
    same(empty.E.fn, PRESETS.odometer);
    // literal "0s" + "ease" written by the user is not "missing": rolls become instant
    expect(run({}, false, probe('0s', 'ease', true))).toMatchObject({ kind: 'roll', D: 0, instant: true });
    // calc() is unsupported on the raw path → default
    expect(run({}, true, probe('calc(2 * 1s)', '', true)).D).toBe(400);
  });

  it('instant: motion none, call duration ≤ 0, reduced motion, no rAF', () => {
    const pr = unsetCss();
    expect(run({}, { motion: 'none' }, pr)).toMatchObject({ kind: 'count', instant: true });
    expect(run({ interpolate: false }, { motion: 'none' }, pr)).toMatchObject({ kind: 'roll', instant: true });
    expect(run({}, { duration: 0 }, pr)).toMatchObject({ D: 0, instant: true });
    expect(run({}, { duration: -5 }, pr)).toMatchObject({ D: 0, instant: true });
    expect(run({}, true, pr, true)).toMatchObject({ kind: 'count', instant: true });
    expect(run({}, false, pr, false, false)).toMatchObject({ kind: 'roll', instant: true });
    // known without CSS: the probe is never called
    expect(pr).not.toHaveBeenCalled();
  });

  it('non-finite per-call durations are ignored', () => {
    expect(run({}, { duration: Number.NaN })).toMatchObject({ D: 400, instant: false });
    expect(run({}, { duration: Number.POSITIVE_INFINITY })).toMatchObject({ D: 400, instant: false });
    expect(run({}, loose<RollingNumberSetValueOptions>({ duration: '300' }))).toMatchObject({ D: 400 });
  });

  it('calls the probe lazily, at most once', () => {
    const pr = unsetCss();
    run({ duration: 300, easing: 'linear' }, true, pr);
    run({}, { duration: 300, easing: 'linear' }, pr);
    expect(pr).not.toHaveBeenCalled();
    run({ duration: 300 }, true, pr); // easing still from CSS
    expect(pr).toHaveBeenCalledTimes(1);
    run({ easing: 'linear' }, true, pr); // duration still from CSS
    expect(pr).toHaveBeenCalledTimes(2);
  });

  it('the synchronous part of instant is resolveTiming(…, () => null, …).instant', () => {
    const nul = () => null;
    expect(resolveTiming(opts({ duration: 0 }), undefined, nul, false, true).instant).toBe(false);
    expect(resolveTiming(opts(), { duration: 0 }, nul, false, true).instant).toBe(true);
    expect(resolveTiming(opts(), { motion: 'none' }, nul, false, true).instant).toBe(true);
    expect(resolveTiming(opts(), true, nul, true, true).instant).toBe(true);
    expect(resolveTiming(opts(), true, nul, false, false).instant).toBe(true);
    expect(resolveTiming(opts(), true, nul, false, true).instant).toBe(false);
  });
});

describe('resolveTiming (m): kind table', () => {
  it.each<[string, boolean, boolean | RollingNumberSetValueOptions | undefined, 'count' | 'roll']>([
    ['undefined follows interpolate:true', true, undefined, 'count'],
    ['undefined follows interpolate:false', false, undefined, 'roll'],
    ['true counts', false, true, 'count'],
    ['false rolls', true, false, 'roll'],
    ['{} follows interpolate:true', true, {}, 'count'],
    ['{} follows interpolate:false', false, {}, 'roll'],
    ['{ duration: 300 } follows interpolate:false', false, { duration: 300 }, 'roll'],
    ['{ duration: 300 } follows interpolate:true', true, { duration: 300 }, 'count'],
    ['{ easing } follows interpolate:false', false, { easing: 'linear' }, 'roll'],
    ['{ motion: "roll" } with interpolate:true', true, { motion: 'roll' }, 'roll'],
    ['{ motion: "count" } with interpolate:false', false, { motion: 'count' }, 'count'],
    ['{ motion: "none" } keeps the interpolate kind', false, { motion: 'none' }, 'roll']
  ])('%s', (_name, interpolate, animate, kind) => {
    expect(run({ interpolate }, animate).kind).toBe(kind);
  });

  it('{ duration: 300 } without motion times the interpolate kind (S5)', () => {
    expect(run({ interpolate: false }, { duration: 300 })).toMatchObject({ kind: 'roll', D: 300, instant: false });
    expect(run({ interpolate: true }, { duration: 300 })).toMatchObject({ kind: 'count', D: 300, instant: false });
  });

  it('cssD = 0: instant roll, count keeps 400', () => {
    const zero = () => probe('0s', 'cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(run({}, false, zero())).toMatchObject({ kind: 'roll', D: 0, instant: true });
    expect(run({}, true, zero())).toMatchObject({ kind: 'count', D: 400, instant: false });
    expect(run({}, { motion: 'roll' }, zero())).toMatchObject({ kind: 'roll', instant: true });
    expect(run({}, { motion: 'roll', duration: 200 }, zero())).toMatchObject({ kind: 'roll', D: 200, instant: false });
  });
});
