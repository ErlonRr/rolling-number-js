import './rolling-number.css';
import type {
  RollingNumberEventDetail,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberUpdate
} from './types';
import type { NormalizedOptions, OptionKey } from './internal/contracts';
import {
  OPTION_KEYS,
  normalizeField,
  normalizeInterpolate,
  normalizeMax,
  normalizeMaxExact,
  normalizePad,
  normalizeValue,
  resolveOptions,
  toNumber
} from './options';

export type { RollingNumberOptions, RollingNumberUpdate } from './types';

/**
 * Default values of the five 1.x options:
 * `{ value: 0, pad: 1, max: null, interpolate: true, duration: 400 }`.
 *
 * Compatibility shim kept with its 1.2 shape; 1.3 code uses the internal
 * `RN_DEFAULTS_13` (every option, `null` = auto).
 */
export const RN_DEFAULTS: Readonly<{
  value: number;
  pad: number;
  max: number | null;
  interpolate: boolean;
  duration: number;
}> = Object.freeze({ value: 0, pad: 1, max: null, interpolate: true, duration: 400 });

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hosts whose children are never rendered (void, replaced or form elements). */
const UNSUPPORTED_HOSTS = new Set([
  'input', 'textarea', 'select', 'option', 'img', 'br', 'hr',
  'video', 'audio', 'canvas', 'iframe', 'svg'
]);

/** Live core instance per host element (one core per host). */
const instances = new WeakMap<Element, RollingNumberCore>();

/** Hosts that already received the unsupported-host warning. */
const warnedHosts = new WeakSet<Element>();

/**
 * Rounds symmetrically around zero (-1.5 → -2, 1.5 → 2), as the display does.
 */
function toDisplayInteger(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Runs `fn` in a microtask (Promise fallback for old engines). */
const microtask: (fn: () => void) => void =
  typeof queueMicrotask === 'function' ? (fn) => queueMicrotask(fn) : (fn) => void Promise.resolve().then(fn);

/**
 * Normalizes the five 1.x options of a (possibly partial or loosely typed)
 * options object. Missing, undefined or null fields fall back to `RN_DEFAULTS`.
 *
 * - `value`: non-finite → 0, magnitude clamped to `Number.MAX_SAFE_INTEGER`.
 * - `pad`: non-finite or < 1 → 1, floored, clamped to 64.
 * - `max`: null, '', non-finite or negative → null, otherwise floored.
 * - `interpolate`: null/undefined → true, the string 'false' → false, otherwise Boolean.
 * - `duration`: non-finite → 400, negative → 0 (no interpolation).
 *
 * Compatibility shim kept with its 1.2 signature; the 1.3 options are not
 * part of its result.
 *
 * @param o Options to normalize; `null`/`undefined` yield the defaults.
 * @returns A new object with the five 1.x options set to valid values.
 *
 * @example
 * ```ts
 * normalizeOptions({ pad: '3' as unknown as number, max: -1 });
 * // → { value: 0, pad: 3, max: null, interpolate: true, duration: 400 }
 * ```
 */
export function normalizeOptions(o: RollingNumberOptions | undefined | null): {
  value: number;
  pad: number;
  max: number | null;
  interpolate: boolean;
  duration: number;
} {
  const src = (o ?? {}) as Record<string, unknown>;
  const duration = toNumber(src.duration);
  return {
    value: normalizeValue(src.value),
    pad: normalizePad(src.pad),
    max: normalizeMax(src.max),
    interpolate: normalizeInterpolate(src.interpolate, RN_DEFAULTS.interpolate),
    duration: Number.isFinite(duration) ? Math.max(0, duration) : RN_DEFAULTS.duration
  };
}

/**
 * Live (normalized) counting duration of a core instance (400 when unset),
 * used by the `<rolling-number>` element so its `duration` getter reports
 * what the core actually uses. Not part of the public package API.
 * @internal
 */
export function getCoreDuration(core: RollingNumberCore): number {
  return core['opts'].duration ?? RN_DEFAULTS.duration;
}

/**
 * Normalized options of a core plus `f`, the resolved fraction digits. Used by
 * the element getters and the adapters. Not part of the public package API.
 * @internal
 */
export function getResolved(core: RollingNumberCore): Readonly<NormalizedOptions> & { readonly f: number } {
  return core['resolved']();
}

/** Per-column DOM references cached to avoid DOM queries on every frame. */
interface DigitColumn {
  el: HTMLSpanElement;
  sizer: HTMLSpanElement;
  digit: string;
}

/** A promise waiting for a target to settle. */
interface Waiter {
  value: number;
  resolve: (settled: RollingNumberSettled) => void;
}

/**
 * Framework-agnostic engine that renders an animated, odometer-style number
 * inside a host element. All framework adapters, the `rollingNumber()` action
 * and the `<rolling-number>` custom element are thin wrappers around it.
 *
 * The core appends its own nodes to the host (`.rn-sign` and one `.rn-col`
 * per digit) and leaves other children alone. It also sets `role="img"`, an
 * `aria-label` with the target value and the `rn-rolling-number` class on the
 * host. While a motion runs the host carries `data-rn-state="animating"`
 * (and the legacy `rn-interpolating` class).
 *
 * Every change dispatches `rn-start` and `rn-end` on the host
 * ({@link RollingNumberEventMap}); `setValue()` returns a promise that
 * resolves when the target settles.
 *
 * Only one core can drive a given host: constructing a second one on the same
 * element destroys the first. Call {@link RollingNumberCore.destroy} when the
 * host goes away.
 *
 * @example
 * ```ts
 * import { RollingNumberCore } from 'rolling-number';
 * import 'rolling-number/style.css';
 *
 * const el = document.querySelector<HTMLElement>('#counter')!;
 * const counter = new RollingNumberCore(el, { value: 0, pad: 3 });
 *
 * await counter.setValue(250);   // counts 0 → 250, resolves when settled
 * counter.setValue(10, false);   // rolls each digit straight to 10
 * counter.update({ max: 99, duration: 800 });
 * el.addEventListener('rn-end', (e) => console.log(e.detail.value));
 * counter.destroy();             // restores the host as it was
 * ```
 */
export class RollingNumberCore {
  private container: HTMLElement | SVGElement;
  private doc: Document;
  private opts: NormalizedOptions;
  private value: number;
  private displayValue: number;

  private signEl: HTMLSpanElement | null = null;
  private digitCols: DigitColumn[] = [];
  private animFrameId: number | null = null;
  private animating = false;
  private destroyed = false;

  /** Last values written to the DOM, used to skip redundant writes. */
  private lastLabel: string | null = null;
  private lastRenderKey: string | null = null;

  /** Host state captured before initialization, restored by destroy(). */
  private prevRole: string | null = null;
  private prevAriaLabel: string | null = null;
  private addedRootClass = false;

  /** Promises waiting for the current target. */
  private waiters: Waiter[] = [];
  /** `rn-start` was dispatched and `rn-end` is still due. */
  private sessionOpen = false;
  /** Value on screen when the open session started. */
  private sessionFrom = 0;
  /** Incremented by every change: stale frames and microtasks compare it. */
  private epoch = 0;

  /**
   * Attaches a rolling number to `container` and renders the initial value
   * synchronously (no animation and no events on first render).
   *
   * @param container Host element. Use a container element such as `<span>`
   *   or `<div>`; void/replaced elements (`<input>`, `<img>`, `<svg>`, …)
   *   cannot display children and trigger a console warning.
   * @param options Initial options; missing or `null` fields use the defaults
   *   (`value 0`, `pad 1`, `max null`, `interpolate true`, `duration` auto).
   * @throws {Error} When `container` is not an element.
   */
  constructor(container: HTMLElement | SVGElement, options: RollingNumberUpdate = {}) {
    const host = container as unknown as Partial<Element> | null | undefined;
    // Realm-safe check: works for elements coming from iframes or other windows.
    if (
      host === null ||
      typeof host !== 'object' ||
      host.nodeType !== 1 ||
      typeof host.setAttribute !== 'function'
    ) {
      throw new Error('[RollingNumber] Target container must be a valid HTMLElement.');
    }

    // A host can only be driven by one core: tear down the previous one first.
    const previous = instances.get(container);
    if (previous && previous !== this) {
      previous.destroy();
    }

    this.opts = resolveOptions(options);
    this.container = container;
    this.doc = container.ownerDocument;
    this.value = this.opts.value;
    this.displayValue = this.value;

    instances.set(container, this);
    this.warnIfUnsupportedHost();
    this.initDOM();
    this.render();
  }

  /**
   * Warns once per host when its children can never be displayed.
   */
  private warnIfUnsupportedHost(): void {
    const host = this.container;
    const name = (host.localName || '').toLowerCase();
    if (!UNSUPPORTED_HOSTS.has(name) && host.namespaceURI !== SVG_NS) return;
    if (warnedHosts.has(host)) return;
    warnedHosts.add(host);
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        `[RollingNumber] <${name}> is not a supported host in 1.x: the digit columns are ` +
        'inserted as child nodes, which this element does not render. Use a container ' +
        'element such as <span> or <div> instead.'
      );
    }
  }

  /**
   * Initializes the container root accessibility attributes and class names,
   * remembering their previous state so destroy() can restore it.
   */
  private initDOM(): void {
    this.prevRole = this.container.getAttribute('role');
    this.prevAriaLabel = this.container.getAttribute('aria-label');
    this.addedRootClass = !this.container.classList.contains('rn-rolling-number');
    this.ensureHostClasses();
    this.container.setAttribute('role', 'img');
  }

  /**
   * Re-applies the classes/attributes owned by the core (frameworks may clobber className).
   */
  private ensureHostClasses(): void {
    const classList = this.container.classList;
    if (!classList.contains('rn-rolling-number')) {
      classList.add('rn-rolling-number');
    }
    if (this.animating) {
      if (!classList.contains('rn-interpolating')) {
        classList.add('rn-interpolating');
      }
      if (this.container.getAttribute('data-rn-state') !== 'animating') {
        this.container.setAttribute('data-rn-state', 'animating');
      }
    }
  }

  /**
   * Toggles the interpolation state (data-rn-state="animating" + .rn-interpolating).
   */
  private setAnimatingState(animating: boolean): void {
    this.animating = animating;
    if (animating) {
      this.ensureHostClasses();
    } else {
      this.container.removeAttribute('data-rn-state');
      this.container.classList.remove('rn-interpolating');
    }
  }

  private cancelFrame(): void {
    if (this.animFrameId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animFrameId);
      }
      this.animFrameId = null;
    }
  }

  /**
   * Whether the user asked the OS/browser to minimize non-essential motion.
   */
  private prefersReducedMotion(): boolean {
    try {
      const view = this.doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
      if (!view || typeof view.matchMedia !== 'function') return false;
      return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /** `max` as the display uses it (floored), or null. */
  private displayMax(): number | null {
    return this.opts.max === null ? null : Math.floor(this.opts.max);
  }

  /**
   * Calculates the clamped positive integer display value.
   */
  private displayMagnitude(): number {
    const absVal = Math.round(Math.abs(this.displayValue));
    const max = this.displayMax();
    return max !== null ? Math.min(absVal, max) : absVal;
  }

  /**
   * Returns array of single digit characters zero-padded to `pad` length.
   */
  private getDisplayDigits(): string[] {
    const str = this.displayMagnitude().toString();
    const targetLength = Math.max(this.opts.pad, str.length);
    return str.padStart(targetLength, '0').split('');
  }

  /**
   * Builds a single digit column element containing the sizer and digits scale (0..9).
   */
  private createColumn(digit: string): DigitColumn {
    const doc = this.doc;
    const col = doc.createElement('span');
    col.className = 'rn-col';
    col.setAttribute('data-digit', digit);

    // Sizer to hold proper column layout dimensions
    const sizer = doc.createElement('span');
    sizer.className = 'rn-sizer';
    sizer.setAttribute('aria-hidden', 'true');
    sizer.textContent = digit;

    // Vertical digit scale (0 to 9)
    const scale = doc.createElement('span');
    scale.className = 'rn-scale';
    scale.setAttribute('aria-hidden', 'true');

    for (let i = 0; i <= 9; i++) {
      const cell = doc.createElement('span');
      cell.className = 'rn-cell';
      cell.textContent = i.toString();
      scale.appendChild(cell);
    }

    col.appendChild(sizer);
    col.appendChild(scale);
    return { el: col, sizer, digit };
  }

  /**
   * Renders and updates the DOM using fast element reconciliation.
   * Only attributes/text that actually changed are written.
   *
   * Setters already render when needed; call it yourself only to re-apply the
   * host class after a framework overwrote `className`. No-op after
   * {@link RollingNumberCore.destroy}.
   */
  public render(): void {
    if (this.destroyed) return;

    this.ensureHostClasses();

    // Accessibility label (only rewritten when the target value changes)
    const label = toDisplayInteger(this.value).toString();
    if (label !== this.lastLabel) {
      this.container.setAttribute('aria-label', label);
      this.lastLabel = label;
    }

    const isNegative = this.displayValue < 0 && Math.round(Math.abs(this.displayValue)) !== 0;
    const digits = this.getDisplayDigits();
    const renderKey = (isNegative ? '-' : '') + digits.join('');
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    // 1. Reconcile Digit Columns count
    const currentCount = this.digitCols.length;
    const targetCount = digits.length;

    if (currentCount < targetCount) {
      // Append missing columns right after the last owned column
      const last = this.digitCols[currentCount - 1];
      const ref = last ? last.el.nextSibling : null;
      for (let i = currentCount; i < targetCount; i++) {
        const col = this.createColumn(digits[i]);
        this.digitCols.push(col);
        this.container.insertBefore(col.el, ref);
      }
    } else if (currentCount > targetCount) {
      // Remove excess columns from the right/end
      for (let i = currentCount - 1; i >= targetCount; i--) {
        const col = this.digitCols.pop();
        col?.el.remove();
      }
    }

    // 2. Handle Minus Sign (placed right before the first digit column)
    if (isNegative) {
      if (!this.signEl) {
        this.signEl = this.doc.createElement('span');
        this.signEl.className = 'rn-sign';
        this.signEl.setAttribute('aria-hidden', 'true');
        this.signEl.textContent = '−';
        this.container.insertBefore(this.signEl, this.digitCols[0]?.el ?? null);
      }
    } else if (this.signEl) {
      this.signEl.remove();
      this.signEl = null;
    }

    // 3. Update data-digit and sizer text on existing columns
    for (let i = 0; i < targetCount; i++) {
      const col = this.digitCols[i];
      const digit = digits[i];
      if (col.digit !== digit) {
        col.digit = digit;
        col.el.setAttribute('data-digit', digit);
        col.sizer.textContent = digit;
      }
    }
  }

  /** A promise for `value` that resolves with the next settle (or supersede/destroy). */
  private wait(value: number): Promise<RollingNumberSettled> {
    return new Promise((resolve) => {
      this.waiters.push({ value, resolve });
    });
  }

  /** Resolves `{ completed: false }` for every waiter whose target is not `keep`. */
  private supersede(keep: number): void {
    const stale = this.waiters.filter((w) => w.value !== keep);
    this.waiters = this.waiters.filter((w) => w.value === keep);
    for (const w of stale) w.resolve({ value: w.value, completed: false });
  }

  /** Removes and returns the waiters (resolved by the caller after dispatching `rn-end`). */
  private takeWaiters(): Waiter[] {
    const taken = this.waiters;
    this.waiters = [];
    return taken;
  }

  /** Dispatches `rn-start` / `rn-end` on the host (bubbles, composed). */
  private dispatch(type: 'rn-start' | 'rn-end', detail: RollingNumberEventDetail): void {
    const view = this.doc.defaultView as (Window & typeof globalThis) | null;
    const Ctor = view?.CustomEvent ?? (typeof CustomEvent === 'function' ? CustomEvent : null);
    if (!Ctor) return;
    this.container.dispatchEvent(new Ctor(type, { detail, bubbles: true, composed: true }));
  }

  /** Ends the current session: `rn-start` if it never fired, then `rn-end`, then the promises. */
  private settle(from: number, animated: boolean): void {
    const value = this.value;
    const done = this.takeWaiters();
    if (!this.sessionOpen) {
      this.dispatch('rn-start', { value, from, animated });
    }
    this.sessionOpen = false;
    this.dispatch('rn-end', { value, from: animated ? this.sessionFrom : from, animated });
    for (const w of done) w.resolve({ value: w.value, completed: w.value === value });
  }

  /** Instant change: events and promises follow in a microtask (coalesced with later changes). */
  private settleInstantly(from: number): void {
    const epoch = ++this.epoch;
    const sessionFrom = this.sessionOpen ? this.sessionFrom : from;
    microtask(() => {
      if (this.destroyed || epoch !== this.epoch) return;
      this.sessionFrom = sessionFrom;
      this.settle(sessionFrom, false);
    });
  }

  /**
   * Updates the displayed value, animated or not, and resolves when the
   * target settles. Loose input is normalized (non-finite → 0). Every change
   * is instant when the user prefers reduced motion.
   *
   * A call during a running motion restarts it from the value on screen;
   * `aria-label` switches to the new target immediately. Setting the target
   * already in flight joins that motion (same outcome, no events).
   *
   * @param value New target value (see {@link RollingNumberOptions.value}).
   * @param animate `true`: count through the intermediate values; `false`:
   *   roll each digit straight to its new digit; or per-call options
   *   ({@link RollingNumberSetValueOptions}). Defaults to the `interpolate` option.
   * @returns Resolves `{ value, completed: true }` when the display settles on
   *   `value`, `{ completed: false }` when superseded by another target or
   *   destroyed. Never rejects.
   *
   * @example
   * ```ts
   * counter.setValue(1200);                          // animated if interpolate is true
   * counter.setValue(0, false);                      // rolls straight to 0
   * counter.setValue(5, { motion: 'none' });         // instant
   * const { completed } = await counter.setValue(42, { duration: 1200, easing: 'ease-out-expo' });
   * ```
   */
  public setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled> {
    const targetVal = normalizeValue(value);

    if (this.destroyed) {
      this.cancelFrame();
      this.value = targetVal;
      this.displayValue = targetVal;
      return Promise.resolve({ value: targetVal, completed: false });
    }

    const call = typeof animate === 'object' && animate !== null ? animate : null;
    const flag = typeof animate === 'boolean' ? animate : this.opts.interpolate;
    const motion = call?.motion ?? (flag ? 'count' : 'roll');
    const explicitTiming = call !== null && (call.duration !== undefined || call.easing !== undefined);
    const callDuration = call?.duration !== undefined ? toNumber(call.duration) : NaN;
    const duration = Number.isFinite(callDuration)
      ? Math.max(0, callDuration)
      : (this.opts.duration ?? RN_DEFAULTS.duration);

    // Join: same target in flight, no explicit change of motion.
    if (
      this.animFrameId !== null &&
      targetVal === this.value &&
      (animate === undefined || (motion === 'count' && !explicitTiming))
    ) {
      return this.wait(targetVal);
    }

    if (this.animFrameId === null && this.value === targetVal && this.displayValue === targetVal) {
      return Promise.resolve({ value: targetVal, completed: true });
    }

    this.cancelFrame();
    this.supersede(targetVal);
    const promise = this.wait(targetVal);
    const startVal = this.displayValue;

    if (
      motion !== 'count' ||
      duration <= 0 ||
      typeof requestAnimationFrame !== 'function' ||
      this.prefersReducedMotion() ||
      Math.abs(targetVal - startVal) < 0.001
    ) {
      this.setAnimatingState(false);
      this.value = targetVal;
      this.displayValue = targetVal;
      this.render();
      this.settleInstantly(startVal);
      return promise;
    }

    const delta = targetVal - startVal;
    this.value = targetVal;
    const epoch = ++this.epoch;

    this.setAnimatingState(true);
    this.render(); // keeps aria-label in sync with the new target immediately
    let startTime: number | null = null;

    const step = (now: number) => {
      if (this.destroyed || epoch !== this.epoch) return;
      // Start from the first frame timestamp: avoids a negative elapsed time
      // when setValue runs after the frame's timestamp was taken.
      if (startTime === null) {
        startTime = now;
        if (!this.sessionOpen) {
          this.sessionOpen = true;
          this.sessionFrom = startVal;
          this.dispatch('rn-start', { value: targetVal, from: startVal, animated: true });
          // A listener may have changed the target or destroyed the core.
          if (this.destroyed || epoch !== this.epoch) return;
        }
      }
      const raw = (now - startTime) / duration;
      const progress = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;

      if (progress < 1) {
        // easeOutCubic curve
        const ease = 1 - Math.pow(1 - progress, 3);
        this.displayValue = startVal + delta * ease;
        this.render();
        this.animFrameId = requestAnimationFrame(step);
      } else {
        this.animFrameId = null;
        // Render the final digits while transitions are still disabled, flush
        // styles, and only then leave the animating state so CSS transitions
        // never replay from the intermediate digits.
        this.displayValue = targetVal;
        this.render();
        void (this.container as HTMLElement).offsetWidth;
        this.setAnimatingState(false);
        this.settle(startVal, true);
      }
    };

    this.animFrameId = requestAnimationFrame(step);
    return promise;
  }

  /**
   * Resolves when the current motion settles (immediately when idle).
   *
   * @returns `{ value, completed }` as for {@link RollingNumberCore.setValue}.
   */
  public whenSettled(): Promise<RollingNumberSettled> {
    if (this.destroyed) return Promise.resolve({ value: this.value, completed: false });
    if (this.animFrameId !== null || this.waiters.length > 0) return this.wait(this.value);
    return Promise.resolve({ value: this.value, completed: true });
  }

  /**
   * Jumps to the target now: final DOM, `rn-end`, pending promises resolve
   * `{ completed: true }`. No-op when idle.
   */
  public finish(): void {
    if (this.destroyed || this.animFrameId === null) return;
    this.cancelFrame();
    this.epoch++;
    const from = this.sessionOpen ? this.sessionFrom : this.displayValue;
    const animated = this.sessionOpen;
    this.displayValue = this.value;
    this.render();
    void (this.container as HTMLElement).offsetWidth;
    this.setAnimatingState(false);
    this.settle(from, animated);
  }

  /**
   * Gets the current numeric target value (normalized, not rounded): during a
   * motion this is already the final value, not the one on screen
   * (see {@link RollingNumberCore.getDisplayValue}).
   *
   * @returns The target value.
   */
  public getValue(): number {
    return this.value;
  }

  /**
   * Value on screen (signed, clamped by `max`; fractional mid-count).
   *
   * @returns The displayed value.
   */
  public getDisplayValue(): number {
    const max = this.displayMax();
    const v = this.displayValue;
    return max !== null && Math.abs(v) > max ? Math.sign(v) * max : v;
  }

  /**
   * Displayed text of the target at rest: clamped by `max`, with
   * `overflowSuffix` and affixes, e.g. `"99+"` (what text mode shows).
   *
   * @returns The text of the target.
   */
  public getText(): string {
    const o = this.opts;
    const a = toDisplayInteger(this.value);
    const max = this.displayMax();
    const overflow = max !== null && Math.abs(a) > max;
    const m = overflow ? (max as number) : Math.abs(a);
    return (
      o.prefixText +
      (a < 0 && m !== 0 ? '-' : '') +
      String(m).padStart(o.pad, '0') +
      (overflow ? o.overflowSuffix : '') +
      o.suffixText
    );
  }

  /**
   * Renderer in use after `mode: 'auto'` resolution.
   *
   * @returns `'columns'` or `'text'`.
   */
  public getMode(): 'columns' | 'text' {
    return 'columns';
  }

  /**
   * Returns the host element this instance renders into.
   *
   * @returns The `container` passed to the constructor (typed `HTMLElement`
   *   for 1.x compatibility; see {@link RollingNumberCore.getHost}).
   */
  public getElement(): HTMLElement {
    return this.container as HTMLElement;
  }

  /**
   * Returns the host as passed to the constructor (accurately typed).
   *
   * @returns The `container` passed to the constructor.
   */
  public getHost(): HTMLElement | SVGElement {
    return this.container;
  }

  /**
   * Whether a motion is currently running (the host then carries
   * `data-rn-state="animating"`).
   *
   * @returns `true` between the start and the last frame of a motion.
   */
  public isAnimating(): boolean {
    return this.animFrameId !== null;
  }

  /** @internal Normalized options plus the resolved fraction digits (see `getResolved`). */
  private resolved(): Readonly<NormalizedOptions> & { readonly f: number } {
    return Object.freeze({ ...this.opts, f: this.opts.decimals ?? 0 });
  }

  /**
   * Updates whether value changes count through the intermediate values.
   * `null`/`undefined` → `true` (the default), the string 'false' → false,
   * other values use `Boolean()`. Applies to the next
   * {@link RollingNumberCore.setValue} call.
   *
   * @param interpolate See {@link RollingNumberOptions.interpolate}.
   */
  public setInterpolate(interpolate: boolean): void {
    this.opts.interpolate = normalizeInterpolate(interpolate, RN_DEFAULTS.interpolate);
  }

  /**
   * Updates the animation duration in milliseconds. `null` resets it to
   * unset (auto); non-finite input keeps the current duration; negative
   * values become 0. Applies to the next {@link RollingNumberCore.setValue} call.
   *
   * @param duration Duration in ms (`0` disables counting), or `null` for auto.
   */
  public setDuration(duration: number | null): void {
    if (duration === null) {
      this.opts.duration = null;
      return;
    }
    const n = toNumber(duration);
    if (!Number.isFinite(n)) return;
    this.opts.duration = Math.max(0, n);
  }

  /**
   * Updates the column zero-padding minimum length (1..64) and re-renders.
   *
   * @param pad See {@link RollingNumberOptions.pad}.
   */
  public setPad(pad: number): void {
    const newPad = normalizePad(pad);
    if (this.opts.pad === newPad) return;
    this.opts.pad = newPad;
    this.render();
  }

  /**
   * Updates the maximum clamped limit. null, undefined, '', negative or
   * non-finite values remove the limit.
   *
   * @param max Display clamp, or `null` for none (see {@link RollingNumberOptions.max}).
   */
  public setMax(max: number | null): void {
    const newMax = normalizeMaxExact(max);
    if (this.opts.max === newMax) return;
    this.opts.max = newMax;
    this.render();
  }

  /**
   * Updates multiple options at once. Fields left `undefined` are unchanged;
   * `null` resets a field to its default. A changed `value` goes through
   * {@link RollingNumberCore.setValue} last (animated according to the new
   * `interpolate`/`duration`). `from` is creation-only and ignored here.
   *
   * @param options Partial options; each field is normalized like its setter.
   *
   * @example
   * ```ts
   * counter.update({ value: 7, pad: 2 }); // the other options are unchanged
   * counter.update({ duration: null });   // back to the automatic duration
   * ```
   */
  public update(options: RollingNumberUpdate): void {
    const o = (options ?? {}) as Record<string, unknown>;
    for (const key of OPTION_KEYS) {
      if (key === 'value' || key === 'from') continue;
      let raw: unknown;
      try {
        raw = o[key];
      } catch {
        raw = undefined;
      }
      if (raw !== undefined) this.applyField(key, raw);
    }

    if (o.value !== undefined && this.value !== normalizeValue(o.value)) {
      void this.setValue(o.value as number);
    } else {
      this.render();
    }
  }

  /** Normalizes and stores one option (`update()` semantics). */
  private applyField<K extends OptionKey>(key: K, raw: unknown): void {
    this.opts[key] = normalizeField(key, raw, this.opts);
  }

  /**
   * Destroys the instance: cancels any running animation, removes only the
   * nodes created by the core and restores the host's previous role,
   * aria-label and class. Pending promises resolve `{ completed: false }`;
   * no event is dispatched. The instance is inert afterwards.
   * Calling it more than once is safe.
   */
  public destroy(): void {
    this.cancelFrame();
    if (this.destroyed) return;
    this.destroyed = true;
    this.epoch++;
    this.sessionOpen = false;

    const host = this.container;
    this.setAnimatingState(false);

    if (this.signEl) {
      this.signEl.remove();
      this.signEl = null;
    }
    for (const col of this.digitCols) {
      col.el.remove();
    }
    this.digitCols = [];
    this.lastRenderKey = null;
    this.lastLabel = null;

    if (this.prevRole === null) {
      host.removeAttribute('role');
    } else {
      host.setAttribute('role', this.prevRole);
    }
    if (this.prevAriaLabel === null) {
      host.removeAttribute('aria-label');
    } else {
      host.setAttribute('aria-label', this.prevAriaLabel);
    }
    if (this.addedRootClass) {
      host.classList.remove('rn-rolling-number');
    }

    if (instances.get(host) === this) {
      instances.delete(host);
    }

    for (const w of this.takeWaiters()) w.resolve({ value: w.value, completed: false });
  }
}
