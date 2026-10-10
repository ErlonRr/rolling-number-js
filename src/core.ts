import './rolling-number.css';

/**
 * Options accepted by {@link RollingNumberCore} and by every framework adapter
 * (`<RollingNumber>` for React/Vue, `v-rolling-number`, the Angular
 * `[rollingNumber]` directive and the `<rolling-number>` custom element, whose
 * attributes have the same names).
 *
 * Every field is optional. Invalid input never throws: it is normalized as
 * described on each field (see also {@link normalizeOptions}).
 *
 * @example
 * ```ts
 * import { RollingNumberCore } from 'rolling-number';
 * import 'rolling-number/style.css';
 *
 * const counter = new RollingNumberCore(document.querySelector('#badge')!, {
 *   value: 0,
 *   pad: 2,        // always show at least 2 digits: "07"
 *   max: 99,       // never display more than 99
 *   interpolate: true,
 *   duration: 600  // ms
 * });
 * counter.setValue(42);
 * ```
 */
export interface RollingNumberOptions {
  /**
   * The number to display (the target value).
   *
   * Decimals are accepted but the display shows the integer rounded
   * symmetrically around zero (`1.5` → `2`, `-1.5` → `-2`). Negative values
   * show a leading minus sign.
   * Non-finite input (`NaN`, `Infinity`, non-numeric strings) becomes `0`; the
   * magnitude is clamped to `Number.MAX_SAFE_INTEGER`.
   *
   * @default 0
   */
  value?: number;
  /**
   * Minimum number of digit columns: shorter numbers are padded with leading
   * zeros (`pad: 3` shows `7` as `007`). Longer numbers are never truncated.
   *
   * Range `1..64`: non-finite or `< 1` → `1`, decimals are floored, values
   * above 64 are clamped to 64.
   *
   * @default 1
   */
  pad?: number;
  /**
   * Upper bound of the displayed absolute value, e.g. `99` for a notification
   * badge (the target value itself is kept; only the display is clamped).
   * `null` means no limit.
   *
   * `null`, `undefined`, `''`, negative or non-finite input → `null`
   * (no limit); other values are floored.
   *
   * @default null
   */
  max?: number | null;
  /**
   * Whether value changes count through the intermediate numbers
   * (`1 → 2 → … → 50`) over {@link RollingNumberOptions.duration | duration}
   * milliseconds. When `false`, the digits jump straight to the new value
   * (each column still rolls with the CSS transition `--rn-duration`).
   *
   * Interpolation is also skipped when the user prefers reduced motion.
   * `null`/`undefined` → `true` (the default), the string `'false'` → `false`,
   * other values use `Boolean()`.
   *
   * @default true
   */
  interpolate?: boolean;
  /**
   * Duration of the interpolation, in **milliseconds** (only used when
   * {@link RollingNumberOptions.interpolate | interpolate} is `true`).
   * `0` disables the interpolation.
   *
   * Negative input → `0` (no interpolation). Non-finite input → `400` when
   * passed to the constructor or {@link normalizeOptions};
   * {@link RollingNumberCore.setDuration} and `update()` keep the previous
   * duration instead.
   *
   * @default 400
   */
  duration?: number;
}

/**
 * Default option values shared by the core and every framework adapter:
 * `{ value: 0, pad: 1, max: null, interpolate: true, duration: 400 }`.
 */
export const RN_DEFAULTS: Readonly<{
  value: number;
  pad: number;
  max: number | null;
  interpolate: boolean;
  duration: number;
}> = Object.freeze({ value: 0, pad: 1, max: null, interpolate: true, duration: 400 });

/** Upper bound for `pad`, prevents runaway DOM creation (e.g. pad=20000). */
const MAX_PAD = 64;

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
 * Converts loose input to a number. null, undefined, blank strings and
 * non-coercible values (symbols, throwing valueOf) become NaN.
 */
function toNumber(input: unknown): number {
  if (input === null || input === undefined) return NaN;
  if (typeof input === 'number') return input;
  if (typeof input === 'string') return input.trim() === '' ? NaN : Number(input);
  try {
    return Number(input);
  } catch {
    return NaN;
  }
}

function normalizeValue(input: unknown): number {
  const n = toNumber(input);
  if (!Number.isFinite(n)) return RN_DEFAULTS.value;
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  if (n < -Number.MAX_SAFE_INTEGER) return -Number.MAX_SAFE_INTEGER;
  return n;
}

function normalizePad(input: unknown): number {
  const n = toNumber(input);
  if (!Number.isFinite(n) || n < 1) return RN_DEFAULTS.pad;
  return Math.min(MAX_PAD, Math.floor(n));
}

function normalizeMax(input: unknown): number | null {
  const n = toNumber(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normalizeInterpolate(input: unknown, fallback: boolean): boolean {
  if (input === null || input === undefined) return fallback;
  if (input === 'false') return false;
  return Boolean(input);
}

/**
 * Rounds symmetrically around zero (-1.5 → -2, 1.5 → 2), as the display does.
 */
function toDisplayInteger(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * Normalizes a (possibly partial or loosely typed) options object to valid values.
 * Missing, undefined or null fields fall back to `RN_DEFAULTS`.
 *
 * - `value`: non-finite → 0, magnitude clamped to `Number.MAX_SAFE_INTEGER`.
 * - `pad`: non-finite or < 1 → 1, floored, clamped to 64.
 * - `max`: null, '', non-finite or negative → null, otherwise floored.
 * - `interpolate`: null/undefined → true, the string 'false' → false, otherwise Boolean.
 * - `duration`: non-finite → 400, negative → 0 (no interpolation).
 *
 * @param o Options to normalize; `null`/`undefined` yield the defaults.
 * @returns A new object with every option set to a valid value.
 *
 * @example
 * ```ts
 * normalizeOptions({ pad: '3' as unknown as number, max: -1 });
 * // → { value: 0, pad: 3, max: null, interpolate: true, duration: 400 }
 * ```
 */
export function normalizeOptions(o: RollingNumberOptions | undefined | null): Required<RollingNumberOptions> {
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
 * Live (normalized) interpolation duration of a core instance, used by the
 * `<rolling-number>` element so its `duration` getter reports what the core
 * actually uses. Not part of the public package API.
 * @internal
 */
export function getCoreDuration(core: RollingNumberCore): number {
  return core['duration'];
}

/** Per-column DOM references cached to avoid DOM queries on every frame. */
interface DigitColumn {
  el: HTMLSpanElement;
  sizer: HTMLSpanElement;
  digit: string;
}

/**
 * Framework-agnostic engine that renders an animated, odometer-style number
 * inside a host element. All framework adapters and the `<rolling-number>`
 * custom element are thin wrappers around it.
 *
 * The core appends its own nodes to the host (`.rn-sign` and one `.rn-col`
 * per digit) and leaves other children alone. It also sets `role="img"`, an
 * `aria-label` with the target value and the `rn-rolling-number` class on the
 * host. While an interpolation runs the host carries
 * `data-rn-state="animating"` (and the legacy `rn-interpolating` class).
 *
 * Import `rolling-number/style.css` once for the digit columns to render.
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
 * counter.setValue(250);         // counts 0 → 250 in 400 ms
 * counter.setValue(10, false);   // jumps straight to 10
 * counter.update({ max: 99, duration: 800 });
 * counter.destroy();             // restores the host as it was
 * ```
 */
export class RollingNumberCore {
  private container: HTMLElement;
  private doc: Document;
  private value: number;
  private displayValue: number;
  private pad: number;
  private max: number | null;
  private interpolate: boolean;
  private duration: number;

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

  /**
   * Attaches a rolling number to `container` and renders the initial value
   * synchronously (no animation on first render).
   *
   * @param container Host element. Use a container element such as `<span>`
   *   or `<div>`; void/replaced elements (`<input>`, `<img>`, `<svg>`, …)
   *   cannot display children and trigger a console warning.
   * @param options Initial options; missing fields use the defaults
   *   (`value 0`, `pad 1`, `max null`, `interpolate true`, `duration 400`).
   * @throws {Error} When `container` is not an element.
   */
  constructor(container: HTMLElement, options: RollingNumberOptions = {}) {
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

    const opts = normalizeOptions(options);
    this.container = container;
    this.doc = container.ownerDocument;
    this.value = opts.value;
    this.displayValue = this.value;
    this.pad = opts.pad;
    this.max = opts.max;
    this.interpolate = opts.interpolate;
    this.duration = opts.duration;

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

  /**
   * Calculates the clamped positive integer display value.
   */
  private getDisplayValue(): number {
    const absVal = Math.round(Math.abs(this.displayValue));
    return this.max !== null ? Math.min(absVal, this.max) : absVal;
  }

  /**
   * Returns array of single digit characters zero-padded to `pad` length.
   */
  private getDisplayDigits(): string[] {
    const str = this.getDisplayValue().toString();
    const targetLength = Math.max(this.pad, str.length);
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

  /**
   * Updates the displayed numeric value with optional progressive interpolation.
   * Loose input is normalized (non-finite → 0). Animation is skipped when the
   * user prefers reduced motion.
   *
   * A call during a running interpolation restarts it from the number currently
   * on screen. `aria-label` switches to the new target immediately.
   *
   * @param value New target value (see {@link RollingNumberOptions.value}).
   * @param animate Count through the intermediate numbers. Defaults to the
   *   current `interpolate` option.
   *
   * @example
   * ```ts
   * counter.setValue(1200);        // animated if interpolate is true
   * counter.setValue(0, false);    // immediate
   * ```
   */
  public setValue(value: number, animate: boolean = this.interpolate): void {
    const targetVal = normalizeValue(value);
    if (this.value === targetVal && this.displayValue === targetVal) return;

    this.cancelFrame();

    if (this.destroyed) {
      this.value = targetVal;
      this.displayValue = targetVal;
      return;
    }

    if (
      !animate ||
      this.duration <= 0 ||
      typeof requestAnimationFrame !== 'function' ||
      this.prefersReducedMotion()
    ) {
      this.setAnimatingState(false);
      this.value = targetVal;
      this.displayValue = targetVal;
      this.render();
      return;
    }

    const startVal = this.displayValue;
    const delta = targetVal - startVal;
    this.value = targetVal;

    if (Math.abs(delta) < 0.001) {
      this.setAnimatingState(false);
      this.displayValue = targetVal;
      this.render();
      return;
    }

    this.setAnimatingState(true);
    this.render(); // keeps aria-label in sync with the new target immediately
    const duration = this.duration;
    let startTime: number | null = null;

    const step = (now: number) => {
      if (this.destroyed) return;
      // Start from the first frame timestamp: avoids a negative elapsed time
      // when setValue runs after the frame's timestamp was taken.
      if (startTime === null) startTime = now;
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
        void this.container.offsetWidth;
        this.setAnimatingState(false);
      }
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  /**
   * Gets the current numeric target value (normalized, not rounded): during an
   * interpolation this is already the final value, not the one on screen.
   *
   * @returns The target value.
   */
  public getValue(): number {
    return this.value;
  }

  /**
   * Returns the host element this instance renders into.
   *
   * @returns The `container` passed to the constructor.
   */
  public getElement(): HTMLElement {
    return this.container;
  }

  /**
   * Whether a progressive interpolation is currently running (the host then
   * carries `data-rn-state="animating"`).
   *
   * @returns `true` between the start and the last frame of an interpolation.
   */
  public isAnimating(): boolean {
    return this.animFrameId !== null;
  }

  /**
   * Updates whether value changes are progressively interpolated.
   * `null`/`undefined` → `true` (the default), the string 'false' → false,
   * other values use `Boolean()`. Applies to the next
   * {@link RollingNumberCore.setValue} call.
   *
   * @param interpolate See {@link RollingNumberOptions.interpolate}.
   */
  public setInterpolate(interpolate: boolean): void {
    this.interpolate = normalizeInterpolate(interpolate, RN_DEFAULTS.interpolate);
  }

  /**
   * Updates the animation duration in milliseconds.
   * Non-finite input keeps the current duration; negative values become 0.
   * Applies to the next {@link RollingNumberCore.setValue} call.
   *
   * @param duration Interpolation duration in ms (`0` disables it).
   */
  public setDuration(duration: number): void {
    const n = toNumber(duration);
    if (!Number.isFinite(n)) return;
    this.duration = Math.max(0, n);
  }

  /**
   * Updates the column zero-padding minimum length (1..64) and re-renders.
   *
   * @param pad See {@link RollingNumberOptions.pad}.
   */
  public setPad(pad: number): void {
    const newPad = normalizePad(pad);
    if (this.pad === newPad) return;
    this.pad = newPad;
    this.render();
  }

  /**
   * Updates the maximum clamped limit. null, undefined, '', negative or
   * non-finite values remove the limit; other values are floored.
   *
   * @param max Display clamp, or `null` for none (see {@link RollingNumberOptions.max}).
   */
  public setMax(max: number | null): void {
    const newMax = normalizeMax(max);
    if (this.max === newMax) return;
    this.max = newMax;
    this.render();
  }

  /**
   * Updates multiple options at once. Fields left undefined are unchanged.
   * A changed `value` goes through {@link RollingNumberCore.setValue} (and is
   * animated according to the new `interpolate`/`duration`).
   *
   * @param options Partial options; each field is normalized like its setter.
   *
   * @example
   * ```ts
   * counter.update({ value: 7, pad: 2 }); // max, interpolate, duration unchanged
   * ```
   */
  public update(options: RollingNumberOptions): void {
    const o = (options ?? {}) as Record<string, unknown>;
    if (o.pad !== undefined) {
      this.pad = normalizePad(o.pad);
    }
    if (o.max !== undefined) {
      this.max = normalizeMax(o.max);
    }
    if (o.interpolate !== undefined) {
      this.interpolate = normalizeInterpolate(o.interpolate, RN_DEFAULTS.interpolate);
    }
    if (o.duration !== undefined) {
      this.setDuration(o.duration as number);
    }

    if (o.value !== undefined && this.value !== normalizeValue(o.value)) {
      this.setValue(o.value as number);
    } else {
      this.render();
    }
  }

  /**
   * Destroys the instance: cancels any running animation, removes only the
   * nodes created by the core and restores the host's previous role,
   * aria-label and class. The instance is inert afterwards.
   * Calling it more than once is safe.
   */
  public destroy(): void {
    this.cancelFrame();
    if (this.destroyed) return;
    this.destroyed = true;

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
  }
}
