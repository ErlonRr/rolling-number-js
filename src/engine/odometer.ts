/**
 * Pure odometer math: plans, frame sampling, rest states and retarget curves
 * (docs/design/v1.3.md §5, §3.3). Owned by WP1. WP0 stub: final signatures.
 *
 * @internal
 * @module
 */
import type { DisplayState, Easing, FrameState, Plan, PlanInput } from '../internal/contracts';

function notImplemented(name: string): never {
  throw new Error(`[RollingNumber] engine/odometer.${name}: not implemented yet (WP1)`);
}

/** Builds the per-place constants of a motion (§5.2–§5.7). */
export function plan(input: PlanInput): Plan {
  void input;
  return notImplemented('plan');
}

/** Channels at raw progress `p` ∈ [0, 1] (count plans clamp `q = E(p)` to [0, 1]). */
export function sample(plan: Plan, p: number, out?: FrameState): FrameState {
  void plan; void p; void out;
  return notImplemented('sample');
}

/** dA/dt in units/ms at progress `p` (0 for roll plans). */
export function velocity(plan: Plan, p: number): number {
  void plan; void p;
  return notImplemented('velocity');
}

/** Velocity-continuous curve for a count → count retarget (§5.6). `A1` is clamped inside. */
export function retargetCurve(prev: Plan, pPrev: number, Anow: number, A1: number, D: number): { E: Easing; D: number } {
  void prev; void pPrev; void Anow; void A1; void D;
  return notImplemented('retargetCurve');
}

/** Display channels of a counter at rest on `A`. */
export function restState(A: number, Amax: number, f: number, pad: number, n: number): DisplayState {
  void A; void Amax; void f; void pad; void n;
  return notImplemented('restState');
}

/** Number of digit places shown for magnitude `M` (last-digit units). */
export function colCount(M: number, f: number, pad: number): number {
  void M; void f; void pad;
  return notImplemented('colCount');
}
