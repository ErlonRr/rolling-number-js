/**
 * Pure odometer math: plans, frame sampling, rest states and retarget curves
 * (docs/design/v1.3.md §5, §3.3). Owned by WP1. Port of the verified
 * prototype (§14) with the revision-2 fixes of §15: count plans clamp
 * q = E(p) to [0, 1]; the sign channel is ≡ 0 without a negative endpoint;
 * the retarget ΔA uses the clamped target.
 *
 * Units (§5.1): A is a signed scalar in last-digit units, M = |A| clamped
 * by Amax, place k = 0 is the last displayed digit, P_k = 10^k.
 *
 * @internal
 * @module
 */
import type { DisplayState, Easing, FrameState, Plan, PlanInput } from '../internal/contracts';
import { hermite, peakSlope, slopeAt } from './easing';

/** Minimum carry duration at peak speed (ms). */
const TAU = 40;
/** Sign / overflow fade window at peak speed (ms). */
const TAU_S = 100;
/** Reel speed budget (cells/ms). */
const V_MAX = 0.04;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);
const mod10 = (x: number): number => ((x % 10) + 10) % 10;
const wrap5 = (x: number): number => mod10(x + 5) - 5;
/** Clamped scalar `cl(A) = sgn(A)·min(|A|, Amax)`. */
const cl = (a: number, Amax: number): number => Math.sign(a) * Math.min(Math.abs(a), Amax);

/** Exact powers of ten (repeated multiplication is exact up to 10^22). */
const POW10: number[] = [1];
function pow10(k: number): number {
  while (POW10.length <= k) POW10.push(POW10[POW10.length - 1] * 10);
  return POW10[k];
}

/** Internal shape of a plan: the public {@link Plan} plus per-place constants and remap anchors. */
interface PlanImpl extends Plan {
  Amax: number;
  f: number;
  pad: number;
  M0: number;
  M1: number;
  cross: boolean;
  /** some endpoint is negative (count sign channel active) */
  signOn: boolean;
  /** sign fade window (units) */
  Ws: number;
  /** overflow fade window (units) and its linear fallback */
  Wo: number;
  oLinear: boolean;
  P: Float64Array;
  W: Float64Array;
  gap1: Float64Array;
  /** count: place is a reel; roll: unused (every place is driven by start/travel) */
  isReel: Uint8Array;
  start: Float64Array;
  travel: Float64Array;
  /** roll: place present at the start / at the end */
  was: Uint8Array;
  will: Uint8Array;
  s0pos: Float64Array;
  s1pos: Float64Array;
  d0pos: Float64Array;
  s0inn: Float64Array;
  s1inn: Float64Array;
  d0inn: Float64Array;
  s0sig: number;
  s1sig: number;
  d0sig: number;
  s0ovf: number;
  s1ovf: number;
  d0ovf: number;
}

/**
 * Unbounded gear position of place k (P = 10^k > 1) for magnitude m with
 * carry window W: `⌊m/P⌋ + clamp(1 − (P − m mod P)/W, 0, 1)`. W = 1 is the
 * classic gear, W = P is analog.
 */
function gear(m: number, P: number, W: number): number {
  const base = Math.floor(m / P);
  const rem = m - base * P;
  return base + clamp(1 - (P - rem) / W, 0, 1);
}

/** `X(m, k, W)` of §5.2 (k = 0 is m itself). */
function X(m: number, k: number, P: number, W: number): number {
  return k === 0 ? m : gear(m, P, W);
}

/** Remaining path R (§5.2). */
function remaining(pl: PlanImpl, A: number, M: number): number {
  return pl.cross && Math.sign(A) === Math.sign(pl.A0) && A !== 0 ? M + pl.M1 : Math.abs(pl.M1 - M);
}

/** Windowed-carry exact position of place k (§5.2). */
function exactAt(pl: PlanImpl, k: number, M: number, R: number): number {
  if (k === 0) return M;
  const P = pl.P[k];
  const Weff = clamp(Math.min(pl.W[k], pl.gap1[k] + R), 1, P);
  return gear(M, P, Weff);
}

/** Leading-zero place of a count plan at magnitude M (§5.4): integer place j = k − f ≥ pad and M < 10^k. */
function countLead(pl: PlanImpl, k: number, M: number): boolean {
  return k - pl.f >= pl.pad && M < pl.P[k];
}

/** Raw (un-remapped) sign presence. */
function rawSigma(pl: PlanImpl, q: number, A: number): number {
  if (pl.kind === 'roll') {
    const s0 = pl.A0 < 0 ? 1 : 0;
    const s1 = pl.A1 < 0 ? 1 : 0;
    return s0 + (s1 - s0) * q;
  }
  return pl.signOn ? clamp(-A / pl.Ws, 0, 1) : 0;
}

/** Raw (un-remapped) overflow presence, driven on the clamped magnitude M (§5.4). */
function rawOvf(pl: PlanImpl, q: number, M: number): number {
  if (pl.o0 === pl.o1) return pl.o0;
  if (pl.kind === 'roll' || pl.oLinear) return pl.o0 + (pl.o1 - pl.o0) * q;
  // (M − (Amax − Wo))/Wo, written so that M = Amax gives exactly 1
  return clamp((M - pl.Amax + pl.Wo) / pl.Wo, 0, 1);
}

/**
 * Remap from the displayed state (§5.5): exact when the plan starts on the
 * display, affine for monotone (non-crossing) plans, a decaying offset
 * otherwise. `v` is the raw value at q, `a`/`b` the raw values at q = 0 / 1,
 * `d0` the displayed value.
 */
function remap(v: number, a: number, b: number, d0: number, q: number, mono: boolean): number {
  const off = d0 - a;
  if (Math.abs(off) < 1e-9) return v;
  if (mono && Math.abs(b - a) > 1e-9) return b + (d0 - b) * (1 - (v - a) / (b - a));
  return v + off * (1 - q);
}

/** Display scalar at eased progress q ∈ [0, 1] (exact at both ends). */
function scalarAt(pl: PlanImpl, q: number): number {
  return q >= 1 ? pl.A1 : pl.A0 + (pl.A1 - pl.A0) * q;
}

/** Number of digit places shown for magnitude `M` (last-digit units): `max(pad, integer digits) + f`. */
export function colCount(M: number, f: number, pad: number): number {
  const i = Math.floor(Math.abs(M) / pow10(f));
  let d = 1;
  for (let p = 10; p <= i && d < 400; p *= 10) d++;
  return Math.max(pad, d) + f;
}

/**
 * Display channels of a counter at rest on `A` (UNclamped; it is clamped by
 * `Amax` here): exact digits, the places of `colCount` present, sign and
 * overflow presence. Exactly `n` places.
 */
export function restState(A: number, Amax: number, f: number, pad: number, n: number): DisplayState {
  const c = cl(A, Amax);
  const M = Math.abs(c);
  const n0 = colCount(M, f, pad);
  const size = n > 0 ? Math.floor(n) : 0;
  const pos = new Float64Array(size);
  const inn = new Float64Array(size);
  const reel: boolean[] = [];
  for (let k = 0; k < size; k++) {
    pos[k] = Math.floor(M / pow10(k)) % 10;
    inn[k] = k < n0 ? 1 : 0;
    reel.push(false);
  }
  return { pos, inn, sigma: c < 0 ? 1 : 0, ovf: Math.abs(A) > Amax ? 1 : 0, reel };
}

/**
 * Builds the per-place constants of a motion (§5.2–§5.7) and anchors it on
 * the displayed channels (`display`, or the rest state of `A0`).
 */
export function plan(input: PlanInput): Plan {
  const kind = input.kind;
  const f = input.f;
  const pad = input.pad;
  const Amax = input.Amax >= 0 ? input.Amax : Infinity;
  const D = input.D > 0 && Number.isFinite(input.D) ? input.D : 1;
  const E: Easing = input.E;
  const Ep = E.peak > 0 && Number.isFinite(E.peak) ? E.peak : 1;
  const o0: 0 | 1 = Math.abs(input.A0) > Amax ? 1 : 0;
  const o1: 0 | 1 = Math.abs(input.A1) > Amax ? 1 : 0;
  const A0 = cl(input.A0, Amax);
  const A1 = cl(input.A1, Amax);
  const M0 = Math.abs(A0);
  const M1 = Math.abs(A1);
  const cross = A0 * A1 < 0;
  const display = input.display;
  const n = Math.max(colCount(M0, f, pad), colCount(M1, f, pad), display ? display.pos.length : 0);
  const disp = display ?? restState(input.A0, Amax, f, pad, n);

  const vPeak = (Math.abs(A1 - A0) * Ep) / D; // units/ms
  const L = (V_MAX * D) / Ep; // reel travel budget (cells)

  // Sign window: only negative endpoints cap it (each cap at least 1 unit).
  let negCap = Infinity;
  if (A0 < 0) negCap = Math.min(negCap, Math.max(1, -A0));
  if (A1 < 0) negCap = Math.min(negCap, Math.max(1, -A1));
  if (negCap === Infinity) negCap = 1;
  // Overflow window: when exactly one endpoint overflows, capped by the other endpoint's distance to Amax.
  const dist = Amax - (o1 ? M0 : M1);

  const pl: PlanImpl = {
    kind, n, D, E, A0, A1, o0, o1, Amax, f, pad, M0, M1, cross,
    signOn: A0 < 0 || A1 < 0,
    Ws: clamp(vPeak * TAU_S, 1, negCap),
    Wo: clamp(vPeak * TAU_S, 1, Math.max(1, dist)),
    oLinear: o0 !== o1 && dist < 1,
    P: new Float64Array(n),
    W: new Float64Array(n),
    gap1: new Float64Array(n),
    isReel: new Uint8Array(n),
    start: new Float64Array(n),
    travel: new Float64Array(n),
    was: new Uint8Array(n),
    will: new Uint8Array(n),
    s0pos: new Float64Array(n),
    s1pos: new Float64Array(n),
    d0pos: new Float64Array(n),
    s0inn: new Float64Array(n),
    s1inn: new Float64Array(n),
    d0inn: new Float64Array(n),
    s0sig: 0, s1sig: 0, d0sig: 0, s0ovf: 0, s1ovf: 0, d0ovf: 0
  };

  for (let k = 0; k < n; k++) {
    const P = pow10(k);
    pl.P[k] = P;
    pl.W[k] = clamp(vPeak * TAU, 1, P);
    pl.gap1[k] = P - (M1 - Math.floor(M1 / P) * P);
    const sd = k < disp.pos.length ? Number(disp.pos[k]) : 0;
    const s = Number.isFinite(sd) ? sd : 0;

    if (kind === 'roll') {
      // §5.7: forward (or backward) to the target digit through the wrap cell.
      const d1 = Math.floor(M1 / P) % 10;
      let dir = Math.sign(M1 - M0);
      if (dir === 0) dir = Math.sign(wrap5(d1 - s)) || 1;
      pl.start[k] = s;
      pl.travel[k] = dir * mod10(dir * (d1 - s));
      pl.was[k] = k - f < pad || M0 >= P ? 1 : 0;
      pl.will[k] = k - f < pad || M1 >= P ? 1 : 0;
      continue;
    }

    // §5.3: speed-limited reels (a reel stays a reel on a count → count retarget).
    const T = cross ? X(M0, k, P, 1) + X(M1, k, P, 1) : Math.abs(X(M1, k, P, 1) - X(M0, k, P, 1));
    const wasReel = input.prevKind === 'count' && display !== null && k < display.reel.length && !!display.reel[k];
    if (wasReel || T > Math.max(10, L)) {
      const dir = Math.sign(M1 - M0) || 1;
      const r = mod10(dir * (X(M1, k, P, 1) - s));
      const nRev = wasReel
        ? Math.max(0, Math.floor((L - r) / 10))
        : clamp(Math.floor((L - r) / 10), 1, Math.max(1, Math.floor(T / 10)));
      pl.isReel[k] = 1;
      pl.start[k] = s;
      pl.travel[k] = dir * (r + 10 * nRev);
    }
  }

  // §5.5 anchors: raw channels at q = 0 and q = 1, and the displayed values.
  const R0 = remaining(pl, A0, M0);
  const R1 = remaining(pl, A1, M1);
  for (let k = 0; k < n; k++) {
    if (kind === 'roll') {
      pl.s0pos[k] = pl.start[k];
      pl.s1pos[k] = pl.start[k] + pl.travel[k];
      pl.d0pos[k] = pl.start[k];
      const w0 = pl.was[k];
      const w1 = pl.will[k];
      pl.s0inn[k] = w0 === w1 ? w0 : w1 ? 0 : 1;
      pl.s1inn[k] = w0 === w1 ? w0 : w1 ? 1 : 0;
    } else {
      const e0 = exactAt(pl, k, M0, R0);
      const e1 = exactAt(pl, k, M1, R1);
      if (pl.isReel[k]) {
        pl.s0pos[k] = pl.start[k];
        pl.s1pos[k] = pl.start[k] + pl.travel[k];
        pl.d0pos[k] = pl.start[k];
      } else {
        pl.s0pos[k] = e0;
        pl.s1pos[k] = e1;
        const dp = k < disp.pos.length ? Number(disp.pos[k]) : NaN;
        pl.d0pos[k] = Number.isFinite(dp) ? e0 + wrap5(dp - e0) : e0;
      }
      pl.s0inn[k] = countLead(pl, k, M0) ? clamp01(e0) : 1;
      pl.s1inn[k] = countLead(pl, k, M1) ? clamp01(e1) : 1;
    }
    const di = k < disp.inn.length ? Number(disp.inn[k]) : 0;
    pl.d0inn[k] = Number.isFinite(di) ? di : 0;
  }
  pl.s0sig = rawSigma(pl, 0, A0);
  pl.s1sig = rawSigma(pl, 1, A1);
  pl.d0sig = Number.isFinite(disp.sigma) ? disp.sigma : pl.s0sig;
  pl.s0ovf = rawOvf(pl, 0, M0);
  pl.s1ovf = rawOvf(pl, 1, M1);
  pl.d0ovf = Number.isFinite(disp.ovf) ? disp.ovf : pl.s0ovf;
  return pl;
}

/** Returns `out` with buffers of length n (reallocated only when the size changes), or a new FrameState. */
function frameBuffers(out: FrameState | undefined, n: number): FrameState {
  if (!out) {
    return {
      q: 0, A: 0, pos: new Float64Array(n), inn: new Float64Array(n),
      lead: new Uint8Array(n), reel: new Uint8Array(n), sigma: 0, ovf: 0
    };
  }
  if (out.pos.length !== n) out.pos = new Float64Array(n);
  if (out.inn.length !== n) out.inn = new Float64Array(n);
  if (out.lead.length !== n) out.lead = new Uint8Array(n);
  if (out.reel.length !== n) out.reel = new Uint8Array(n);
  return out;
}

/**
 * Channels at raw progress `p` ∈ [0, 1] (clamped). Count plans use
 * q = clamp(E(p), 0, 1), so A stays in [min(A0, A1), max(A0, A1)] even with
 * overshooting easings; roll plans keep the raw E(p) for `pos` (a bounce is
 * allowed) and clamp the presence channels (and A) to [0, 1] progress.
 * Allocation-free when `out` (with buffers of length `plan.n`) is given.
 */
export function sample(plan: Plan, p: number, out?: FrameState): FrameState {
  const pl = plan as PlanImpl;
  const n = pl.n;
  const fs = frameBuffers(out, n);
  const pp = clamp01(p);
  let q = pl.E.fn(pp);
  if (!Number.isFinite(q)) q = pp;
  const roll = pl.kind === 'roll';
  if (!roll) q = clamp01(q);
  const A = scalarAt(pl, roll ? clamp01(q) : q);
  const M = Math.min(Math.abs(A), pl.Amax);
  const R = remaining(pl, A, M);
  const mono = !pl.cross;
  const pos = fs.pos;
  const inn = fs.inn;
  const lead = fs.lead;
  const reel = fs.reel;
  for (let k = 0; k < n; k++) {
    let innv: number;
    if (roll) {
      pos[k] = pl.start[k] + pl.travel[k] * q;
      const w0 = pl.was[k];
      const w1 = pl.will[k];
      innv = w0 === w1 ? w0 : w1 ? q : 1 - q;
      lead[k] = w0 && w1 ? 0 : 1;
      reel[k] = 0;
    } else {
      const ex = exactAt(pl, k, M, R);
      if (pl.isReel[k]) {
        pos[k] = pl.start[k] + pl.travel[k] * q;
        reel[k] = 1;
      } else {
        pos[k] = remap(ex, pl.s0pos[k], pl.s1pos[k], pl.d0pos[k], q, mono);
        reel[k] = 0;
      }
      const isLead = countLead(pl, k, M);
      lead[k] = isLead ? 1 : 0;
      innv = isLead ? clamp01(ex) : 1;
    }
    inn[k] = clamp01(remap(innv, pl.s0inn[k], pl.s1inn[k], pl.d0inn[k], q, mono));
  }
  fs.q = q;
  fs.A = A;
  fs.sigma = clamp01(remap(rawSigma(pl, q, A), pl.s0sig, pl.s1sig, pl.d0sig, q, mono));
  fs.ovf = clamp01(remap(rawOvf(pl, q, M), pl.s0ovf, pl.s1ovf, pl.d0ovf, q, mono));
  return fs;
}

/**
 * dA/dt in units/ms at progress `p`: `(A1 − A0)·E'(p)/D` for count plans, 0
 * where the count clamp flattens an overshooting easing (E(p) ∉ [0, 1]), and
 * 0 for roll plans.
 */
export function velocity(plan: Plan, p: number): number {
  const pl = plan as PlanImpl;
  if (pl.kind === 'roll' || pl.A1 === pl.A0) return 0;
  const pp = clamp01(p);
  const e = pl.E.fn(pp);
  if (!(e >= 0 && e <= 1)) return 0;
  const v = ((pl.A1 - pl.A0) * slopeAt(pl.E, pp)) / pl.D;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Velocity-continuous curve for a count → count retarget (§5.6):
 * v = velocity(prev, pPrev); ΔA = cl(A1) − Anow (A1 clamped by the plan's
 * Amax); s = v·D/ΔA, shortening D (≥ 0.4·D) when s > 3; s clamped to
 * [−1, 3]; E = hermite(s). |ΔA| < 1e−9 or v = 0 gives s = 0.
 *
 * Count → count only: from a roll (v = 0 here) or from rest the caller uses
 * the user easing (§5.6). Count plans clamp q to [0, 1], so the dip of a
 * reversal (s < 0) is flattened: the display holds, then reverses.
 */
export function retargetCurve(prev: Plan, pPrev: number, Anow: number, A1: number, D: number): { E: Easing; D: number } {
  const pl = prev as PlanImpl;
  const v = velocity(prev, pPrev);
  const dA = cl(A1, pl.Amax) - cl(Anow, pl.Amax);
  let Dn = D;
  let s = 0;
  if (Math.abs(dA) >= 1e-9 && v !== 0) {
    s = (v * Dn) / dA;
    if (s > 3) {
      Dn = Math.max(0.4 * D, (3 * dA) / v);
      s = Math.min(3, (v * Dn) / dA);
    }
    s = Number.isFinite(s) ? clamp(s, -1, 3) : 0;
    if (!(Dn > 0)) Dn = D;
  }
  const fn = hermite(s);
  return { E: { fn, peak: peakSlope(fn) }, D: Dn };
}
