import { describe, expect, it } from 'vitest';
import type { DisplayState, Easing, FrameState, Plan, PlanInput } from '../../src/internal/contracts';
import { colCount, plan, restState, retargetCurve, sample, velocity } from '../../src/engine/odometer';
import { hermite, PRESETS, slopeAt, toEasing } from '../../src/engine/easing';

const mod10 = (x: number) => ((x % 10) + 10) % 10;
const wrap5 = (x: number) => mod10(x + 5) - 5;
const digit = (M: number, k: number) => Math.floor(M / 10 ** k) % 10;
const ease = (name: Parameters<typeof toEasing>[0]): Easing => {
  const e = toEasing(name);
  if (!e) throw new Error(`invalid easing ${String(name)}`);
  return e;
};
const COUNT_E = ease('ease-out-cubic');
const ROLL_E = ease('odometer');

function mk(o: Partial<PlanInput> & Pick<PlanInput, 'A0' | 'A1'>): Plan {
  const kind = o.kind ?? 'count';
  return plan({
    kind, Amax: Infinity, f: 0, pad: 1, D: kind === 'count' ? 400 : 500, E: kind === 'count' ? COUNT_E : ROLL_E,
    display: null, prevKind: null, ...o
  });
}

/** Digits shown by a frame (present places only), most significant first. */
const shown = (fs: FrameState) =>
  Array.from(fs.pos)
    .map((x, k) => (fs.inn[k] > 0.5 ? String(Math.round(mod10(x)) % 10) : ''))
    .reverse()
    .join('');

const frames = (pl: Plan, step = 16) => {
  const out: FrameState[] = [];
  const n = Math.ceil(pl.D / step);
  for (let i = 0; i <= n; i++) {
    const s = sample(pl, Math.min(1, (i * step) / pl.D));
    out.push({ ...s, pos: s.pos.slice(), inn: s.inn.slice(), lead: s.lead.slice(), reel: s.reel.slice() });
  }
  return out;
};

describe('colCount', () => {
  it.each([
    [0, 0, 1, 1], [9, 0, 1, 1], [10, 0, 1, 2], [99.999, 0, 1, 2], [100, 0, 1, 3], [5, 0, 3, 3], [12345, 0, 3, 5],
    [125, 2, 1, 3], [12345, 2, 1, 5], [0, 2, 1, 3], [99, 2, 2, 4], [Number.MAX_SAFE_INTEGER, 0, 1, 16], [1e21, 0, 1, 22]
  ])('colCount(%d, f=%d, pad=%d) = %d', (M, f, pad, n) => {
    expect(colCount(M, f, pad)).toBe(n);
  });
});

describe('restState', () => {
  it('gives exact digits, present places, sign and overflow', () => {
    const r = restState(-125, Infinity, 0, 1, 4);
    expect(Array.from(r.pos)).toEqual([5, 2, 1, 0]);
    expect(Array.from(r.inn)).toEqual([1, 1, 1, 0]);
    expect(Array.from(r.reel)).toEqual([false, false, false, false]);
    expect(r.sigma).toBe(1);
    expect(r.ovf).toBe(0);
  });

  it('clamps by Amax and reports the overflow; honors pad and f', () => {
    const o = restState(150, 99, 0, 1, 2);
    expect(Array.from(o.pos)).toEqual([9, 9]);
    expect(o.ovf).toBe(1);
    expect(o.sigma).toBe(0);
    const p = restState(7, Infinity, 0, 3, 4);
    expect(Array.from(p.pos)).toEqual([7, 0, 0, 0]);
    expect(Array.from(p.inn)).toEqual([1, 1, 1, 0]);
    const f = restState(-350, Infinity, 2, 1, 3);
    expect(Array.from(f.pos)).toEqual([0, 5, 3]);
    expect(Array.from(f.inn)).toEqual([1, 1, 1]);
    expect(restState(5, Infinity, 0, 1, 0).pos).toHaveLength(0);
  });
});

describe('plan / sample basics', () => {
  it('exposes the clamped scalars, overflow endpoints and the place count', () => {
    const pl = mk({ A0: 95, A1: 150, Amax: 99 });
    expect(pl).toMatchObject({ kind: 'count', n: 2, D: 400, A0: 95, A1: 99, o0: 0, o1: 1 });
    expect(pl.E).toBe(COUNT_E);
    const neg = mk({ A0: -150, A1: 20, Amax: 99 });
    expect(neg).toMatchObject({ A0: -99, A1: 20, o0: 1, o1: 0, n: 2 });
    const disp: DisplayState = { pos: [1, 2, 3, 4, 5], inn: [1, 1, 1, 0.5, 0.2], sigma: 0, ovf: 0, reel: [] };
    expect(mk({ A0: 321, A1: 9, display: disp }).n).toBe(5);
  });

  it('starts exactly on the rest state and ends exactly on the target', () => {
    const pl = mk({ A0: 5, A1: 120 });
    const s0 = sample(pl, 0);
    expect(Array.from(s0.pos, (x) => mod10(x))).toEqual([5, 0, 0]);
    expect(Array.from(s0.inn)).toEqual([1, 0, 0]);
    // §5.5: at speed the tens would be planned ahead (0.5); the remap anchors it on the display
    const s1 = sample(pl, 1);
    expect(shown(s1)).toBe('120');
    expect(s1.A).toBe(120);
    expect(Array.from(s1.lead)).toEqual([0, 0, 0]);
    // continuous from rest: no jump in the first frame
    const f1 = sample(pl, 16 / 400);
    for (let k = 0; k < 3; k++) expect(Math.abs(wrap5(f1.pos[k] - s0.pos[k]))).toBeLessThan(2.5);
  });

  it('reuses the out buffers (allocation-free per frame) and resizes them only for a new n', () => {
    const pl = mk({ A0: 0, A1: 1000 });
    const out = sample(pl, 0);
    const { pos, inn, lead, reel } = out;
    for (let i = 1; i <= 10; i++) {
      const s = sample(pl, i / 10, out);
      expect(s).toBe(out);
      expect(s.pos).toBe(pos);
      expect(s.inn).toBe(inn);
      expect(s.lead).toBe(lead);
      expect(s.reel).toBe(reel);
    }
    const other = mk({ A0: 0, A1: 10 });
    const s = sample(other, 0.5, out);
    expect(s).toBe(out);
    expect(s.pos).toHaveLength(2);
    expect(s.pos).not.toBe(pos);
  });

  it('clamps p to [0, 1]', () => {
    const pl = mk({ A0: 0, A1: 50 });
    expect(sample(pl, -1).A).toBe(0);
    expect(sample(pl, Number.NaN).A).toBe(0);
    expect(sample(pl, 2).A).toBe(50);
  });

  it('leading places: 99→100 rolls the hundreds in from blank, lead until it lands', () => {
    const fs = frames(mk({ A0: 99, A1: 100 }));
    expect(fs[0].inn[2]).toBe(0);
    expect(fs[1].inn[2]).toBeCloseTo(0.115, 3);
    expect(fs[1].lead[2]).toBe(1);
    for (let i = 1; i < fs.length; i++) expect(fs[i].inn[2]).toBeGreaterThanOrEqual(fs[i - 1].inn[2]);
    expect(fs[fs.length - 1].lead[2]).toBe(0);
    expect(shown(fs[fs.length - 1])).toBe('100');
  });

  it('pad places are never leading; fraction places are always present', () => {
    for (const fs of frames(mk({ A0: 5, A1: 7, pad: 3 }))) {
      expect(Array.from(fs.lead)).toEqual([0, 0, 0]);
      expect(Array.from(fs.inn)).toEqual([1, 1, 1]);
    }
    const f2 = mk({ A0: 125, A1: 350, f: 2 });
    expect(f2.n).toBe(3);
    expect(shown(sample(f2, 1))).toBe('350');
  });

  it('count reels are a contiguous low-order set that lands exactly (0 → 9,876,543)', () => {
    const pl = mk({ A0: 0, A1: 9876543 });
    const mid = sample(pl, 0.3);
    const reels = Array.from(mid.reel);
    const firstExact = reels.indexOf(0);
    expect(firstExact).toBeGreaterThan(0);
    expect(reels.slice(firstExact).every((r) => r === 0)).toBe(true);
    expect(shown(sample(pl, 1))).toBe('9876543');
  });

  it('roll plans report no reels and roll forward through the wrap cell (19 → 20)', () => {
    const pl = mk({ kind: 'roll', A0: 19, A1: 20 });
    const fs = frames(pl);
    for (const f of fs) expect(Array.from(f.reel)).toEqual([0, 0]);
    // units 9 → 10 (≡ 0) forward
    for (let i = 1; i < fs.length; i++) expect(fs[i].pos[0]).toBeGreaterThanOrEqual(fs[i - 1].pos[0]);
    expect(fs[fs.length - 1].pos[0]).toBeCloseTo(10, 9);
    expect(shown(fs[fs.length - 1])).toBe('20');
  });

  it('roll: entering and leaving places fade linearly with q; the sign follows q', () => {
    const up = mk({ kind: 'roll', A0: 99, A1: 100 });
    const mid = sample(up, 0.5);
    expect(mid.inn[2]).toBeCloseTo(Math.min(1, ROLL_E.fn(0.5)), 12);
    expect(mid.lead[2]).toBe(1);
    const down = mk({ kind: 'roll', A0: 100, A1: 99 });
    expect(sample(down, 0.5).inn[2]).toBeCloseTo(Math.max(0, 1 - ROLL_E.fn(0.5)), 12);
    const sign = mk({ kind: 'roll', A0: 5, A1: -5 });
    expect(sample(sign, 0).sigma).toBe(0);
    expect(sample(sign, 0.3).sigma).toBeCloseTo(Math.min(1, ROLL_E.fn(0.3)), 12);
    expect(sample(sign, 1).sigma).toBe(1);
  });

  it('max 0: every non-zero value overflows, A stays 0, no NaN', () => {
    const pl = mk({ A0: 0, A1: 5, Amax: 0 });
    for (const f of frames(pl)) {
      expect(f.A).toBe(0);
      expect(Number.isFinite(f.ovf)).toBe(true);
    }
    expect(sample(pl, 1).ovf).toBe(1);
  });

  it('guards degenerate inputs (peak 0, non-positive D) without NaN', () => {
    const flat: Easing = { fn: (p) => p, peak: 0 };
    const disp: DisplayState = { pos: [3, 7, 1, 0, 0, 0], inn: [1, 1, 1, 1, 0, 0], sigma: 0, ovf: 0, reel: [true, true, true, false, false, false] };
    const pl = plan({ kind: 'count', A0: 1735, A1: 100000, Amax: Infinity, f: 0, pad: 1, D: 0, E: flat, display: disp, prevKind: 'count' });
    for (let i = 0; i <= 10; i++) {
      const s = sample(pl, i / 10);
      for (const x of s.pos) expect(Number.isFinite(x)).toBe(true);
      for (const x of s.inn) expect(Number.isFinite(x)).toBe(true);
    }
    expect(shown(sample(pl, 1))).toBe('100000');
  });
});

describe('velocity', () => {
  it('is (A1 − A0)·E′(p)/D for count plans and 0 for roll plans', () => {
    const lin = mk({ A0: 0, A1: 400, E: ease('linear') });
    expect(velocity(lin, 0.5)).toBeCloseTo(1, 9);
    const c = mk({ A0: 100, A1: 0 });
    expect(velocity(c, 0)).toBeCloseTo((-100 * 3) / 400, 3);
    expect(velocity(c, 0.3)).toBeCloseTo((-100 * slopeAt(COUNT_E, 0.3)) / 400, 12);
    expect(velocity(mk({ kind: 'roll', A0: 0, A1: 100 }), 0.3)).toBe(0);
    expect(velocity(mk({ A0: 7, A1: 7 }), 0.3)).toBe(0);
  });

  it('is 0 where the count clamp flattens an overshooting easing', () => {
    const backOut = ease((p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2);
    const pl = mk({ A0: 0, A1: 100, E: backOut });
    expect(backOut.fn(0.8)).toBeGreaterThan(1);
    expect(velocity(pl, 0.8)).toBe(0);
    expect(velocity(pl, 0.2)).toBeGreaterThan(0);
  });
});

describe('(k) overshooting easings', () => {
  const overshooting: Array<[string, Easing]> = [
    ['cubic-bezier(0.3, -0.6, 0.7, 1.6)', ease('cubic-bezier(0.3, -0.6, 0.7, 1.6)')],
    ['back-in', ease((p) => 2.70158 * p ** 3 - 1.70158 * p ** 2)],
    ['back-out', ease((p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2)],
    ['1.2 at 0.8', ease((p) => (p <= 0.8 ? 1.5 * p : 1.2 - (p - 0.8)))]
  ];

  it('the reference functions really overshoot', () => {
    const [, css] = overshooting[0];
    const range = (e: Easing) => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i <= 200; i++) {
        lo = Math.min(lo, e.fn(i / 200));
        hi = Math.max(hi, e.fn(i / 200));
      }
      return [lo, hi];
    };
    expect(range(css)[0]).toBeLessThan(0);
    expect(range(css)[1]).toBeGreaterThan(1);
    expect(range(overshooting[1][1])[0]).toBeLessThan(0);
    expect(range(overshooting[2][1])[1]).toBeGreaterThan(1);
    expect(overshooting[3][1].fn(0.8)).toBeCloseTo(1.2, 12);
  });

  /** Count plans: A ∈ [min(A0,A1), max(A0,A1)], |A| ≤ Amax, sigma ≡ 0 without a negative endpoint, no place beyond n. */
  function checkCount(pl: Plan, f: number, pad: number, Amax: number, A1raw: number): void {
    const lo = Math.min(pl.A0, pl.A1);
    const hi = Math.max(pl.A0, pl.A1);
    const bad: string[] = [];
    const out = sample(pl, 0);
    for (let i = 0; i <= 120; i++) {
      const s = sample(pl, i / 120, out);
      const where = `${pl.A0}→${A1raw} max=${Amax} f=${f} pad=${pad} p=${i / 120}`;
      if (!(s.q >= 0 && s.q <= 1)) bad.push(`q ${s.q} ${where}`);
      if (s.A < lo || s.A > hi) bad.push(`A ${s.A} ${where}`);
      if (Math.abs(s.A) > Amax) bad.push(`|A| > Amax ${where}`);
      if (pl.A0 >= 0 && pl.A1 >= 0 && s.sigma !== 0) bad.push(`sigma ${s.sigma} ${where}`);
      if (colCount(Math.abs(s.A), f, pad) > pl.n) bad.push(`place beyond n ${where}`);
      if (!s.inn.every((x) => x >= 0 && x <= 1) || !(s.ovf >= 0 && s.ovf <= 1)) bad.push(`presence ${where}`);
    }
    const end = sample(pl, 1);
    const M1 = Math.min(Math.abs(A1raw), Amax);
    for (let k = 0; k < pl.n; k++) if (Math.abs(wrap5(end.pos[k] - digit(M1, k))) > 1e-9) bad.push(`end k=${k} ${pl.A0}→${A1raw}`);
    expect(bad).toEqual([]);
  }

  it.each(overshooting)('%s on count plans: 95→99, 0→5 and random cases stay in range', (_name, E) => {
    checkCount(mk({ A0: 95, A1: 99, E }), 0, 1, Infinity, 99);
    checkCount(mk({ A0: 0, A1: 5, E }), 0, 1, Infinity, 5);
    checkCount(mk({ A0: 5, A1: 0, E }), 0, 1, Infinity, 0);
    checkCount(mk({ A0: 90, A1: 150, Amax: 99, E }), 0, 1, 99, 150);
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 48271) >>> 0) % 2147483647) / 2147483647);
    for (let c = 0; c < 200; c++) {
      const f = Math.floor(rnd() * 3);
      const pad = 1 + Math.floor(rnd() * 3);
      const Amax = rnd() < 0.3 ? Math.floor(rnd() * 999) + 1 : Infinity;
      const A0 = Math.round((rnd() * 2 - 0.6) * 10 ** Math.floor(rnd() * 6));
      const A1 = Math.round((rnd() * 2 - 0.6) * 10 ** Math.floor(rnd() * 6));
      checkCount(mk({ A0, A1, Amax, f, pad, E }), f, pad, Amax, A1);
    }
  });

  it.each(overshooting)('%s on roll plans: presence in [0, 1], exact end, the bounce reaches pos', (_name, E) => {
    for (const [A0, A1] of [[17, 22], [99, 100], [100, 99], [5, -5], [-5, 5]]) {
      const pl = mk({ kind: 'roll', A0, A1, E });
      let qMin = 0;
      let qMax = 1;
      for (let i = 0; i <= 120; i++) {
        const s = sample(pl, i / 120);
        qMin = Math.min(qMin, s.q);
        qMax = Math.max(qMax, s.q);
        for (const x of s.inn) expect(x >= 0 && x <= 1).toBe(true);
        expect(s.sigma >= 0 && s.sigma <= 1).toBe(true);
        expect(s.ovf >= 0 && s.ovf <= 1).toBe(true);
        expect(s.A).toBeGreaterThanOrEqual(Math.min(A0, A1));
        expect(s.A).toBeLessThanOrEqual(Math.max(A0, A1));
      }
      expect(qMin < 0 || qMax > 1).toBe(true); // roll keeps the raw E(p)
      const end = sample(pl, 1);
      expect(shown(end)).toBe(String(Math.abs(A1)));
      expect(end.sigma).toBe(A1 < 0 ? 1 : 0);
    }
  });
});

describe('(l) retarget curve', () => {
  it('to an overflowing target (max 99, 90→98 retargeted at p = 0.3 to 150): start velocity continuous within 10%', () => {
    const prev = mk({ A0: 90, A1: 98, Amax: 99 });
    const pPrev = 0.3;
    const now = sample(prev, pPrev);
    const v = velocity(prev, pPrev);
    expect(v).toBeCloseTo(0.0294, 3);
    const curve = retargetCurve(prev, pPrev, now.A, 150, 400);
    const display: DisplayState = {
      pos: Array.from(now.pos, mod10), inn: Array.from(now.inn), sigma: now.sigma, ovf: now.ovf, reel: Array.from(now.reel, Boolean)
    };
    const next = plan({ kind: 'count', A0: now.A, A1: 150, Amax: 99, f: 0, pad: 1, D: curve.D, E: curve.E, display, prevKind: 'count' });
    const v2 = velocity(next, 0);
    expect(Math.abs(v2 - v) / v).toBeLessThan(0.1);
    // the unclamped ΔA (150 − A) would have started ~14× too slow (§5.6)
    const sUnclamped = (v * 400) / (150 - now.A);
    expect(((99 - now.A) * sUnclamped) / 400 / v).toBeLessThan(0.1);
    // continuous junction and exact end on the clamped target
    const s0 = sample(next, 0);
    for (let k = 0; k < next.n; k++) expect(Math.abs(wrap5(s0.pos[k] - display.pos[k]))).toBeLessThan(1e-9);
    const end = sample(next, 1);
    expect(end.A).toBe(99);
    expect(end.ovf).toBe(1);
  });

  it('s > 3 shortens D to 3·ΔA/v (never below 0.4·D) and caps s at 3', () => {
    const prev = mk({ A0: 0, A1: 10000 });
    for (const [p, dA] of [[0.1, 20], [0.1, 2000], [0.05, 1]] as Array<[number, number]>) {
      const now = sample(prev, p);
      const v = velocity(prev, p);
      expect((v * 400) / dA).toBeGreaterThan(3);
      const { E, D } = retargetCurve(prev, p, now.A, now.A + dA, 400);
      const expectedD = Math.max(160, (3 * dA) / v);
      expect(D).toBeCloseTo(expectedD, 9);
      const s = Math.min(3, (v * D) / dA);
      for (let i = 0; i <= 10; i++) expect(E.fn(i / 10)).toBeCloseTo(hermite(s)(i / 10), 12);
      // start velocity is continuous unless the 0.4·D floor applies
      if (D > 160) expect(((dA * slopeAt(E, 0)) / D - v) / v).toBeLessThan(1e-3);
    }
  });

  it('reversals clamp s to −1; count plans flatten the dip (q ≥ 0)', () => {
    const prev = mk({ A0: 0, A1: 1000 });
    const now = sample(prev, 0.12);
    const { E } = retargetCurve(prev, 0.12, now.A, now.A - 40, 400);
    expect(slopeAt(E, 0)).toBeCloseTo(-1, 3);
    const next = plan({ kind: 'count', A0: now.A, A1: Math.round(now.A) - 40, Amax: Infinity, f: 0, pad: 1, D: 400, E, display: null, prevKind: 'count' });
    for (let i = 0; i <= 40; i++) {
      const s = sample(next, i / 40);
      expect(s.A).toBeLessThanOrEqual(now.A);
      expect(s.q).toBeGreaterThanOrEqual(0);
    }
  });

  it('ΔA ≈ 0 and v = 0 give s = 0 (smoothstep) with no NaN', () => {
    const smooth = hermite(0);
    const prev = mk({ A0: 90, A1: 150, Amax: 99 });
    const atMax = sample(prev, 1);
    expect(atMax.A).toBe(99);
    for (const [pl, p, Anow, A1] of [
      [prev, 1, atMax.A, 150], // ΔA = cl(150) − 99 = 0
      [prev, 0.3, sample(prev, 0.3).A, sample(prev, 0.3).A], // ΔA = 0
      [mk({ kind: 'roll', A0: 0, A1: 100 }), 0.3, 40, 500], // v = 0 (roll)
      [mk({ A0: 7, A1: 7 }), 0.5, 7, 70] // v = 0 (no motion)
    ] as Array<[Plan, number, number, number]>) {
      const { E, D } = retargetCurve(pl, p, Anow, A1, 400);
      expect(D).toBe(400);
      expect(Number.isFinite(E.peak)).toBe(true);
      for (let i = 0; i <= 10; i++) {
        expect(Number.isNaN(E.fn(i / 10))).toBe(false);
        expect(E.fn(i / 10)).toBeCloseTo(smooth(i / 10), 12);
      }
    }
  });

  it('keeps a reel a reel across a count → count retarget', () => {
    const prev = mk({ A0: 0, A1: 100000 });
    const now = sample(prev, 0.2);
    expect(now.reel[0]).toBe(1);
    const display: DisplayState = { pos: Array.from(now.pos, mod10), inn: Array.from(now.inn), sigma: 0, ovf: 0, reel: Array.from(now.reel, Boolean) };
    const target = Math.round(now.A) + 3; // a small delta would not need a reel from rest
    const curve = retargetCurve(prev, 0.2, now.A, target, 400);
    const next = plan({ kind: 'count', A0: now.A, A1: target, Amax: Infinity, f: 0, pad: 1, D: curve.D, E: curve.E, display, prevKind: 'count' });
    expect(sample(next, 0.5).reel[0]).toBe(1);
    expect(shown(sample(next, 1))).toBe(String(target));
    // from a roll the flags do not carry
    const fromRoll = plan({ kind: 'count', A0: now.A, A1: target, Amax: Infinity, f: 0, pad: 1, D: 400, E: COUNT_E, display, prevKind: 'roll' });
    expect(sample(fromRoll, 0.5).reel[0]).toBe(0);
  });
});

describe('presets on the count path', () => {
  it('every preset lands exactly on 0→1000 and −50→50', () => {
    for (const name of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      expect(shown(sample(mk({ A0: 0, A1: 1000, E: ease(name) }), 1)), name).toBe('1000');
      const s = sample(mk({ A0: -50, A1: 50, E: ease(name) }), 1);
      expect(shown(s), name).toBe('50');
      expect(s.sigma, name).toBe(0);
    }
  });
});
