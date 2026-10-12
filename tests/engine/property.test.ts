/**
 * Seeded property tests of the odometer engine (docs/design/v1.3.md §11 WP1
 * (a)–(e), §14.2). p is sampled per 16.7 ms frame. No Math.random.
 *
 * - (a) sample(p = 1) digits exact (and A, inn, sigma, ovf exact);
 * - (b) zero backward steps on exact columns of non-crossing first segments;
 * - (c) inn/sigma/ovf ∈ [0, 1], exact at both ends (p = 0 shows the display);
 * - (d) retarget junction continuity ≤ 1 cell, cumulative backward ≤ 1.1 cells;
 * - (e) default-timing step ≤ 2.5 cells per frame.
 *
 * `RN_ENGINE_REPORT=1` prints the measured statistics.
 */
import { describe, expect, it } from 'vitest';
import type { DisplayState, Easing, Plan } from '../../src/internal/contracts';
import type { RollingNumberEasingName } from '../../src/types';
import { colCount, plan, restState, retargetCurve, sample } from '../../src/engine/odometer';
import { cubicBezier, peakSlope, PRESETS, toEasing } from '../../src/engine/easing';

const mod10 = (x: number) => ((x % 10) + 10) % 10;
const wrap5 = (x: number) => mod10(x + 5) - 5;
const digit = (M: number, k: number) => Math.floor(M / 10 ** k) % 10;
const cl = (a: number, Amax: number) => Math.sign(a) * Math.min(Math.abs(a), Amax);
const report = (...args: unknown[]): void => {
  if (process.env.RN_ENGINE_REPORT) console.log(...args);
};

/** The prototype's generator (prop.mjs), kept bit-for-bit so the workload replicates §14.2. */
function protoLcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
/** mulberry32: a small integer PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stats {
  plans: number; retargets: number; countRetargets: number; frames: number;
  endErr: number; startErr: number; rangeErr: number; scalarErr: number; signErr: number; placeErr: number;
  backExact: number; rollBack: number;
  maxStep: number; maxStepExact: number; maxStepAt: string;
  rtJunction: number; rtBackMax: number; rtMaxStep: number; rtMaxStepAt: string;
}
const newStats = (): Stats => ({
  plans: 0, retargets: 0, countRetargets: 0, frames: 0,
  endErr: 0, startErr: 0, rangeErr: 0, scalarErr: 0, signErr: 0, placeErr: 0,
  backExact: 0, rollBack: 0,
  maxStep: 0, maxStepExact: 0, maxStepAt: '',
  rtJunction: 0, rtBackMax: 0, rtMaxStep: 0, rtMaxStepAt: ''
});

const asDisplay = (s: ReturnType<typeof sample>): DisplayState => ({
  pos: Array.from(s.pos, mod10), inn: Array.from(s.inn), sigma: s.sigma, ovf: s.ovf, reel: Array.from(s.reel, Boolean)
});

/**
 * Samples `pl` per 16.7 ms and accumulates violations into `st` (no expect()
 * in the hot loop). Returns the cumulative backward travel of the worst column.
 */
function check(
  st: Stats, pl: Plan, A1raw: number, Amax: number, f: number, pad: number,
  display: DisplayState, retarget: boolean, tag: string
): number {
  const n = pl.n;
  const frames = Math.ceil(pl.D / 16.67);
  const cross = pl.A0 * pl.A1 < 0;
  const lo = Math.min(pl.A0, pl.A1);
  const hi = Math.max(pl.A0, pl.A1);
  const s0 = sample(pl, 0);
  const s1 = sample(pl, 1);
  const rollDir = Array.from(s1.pos, (x, k) => Math.sign(x - s0.pos[k]));
  const out = sample(pl, 0);
  const prev = new Float64Array(n);
  const back = new Float64Array(n);
  let prevM = 0;
  for (let i = 0; i <= frames; i++) {
    const p = Math.min(1, i / frames);
    const s = sample(pl, p, out);
    if (s !== out) st.rangeErr++;
    st.frames++;
    for (let k = 0; k < n; k++) if (!(s.inn[k] >= 0 && s.inn[k] <= 1)) st.rangeErr++;
    if (!(s.sigma >= 0 && s.sigma <= 1) || !(s.ovf >= 0 && s.ovf <= 1)) st.rangeErr++;
    if (pl.kind === 'count' && (s.A < lo - 1e-9 || s.A > hi + 1e-9)) st.scalarErr++;
    if (Math.abs(s.A) > Amax + 1e-9) st.scalarErr++;
    if (pl.A0 >= 0 && pl.A1 >= 0 && display.sigma === 0 && s.sigma !== 0) st.signErr++;
    if (colCount(Math.abs(s.A), f, pad) > n) st.placeErr++;
    const M = Math.abs(s.A);
    if (i > 0) {
      const dM = M - prevM;
      for (let k = 0; k < n; k++) {
        const d = wrap5(s.pos[k] - prev[k]);
        const step = Math.abs(d);
        if (retarget) {
          if (step > st.rtMaxStep) {
            st.rtMaxStep = step;
            st.rtMaxStepAt = `${tag} k=${k} p=${p.toFixed(3)}`;
          }
        } else if (step > st.maxStep) {
          st.maxStep = step;
          st.maxStepAt = `${tag} k=${k} p=${p.toFixed(3)}`;
        }
        if (!s.reel[k]) {
          if (!retarget) st.maxStepExact = Math.max(st.maxStepExact, step);
          if (pl.kind === 'count' && !cross && Math.abs(dM) > 1e-9 && d * Math.sign(dM) < -1e-6) back[k] += -d * Math.sign(dM);
        }
        if (pl.kind === 'roll' && !retarget && d * rollDir[k] < -1e-6) st.rollBack++;
      }
    }
    prev.set(s.pos);
    prevM = M;
  }
  // (a) exact end
  const M1 = Math.min(Math.abs(A1raw), Amax);
  const n1 = colCount(M1, f, pad);
  for (let k = 0; k < n; k++) {
    if (Math.abs(wrap5(s1.pos[k] - digit(M1, k))) > 1e-6) st.endErr++;
    if (s1.inn[k] !== (k < n1 ? 1 : 0)) st.endErr++;
  }
  if (s1.A !== cl(A1raw, Amax)) st.endErr++;
  if (s1.sigma !== (cl(A1raw, Amax) < 0 ? 1 : 0)) st.endErr++;
  if (s1.ovf !== (Math.abs(A1raw) > Amax ? 1 : 0)) st.endErr++;
  // (c)/(d) p = 0 shows the display
  for (let k = 0; k < Math.min(n, display.pos.length); k++) {
    const j = Math.abs(wrap5(s0.pos[k] - display.pos[k]));
    if (retarget) st.rtJunction = Math.max(st.rtJunction, j);
    if (j > 1e-6) st.startErr++;
    if (Math.abs(s0.inn[k] - display.inn[k]) > 1e-9) st.startErr++;
  }
  if (Math.abs(s0.sigma - display.sigma) > 1e-9 || Math.abs(s0.ovf - display.ovf) > 1e-9) st.startErr++;
  return Math.max(0, ...back);
}

function randVal(rnd: () => number): number {
  const mag = 10 ** Math.floor(rnd() * 7);
  return Math.round((rnd() * 2 - 0.6) * mag);
}

const easing = (fn: (p: number) => number): Easing => ({ fn, peak: peakSlope(fn) });
const NAMES = Object.keys(PRESETS) as RollingNumberEasingName[];

function expectClean(st: Stats): void {
  expect(st.endErr, 'end errors').toBe(0);
  expect(st.startErr, 'start/junction errors').toBe(0);
  expect(st.rangeErr, 'presence out of [0, 1]').toBe(0);
  expect(st.scalarErr, 'A outside [A0, A1] or |A| > Amax').toBe(0);
  expect(st.signErr, 'sign without a negative endpoint').toBe(0);
  expect(st.placeErr, 'a needed place beyond n').toBe(0);
  expect(st.backExact, 'first segments with backward exact columns').toBe(0);
  expect(st.rollBack, 'roll columns moving against their direction').toBe(0);
  expect(st.rtJunction, 'junction continuity').toBeLessThanOrEqual(1);
  expect(st.rtBackMax, 'retarget cumulative backward').toBeLessThanOrEqual(1.1);
}

describe('odometer properties (a)–(d)', () => {
  it('replica of the §14.2 workload (prototype generator and easings)', () => {
    const rnd = protoLcg(12345);
    const eases = [
      PRESETS['ease-out-cubic'], PRESETS.linear, cubicBezier(0.42, 0, 1, 1), cubicBezier(0.42, 0, 0.58, 1),
      PRESETS.odometer, cubicBezier(0.16, 1, 0.3, 1)
    ].map(easing);
    const st = newStats();
    for (let c = 0; c < 6000; c++) {
      const f = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
      const pad = 1 + Math.floor(rnd() * 3);
      const Amax = rnd() < 0.15 ? Math.floor(rnd() * 999) + 1 : Infinity;
      const A0 = randVal(rnd);
      const A1 = randVal(rnd);
      if (A0 === A1) continue;
      const E = eases[c % eases.length];
      const D = [200, 400, 800, 2000][c % 4];
      const kind = rnd() < 0.25 ? 'roll' : 'count';
      const pl = plan({ kind, A0, A1, Amax, f, pad, D, E, display: null, prevKind: null });
      st.plans++;
      const tag = `#${c} ${kind} ${A0}→${A1} max=${Amax} f=${f} pad=${pad} D=${D}`;
      if (check(st, pl, A1, Amax, f, pad, restState(A0, Amax, f, pad, pl.n), false, tag) > 1e-6) st.backExact++;
      if (kind === 'count' && rnd() < 0.6) {
        const pr = 0.05 + rnd() * 0.7;
        const s = sample(pl, pr);
        const display = asDisplay(s);
        const A2 = Math.round(s.A) + Math.round((rnd() * 2 - 0.5) * (rnd() < 0.5 ? 10 : 1000));
        if (A2 === pl.A1) continue;
        const cv = retargetCurve(pl, pr, s.A, A2, D);
        const p2 = plan({ kind: 'count', A0: s.A, A1: A2, Amax, f, pad, D: cv.D, E: cv.E, display, prevKind: 'count' });
        st.retargets++;
        st.countRetargets++;
        st.rtBackMax = Math.max(st.rtBackMax, check(st, p2, A2, Amax, f, pad, display, true, `${tag} → ${A2} @${pr.toFixed(3)}`));
      }
    }
    report('replica', JSON.stringify(st, null, 1));
    // the prototype generated exactly this workload (§14.2)
    expect(st.plans).toBe(5921);
    expect(st.retargets).toBe(2788);
    expectClean(st);
    // first segments reproduce the prototype's maxima (prop.json; its bezier solver is ~1e-7 accurate)
    expect(st.maxStep).toBeCloseTo(4.923465402499431, 5);
    expect(st.maxStepExact).toBeCloseTo(4.13245364029045, 5);
    expect(st.maxStepAt).toContain('D=200');
  });

  it('every preset × D ∈ {200, 400, 800, 2000}, count and roll, with count/roll retargets', () => {
    const rnd = mulberry32(0x5eed1);
    const presets = NAMES.map((name) => toEasing(name) as Easing);
    const st = newStats();
    let rollRetargets = 0;
    for (let c = 0; c < 6000; c++) {
      const f = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
      const pad = 1 + Math.floor(rnd() * 3);
      const Amax = rnd() < 0.15 ? Math.floor(rnd() * 999) + 1 : Infinity;
      const A0 = randVal(rnd);
      const A1 = randVal(rnd);
      if (A0 === A1) continue;
      const E = presets[c % presets.length];
      const D = [200, 400, 800, 2000][Math.floor(c / presets.length) % 4];
      const kind = rnd() < 0.25 ? 'roll' : 'count';
      const pl = plan({ kind, A0, A1, Amax, f, pad, D, E, display: null, prevKind: null });
      st.plans++;
      const tag = `#${c} ${kind} ${NAMES[c % presets.length]} ${A0}→${A1} max=${Amax} f=${f} pad=${pad} D=${D}`;
      if (check(st, pl, A1, Amax, f, pad, restState(A0, Amax, f, pad, pl.n), false, tag) > 1e-6) st.backExact++;
      if (rnd() < (kind === 'count' ? 0.6 : 0.4)) {
        const pr = 0.05 + rnd() * 0.7;
        const s = sample(pl, pr);
        const display = asDisplay(s);
        const A2 = Math.round(s.A) + Math.round((rnd() * 2 - 0.5) * (rnd() < 0.5 ? 10 : 1000));
        if (A2 === pl.A1) continue;
        const kind2 = rnd() < (kind === 'count' ? 0.8 : 0.5) ? 'count' : 'roll';
        const velocityCarry = kind === 'count' && kind2 === 'count';
        const cv = velocityCarry ? retargetCurve(pl, pr, s.A, A2, D) : { E, D };
        const p2 = plan({ kind: kind2, A0: s.A, A1: A2, Amax, f, pad, D: cv.D, E: cv.E, display, prevKind: kind });
        st.retargets++;
        const back = check(st, p2, A2, Amax, f, pad, display, true, `${tag} → ${kind2} ${A2} @${pr.toFixed(3)}`);
        if (velocityCarry) {
          st.countRetargets++;
          st.rtBackMax = Math.max(st.rtBackMax, back);
        } else {
          rollRetargets++;
        }
      }
    }
    report('all presets', JSON.stringify({ ...st, rollRetargets }, null, 1));
    expect(st.plans).toBeGreaterThanOrEqual(5000);
    expect(st.countRetargets).toBeGreaterThanOrEqual(2000);
    expect(rollRetargets).toBeGreaterThan(300);
    expectClean(st);
    // §5.3: steps scale with E'max/D; the worst case is a 200 ms ease-out-expo plan
    expect(st.maxStep).toBeLessThan(6);
  });
});

describe('odometer property (e): default timing', () => {
  it('first segments with the default timing step ≤ 2.5 cells per frame', () => {
    const rnd = mulberry32(0xdef417);
    const countE = toEasing('ease-out-cubic') as Easing;
    const rollE = toEasing('odometer') as Easing;
    const st = newStats();
    for (let c = 0; c < 3000; c++) {
      const f = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
      const pad = 1 + Math.floor(rnd() * 3);
      const Amax = rnd() < 0.15 ? Math.floor(rnd() * 999) + 1 : Infinity;
      const A0 = randVal(rnd);
      const A1 = randVal(rnd);
      if (A0 === A1) continue;
      const roll = rnd() < 0.3;
      const pl = plan({
        kind: roll ? 'roll' : 'count', A0, A1, Amax, f, pad, D: roll ? 500 : 400, E: roll ? rollE : countE, display: null, prevKind: null
      });
      st.plans++;
      if (check(st, pl, A1, Amax, f, pad, restState(A0, Amax, f, pad, pl.n), false, `#${c} ${A0}→${A1}`) > 1e-6) st.backExact++;
    }
    report('default timing', JSON.stringify(st, null, 1));
    expectClean(st);
    expect(st.maxStep).toBeLessThanOrEqual(2.5);
  });
});

describe('odometer property (f): entering and leaving places never pop', () => {
  const countE = toEasing('ease-out-cubic') as Easing;
  const FRAME = 1000 / 60;

  /** Largest per-frame change of any inn channel and of their sum, and the number of frames where the sum changes. */
  function presenceSteps(pl: Plan): { maxInn: number; maxSum: number; growthFrames: number } {
    const frames = Math.ceil(pl.D / FRAME);
    let prev = Array.from(sample(pl, 0).inn);
    let maxInn = 0;
    let maxSum = 0;
    let growthFrames = 0;
    for (let i = 1; i <= frames; i++) {
      const inn = Array.from(sample(pl, Math.min(1, (i * FRAME) / pl.D)).inn);
      let sum = 0;
      for (let k = 0; k < pl.n; k++) {
        const d = inn[k] - prev[k];
        maxInn = Math.max(maxInn, Math.abs(d));
        sum += d;
      }
      maxSum = Math.max(maxSum, Math.abs(sum));
      if (Math.abs(sum) > 1e-9) growthFrames++;
      prev = inn;
    }
    return { maxInn, maxSum, growthFrames };
  }

  it('0 → 12,345 with the default timing: the four new columns grow over several frames', () => {
    const pl = plan({ kind: 'count', A0: 0, A1: 12345, Amax: Infinity, f: 0, pad: 1, D: 400, E: countE, display: null, prevKind: null });
    const st = presenceSteps(pl);
    expect(st.maxInn).toBeLessThanOrEqual(0.25);
    expect(st.maxSum).toBeLessThanOrEqual(1);
    expect(st.growthFrames).toBeGreaterThanOrEqual(4);
    // the first frame no longer shows three full columns at once
    expect(Array.from(sample(pl, FRAME / 400).inn).slice(1).every((v) => v < 0.5)).toBe(true);
    expect(Array.from(sample(pl, 1).inn)).toEqual([1, 1, 1, 1, 1]);
  });

  it('9.50 → 12,345.50 (2 decimals) and the way back grow and shrink over several frames', () => {
    for (const [A0, A1] of [[950, 1234550], [1234550, 950]]) {
      const pl = plan({ kind: 'count', A0, A1, Amax: Infinity, f: 2, pad: 1, D: 400, E: countE, display: null, prevKind: null });
      const st = presenceSteps(pl);
      expect(st.maxInn, `${A0}→${A1}`).toBeLessThanOrEqual(0.25);
      expect(st.growthFrames, `${A0}→${A1}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('random count plans with the default timing: every inn changes by ≤ 0.25 per frame', () => {
    const rnd = mulberry32(0x1a77);
    let worst = 0;
    let worstAt = '';
    for (let c = 0; c < 3000; c++) {
      const f = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
      const pad = 1 + Math.floor(rnd() * 3);
      const Amax = rnd() < 0.15 ? Math.floor(rnd() * 999) + 1 : Infinity;
      const A0 = randVal(rnd);
      const A1 = randVal(rnd);
      if (A0 === A1) continue;
      const pl = plan({ kind: 'count', A0, A1, Amax, f, pad, D: 400, E: countE, display: null, prevKind: null });
      const { maxInn } = presenceSteps(pl);
      if (maxInn > worst) {
        worst = maxInn;
        worstAt = `#${c} ${A0}→${A1} max=${Amax} f=${f} pad=${pad}`;
      }
    }
    report('presence', worst, worstAt);
    expect(worst, worstAt).toBeLessThanOrEqual(0.25);
  });
});
