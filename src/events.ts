/**
 * The `rn-start` / `rn-end` event types and their `ElementEventMap`
 * augmentation. Types only, re-exported by `types.ts`. They need the DOM
 * typings (`CustomEvent`), so the DOM-free `rolling-number/ssr` entry never
 * references this module.
 *
 * @module
 */

/** `detail` of `rn-start` and `rn-end`. */
export interface RollingNumberEventDetail {
  /** Target value of the motion (normalized). */
  value: number;
  /** Value on screen when the motion started (user units, may be fractional). */
  from: number;
  /** `false` for instant changes (reduced motion, `motion: 'none'`, duration 0, no rAF). */
  animated: boolean;
}

/** `rn-start` / `rn-end` event: bubbles and is composed (crosses shadow roots). */
export type RollingNumberEvent = CustomEvent<RollingNumberEventDetail>;

/** Events dispatched on the host of a counter. */
export interface RollingNumberEventMap {
  /** The display starts moving from rest (also for instant changes). Not re-fired on retargets. */
  'rn-start': RollingNumberEvent;
  /** The display settled on the final target; the DOM is final, promises resolve right after. */
  'rn-end': RollingNumberEvent;
}

declare global {
  // Typed listeners on any host, HTML or SVG: el.addEventListener('rn-end', (e) => e.detail.value)
  interface ElementEventMap extends RollingNumberEventMap {}
}
