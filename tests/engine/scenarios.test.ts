/**
 * Frame scenarios of docs/design/v1.3.md §14.1, replayed deterministically on
 * the pure engine with the driver of the prototype (proto/dom.mjs): frames
 * every 16 ms, t0 = first frame, retargets from the last painted frame,
 * steps measured on positions rounded to 3 decimals (as run.mjs did).
 */
import { describe, expect, it } from 'vitest';
import type { DisplayState, Easing, FrameState, Plan } from '../../src/internal/contracts';
import { plan, retargetCurve, sample } from '../../src/engine/odometer';
import { toEasing } from '../../src/engine/easing';

const mod10 = (x: number) => ((x % 10) + 10) % 10;
const wrap5 = (x: number) => mod10(x + 5) - 5;
const r3 = (x: number) => +x.toFixed(3);
/** `RN_ENGINE_REPORT=1 pnpm vitest run tests/engine` prints the measured metrics. */
const report = (...args: unknown[]): void => {
  if (process.env.RN_ENGINE_REPORT) console.log(...args);
};

const COUNT_E = toEasing('ease-out-cubic') as Easing;
const ROLL_E = toEasing('odometer') as Easing;

interface Entry { A: number; pos: number[]; inn: number[]; sigma: number; ovf: number; reel: boolean[] }

interface SetOpts { mode?: 'count' | 'roll'; D?: number }

/** Driver of proto/dom.mjs on top of the engine (no DOM). */
class Sim {
  readonly f: number;
  readonly pad: number;
  readonly Amax: number;
  A: number;
  pl: Plan | null = null;
  t0: number | null = null;
  lastP = 0;
  t = 0;
  readonly log: Entry[] = [];
  readonly finals: FrameState[] = [];

  constructor({ value = 0, decimals = 0, pad = 1, max = null as number | null } = {}) {
    this.f = decimals;
    this.pad = pad;
    this.Amax = max === null ? Infinity : Math.floor(max * 10 ** decimals);
    this.A = Math.round(value * 10 ** decimals);
  }

  setValue(v: number, { mode = 'count', D = mode === 'count' ? 400 : 500 }: SetOpts = {}): void {
    const A1 = Math.round(v * 10 ** this.f);
    if (this.pl && A1 === this.pl.A1) return; // join
    let A0 = this.A;
    let display: DisplayState | null = null;
    let prevKind: 'count' | 'roll' | null = null;
    let curve = { E: mode === 'count' ? COUNT_E : ROLL_E, D };
    if (this.pl) {
      const s = sample(this.pl, this.lastP);
      A0 = s.A;
      display = { pos: Array.from(s.pos, mod10), inn: Array.from(s.inn), sigma: s.sigma, ovf: s.ovf, reel: Array.from(s.reel, Boolean) };
      prevKind = this.pl.kind;
      if (mode === 'count' && prevKind === 'count') curve = retargetCurve(this.pl, this.lastP, A0, A1, D);
    }
    this.A = A1;
    this.pl = plan({ kind: mode, A0, A1, Amax: this.Amax, f: this.f, pad: this.pad, D: curve.D, E: curve.E, display, prevKind });
    this.t0 = null;
    this.lastP = 0;
  }

  /** One 16 ms frame. */
  step(frames = 1): void {
    for (let i = 0; i < frames; i++) {
      this.t += 16;
      const pl = this.pl;
      if (!pl) continue;
      if (this.t0 === null) this.t0 = this.t;
      const p = Math.min(1, Math.max(0, (this.t - this.t0) / pl.D));
      this.lastP = p;
      if (p >= 1) {
        this.finals.push(sample(pl, 1));
        this.pl = null;
        continue;
      }
      const s = sample(pl, p);
      this.log.push({
        A: r3(s.A), pos: Array.from(s.pos, (x) => r3(mod10(x))), inn: Array.from(s.inn, r3), sigma: r3(s.sigma), ovf: r3(s.ovf),
        // roll columns are direction-agnostic (excluded from backward steps, as in the prototype)
        reel: Array.from(s.reel, (x) => pl.kind === 'roll' || !!x)
      });
    }
  }

  /** Digits shown at rest (sign + digits of the clamped target), from the last settled frame. */
  finalText(): string {
    const fs = this.finals[this.finals.length - 1];
    const M = Math.abs(fs.A);
    let s = '';
    for (let k = fs.pos.length - 1; k >= 0; k--) {
      if (fs.inn[k] < 0.5) continue;
      s += String(Math.round(mod10(fs.pos[k])) % 10);
    }
    expect(Math.abs(fs.A - Math.round(fs.A))).toBe(0);
    expect(M).toBeLessThanOrEqual(this.Amax);
    return (fs.sigma > 0.5 ? '-' : '') + s;
  }
}

interface Metrics { final: string; maxStep: number; backCum: number; sigmaFrames: number; ovfFrames: number; ovfEnd: number }

/** run.mjs analyze(): steps between logged frames, backward on non-reel columns against the |A| direction. */
function analyze(sim: Sim): Metrics {
  const log = sim.log;
  let maxStep = 0;
  const cum: number[] = [];
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1];
    const b = log[i];
    const dir = Math.sign(Math.abs(b.A) - Math.abs(a.A));
    b.pos.forEach((x, k) => {
      if (a.pos[k] === undefined) return;
      const d = wrap5(x - a.pos[k]);
      maxStep = Math.max(maxStep, Math.abs(d));
      if (!b.reel[k] && dir !== 0 && d * dir < -0.002) cum[k] = (cum[k] ?? 0) + Math.abs(d);
    });
  }
  const fs = sim.finals[sim.finals.length - 1];
  return {
    final: sim.finalText(),
    maxStep: r3(maxStep),
    backCum: r3(Math.max(0, ...cum.filter((x) => x !== undefined))),
    sigmaFrames: log.filter((e) => e.sigma > 0.001 && e.sigma < 0.999).length,
    ovfFrames: log.filter((e) => e.ovf > 0.001 && e.ovf < 0.999).length,
    ovfEnd: fs.ovf
  };
}

interface Op { v: number; o?: SetOpts; wait?: number }

function scenario(init: ConstructorParameters<typeof Sim>[0], ops: Op[], frames = 60): Metrics {
  const sim = new Sim(init);
  for (const op of ops) {
    if (op.wait) sim.step(op.wait);
    sim.setValue(op.v, op.o);
  }
  sim.step(frames);
  expect(sim.pl).toBeNull();
  return analyze(sim);
}

function retarget(init: ConstructorParameters<typeof Sim>[0], v0: number, waitFrames: number, delta: number): Metrics & { to: number } {
  const sim = new Sim(init);
  sim.setValue(v0);
  sim.step(waitFrames);
  const to = Math.round(sim.log[sim.log.length - 1].A) + delta;
  sim.setValue(to);
  sim.step(60);
  expect(sim.pl).toBeNull();
  return { ...analyze(sim), to };
}

// [name, metrics, expected final, prototype max step (§14.1 / run.txt), prototype backward cum., sigma frames, ovf frames]
type Row = [string, () => Metrics, string, number, number, number?, number?];

describe('§14.1 count scenarios', () => {
  const rows: Row[] = [
    ['C1 19→20', () => scenario({ value: 19 }, [{ v: 20 }]), '20', 0.115, 0],
    ['C2 99→100', () => scenario({ value: 99 }, [{ v: 100 }]), '100', 0.115, 0],
    ['C3 0→1000', () => scenario({ value: 0 }, [{ v: 1000 }]), '1000', 1.153, 0],
    ['C4 5→−5', () => scenario({ value: 5 }, [{ v: -5 }]), '-5', 1.153, 0, 17],
    ['C5 −50→50', () => scenario({ value: -50 }, [{ v: 50 }]), '50', 1.153, 0, 5],
    ['C6 −1000→1000', () => scenario({ value: -1000 }, [{ v: 1000 }]), '1000', 1.153, 0, 5],
    ['C7 1.25→3.50 (f=2)', () => scenario({ value: 1.25, decimals: 2 }, [{ v: 3.5 }]), '350', 1.729, 0],
    ['C8 0→9,876,543 (reels)', () => scenario({ value: 0 }, [{ v: 9876543 }]), '9876543', 2.075, 0],
    ['C9 1000→995', () => scenario({ value: 1000 }, [{ v: 995 }]), '995', 0.576, 0],
    ['C10 95→150, max 99', () => scenario({ value: 95, max: 99 }, [{ v: 150 }]), '99', 0.461, 0, 0, 20],
    ['C11 150→20, max 99', () => scenario({ value: 150, max: 99 }, [{ v: 20 }]), '20', 2.19, 0, 0, 9],
    ['C12 0→1000 @2000 ms', () => scenario({ value: 0 }, [{ v: 1000, o: { D: 2000 } }], 140), '1000', 0.476, 0]
  ];
  it.each(rows)('%s', (_name, run, final, maxStep, back, sigmaFrames, ovfFrames) => {
    const m = run();
    report(_name, JSON.stringify(m));
    expect(m.final).toBe(final);
    expect(m.maxStep).toBeCloseTo(maxStep, 2);
    expect(m.backCum).toBeLessThanOrEqual(back + 1e-9);
    if (sigmaFrames !== undefined) expect(m.sigmaFrames).toBe(sigmaFrames);
    if (ovfFrames !== undefined) expect(m.ovfFrames).toBe(ovfFrames);
  });
});

describe('§14.1 retarget scenarios', () => {
  const rows: Array<[string, () => Metrics & { to: number }, number, number, number]> = [
    ['R1 0→10000 @80ms → cur+50', () => retarget({ value: 0 }, 10000, 5, 50), 4123, 2.419, 0.071],
    ['R2 0→10000 @80ms → cur+20', () => retarget({ value: 0 }, 10000, 5, 20), 4093, 2.419, 0.071],
    ['R3 0→10000 @80ms → cur+7', () => retarget({ value: 0 }, 10000, 5, 7), 4080, 1.606, 0.071],
    ['R4 0→1000 @64ms → cur+3', () => retarget({ value: 0 }, 1000, 4, 3), 322, 2.389, 0.184],
    ['R5 0→100000 @112ms → cur+130', () => retarget({ value: 0 }, 100000, 7, 130), 56232, 2.003, 0.609],
    ['R6 0→1000 @64ms → cur−40', () => retarget({ value: 0 }, 1000, 4, -40), 279, 1.153, 0],
    ['R7 0→100 @48ms → cur+1', () => retarget({ value: 0 }, 100, 3, 1), 23, 1.153, 0.211],
    ['R8 0→1000 @96ms → cur+1000', () => retarget({ value: 0 }, 1000, 6, 1000), 1488, 1.153, 0],
    ['R9 500→0 @96ms → cur+5', () => retarget({ value: 500 }, 0, 6, 5), 261, 1.153, 0.615],
    ['R10 0→100 @160ms → 300', () => retarget({ value: 0 }, 100, 10, 200), 274, 1.153, 0]
  ];
  it.each(rows)('%s', (_name, run, to, maxStep, back) => {
    const m = run();
    report(_name, JSON.stringify(m));
    expect(m.to).toBe(to);
    expect(m.final).toBe(String(to));
    expect(m.maxStep).toBeLessThanOrEqual(maxStep + 0.002);
    expect(m.backCum).toBeLessThanOrEqual(back + 0.002);
  });

  it('R11 8 rapid +1 clicks, 48 ms apart', () => {
    const sim = new Sim({ value: 0 });
    for (let i = 1; i <= 8; i++) {
      sim.setValue(i);
      sim.step(3);
    }
    sim.step(50);
    const m = analyze(sim);
    report('R11', JSON.stringify(m));
    expect(m.final).toBe('8');
    expect(m.maxStep).toBeCloseTo(0.318, 2);
    expect(m.backCum).toBe(0);
  });
});

describe('§14.1 roll scenarios and count↔roll mixes', () => {
  const roll = { mode: 'roll' as const };
  const rows: Row[] = [
    ['L1 roll 17→22', () => scenario({ value: 17 }, [{ v: 22, o: roll }]), '22', 0.776, 0],
    ['L2 roll 99→100', () => scenario({ value: 99 }, [{ v: 100, o: roll }]), '100', 0.155, 0],
    ['L3 roll 100→99', () => scenario({ value: 100 }, [{ v: 99, o: roll }]), '99', 0.155, 0],
    ['L4 roll 5→−5', () => scenario({ value: 5 }, [{ v: -5, o: roll }]), '-5', 0, 0, 24],
    ['L5 roll retarget 10→90 @80ms → 20', () => scenario({ value: 10 }, [{ v: 90, o: roll }, { wait: 5, v: 20, o: roll }]), '20', 1.241, 0],
    ['X1 count→roll 0→1000 @80ms roll→500', () => scenario({ value: 0 }, [{ v: 1000 }, { wait: 5, v: 500, o: roll }]), '500', 1.153, 0],
    ['X2 roll→count 0→90 @80ms count→300', () => scenario({ value: 0 }, [{ v: 90, o: roll }, { wait: 5, v: 300 }]), '300', 1.75, 0]
  ];
  it.each(rows)('%s', (_name, run, final, maxStep, back, sigmaFrames) => {
    const m = run();
    report(_name, JSON.stringify(m));
    expect(m.final).toBe(final);
    expect(m.maxStep).toBeCloseTo(maxStep, 2);
    expect(m.backCum).toBeLessThanOrEqual(back + 1e-9);
    if (sigmaFrames !== undefined) expect(m.sigmaFrames).toBe(sigmaFrames);
  });

  it('roll 17→22 before the first frame: positions pinned on the display (crit-B H4)', () => {
    const pl = plan({ kind: 'roll', A0: 17, A1: 22, Amax: Infinity, f: 0, pad: 1, D: 500, E: ROLL_E, display: null, prevKind: null });
    const s = sample(pl, 0);
    expect(Array.from(s.pos)).toEqual([7, 1]);
    expect(Array.from(s.inn)).toEqual([1, 1]);
  });
});

describe('§14.1 frame dumps', () => {
  it('99→100: the hundreds column rolls in from blank (frames-99-100.json)', () => {
    const sim = new Sim({ value: 99 });
    sim.setValue(100);
    sim.step(8);
    const expected = [
      [99, [9, 9, 0], [1, 1, 0]],
      [99.115, [9.115, 9.115, 0.115], [1, 1, 0.115]],
      [99.221, [9.221, 9.221, 0.221], [1, 1, 0.221]],
      [99.319, [9.319, 9.319, 0.319], [1, 1, 0.319]],
      [99.407, [9.407, 9.407, 0.407], [1, 1, 0.407]],
      [99.488, [9.488, 9.488, 0.488], [1, 1, 0.488]],
      [99.561, [9.561, 9.561, 0.561], [1, 1, 0.561]],
      [99.627, [9.627, 9.627, 0.627], [1, 1, 0.627]]
    ];
    expect(sim.log.map((e) => [e.A, e.pos, e.inn])).toEqual(expected);
  });

  it('−50→50: the sign fades over 5 frames (frames-sign.json)', () => {
    const sim = new Sim({ value: -50 });
    sim.setValue(50);
    sim.step(30);
    expect(sim.log.slice(0, 8).map((e) => [e.A, e.sigma])).toEqual([
      [-50, 1], [-38.474, 0.769], [-27.869, 0.557], [-18.147, 0.363], [-9.27, 0.185], [-1.2, 0.024], [6.102, 0], [12.675, 0]
    ]);
    expect(sim.log).toHaveLength(25);
    expect(sim.finals[0].A).toBe(50);
  });
});
