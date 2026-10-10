import { RollingNumberCore, RN_DEFAULTS, getCoreDuration, normalizeOptions, type RollingNumberOptions } from './core';

/**
 * SSR-safe base class: in environments without a DOM (Node, workers, SSR
 * renderers) `HTMLElement` is not defined, so importing this module must not
 * throw. The element is only ever instantiated in a browser, where the real
 * `HTMLElement` is used.
 */
const HTMLElementBase = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as unknown as typeof HTMLElement;

const OBSERVED_ATTRIBUTES = ['value', 'pad', 'max', 'interpolate', 'duration'] as const;

type ObservedProperty = (typeof OBSERVED_ATTRIBUTES)[number];

/**
 * Options of `<rolling-number>` as written in markup: each one can be given as
 * a typed value (property binding, e.g. React 19 / Vue `:value="5"`) or as its
 * string form (plain attribute, e.g. `pad="3"`). `null`/`undefined` mean
 * "default". Used by the React JSX and Vue template typings of the custom
 * element; see {@link RollingNumberOptions} for the semantics of each option.
 *
 * @example
 * ```tsx
 * <rolling-number value={count} pad="3" max={99} interpolate="false" duration={600} />
 * ```
 */
export interface RollingNumberAttributes {
  /** The number to display. Non-numeric → `0`. @default 0 */
  value?: number | `${number}` | null;
  /** Minimum number of digits, padded with leading zeros (1..64). @default 1 */
  pad?: number | `${number}` | null;
  /** Upper bound of the displayed absolute value; `null` → no limit. @default null */
  max?: number | `${number}` | null;
  /** `false` / `"false"` jumps straight to new values instead of counting. @default true */
  interpolate?: boolean | 'true' | 'false' | null;
  /** Interpolation duration in milliseconds. @default 400 */
  duration?: number | `${number}` | null;
}

/**
 * Attribute strings are handed to the core as-is: the core normalizes loose
 * input (string numbers, NaN, empty strings, ...) itself.
 */
function raw(attr: string): number {
  return attr as unknown as number;
}

/** `interpolate` attribute semantics: absent → true, `"false"` → false, anything else → true. */
function parseInterpolate(attr: string | null): boolean {
  return attr !== 'false';
}

/**
 * `<rolling-number>`: an animated, odometer-style number counter.
 *
 * Registered by `import 'rolling-number'` or `import 'rolling-number/register'`
 * (or call {@link defineRollingNumber} for a custom tag name). Import
 * `rolling-number/style.css` once for the digit columns to render.
 *
 * Every option is available both as an attribute (strings, as in HTML) and as
 * a property (typed). Setting a property reflects it to the attribute; setting
 * it to `null`/`undefined` removes the attribute and restores the default.
 * Invalid input never throws: it is normalized like
 * {@link RollingNumberOptions}.
 *
 * Rendering happens in light DOM (no shadow root, so there are no CSS parts):
 * the element gets the class `rn-rolling-number`, `role="img"` and an
 * `aria-label` with the target value, plus child nodes `.rn-sign` and
 * `.rn-col` (one per digit). While an interpolation runs the element carries
 * the attribute `data-rn-state="animating"` (and the legacy class
 * `rn-interpolating`), removed when it ends: use it as a styling hook.
 *
 * @tagname rolling-number
 * @summary Animated odometer-style number counter (light DOM, no shadow root).
 *
 * @attr {number} value - The number to display. Decimals are rounded for display; non-numeric → 0.
 * @attr {number} pad - Minimum number of digits, padded with leading zeros (1..64).
 * @attr {number} max - Upper bound of the displayed absolute value (e.g. `99`). Absent, empty or negative → no limit.
 * @attr {"true" | "false"} interpolate - Set to `"false"` to jump straight to new values instead of counting through the intermediate numbers. Any other value (or absent) → `true`.
 * @attr {number} duration - Interpolation duration in milliseconds.
 *
 * @cssprop [--rn-duration=0.5s] - Duration of the CSS roll of each digit column.
 * @cssprop [--rn-easing=cubic-bezier(0.2, 1, 0.3, 1)] - Easing of the CSS roll of each digit column.
 * @cssprop [--rn-lh=1] - Height of the digit window, in multiples of the font size (also sets the line-height).
 *
 * @example
 * ```html
 * <script type="module">
 *   import 'rolling-number/register';
 *   import 'rolling-number/style.css';
 * </script>
 *
 * <rolling-number value="42" pad="3" max="999" duration="600"></rolling-number>
 * <rolling-number value="7" interpolate="false"></rolling-number>
 * ```
 *
 * @example
 * ```ts
 * const el = document.querySelector('rolling-number')!; // typed as RollingNumberElement
 * el.value = 1200;   // number property, reflected to the `value` attribute
 * el.max = null;     // removes the limit
 * ```
 */
export class RollingNumberElement extends HTMLElementBase {
  /** @internal */
  private core: RollingNumberCore | null = null;

  /** Attributes that drive the counter: `value`, `pad`, `max`, `interpolate`, `duration`. */
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRIBUTES];
  }

  constructor() {
    super();
  }

  /** Creates the core (first connection) after re-applying pre-upgrade properties. */
  connectedCallback(): void {
    // Properties assigned before the element was upgraded live as own data
    // properties and shadow the prototype accessors: re-route them through
    // the setters so they are reflected to attributes.
    for (const prop of OBSERVED_ATTRIBUTES) {
      this._upgradeProperty(prop);
    }

    if (!this.core) {
      this.core = new RollingNumberCore(this, this.readOptions());
    }
  }

  /** Destroys the core: the element is restored and re-rendered on reconnection. */
  disconnectedCallback(): void {
    if (this.core) {
      this.core.destroy();
      this.core = null;
    }
  }

  /** Forwards attribute changes to the core. */
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.core) return;

    if (name === 'value') {
      this.core.setValue(newValue !== null ? raw(newValue) : RN_DEFAULTS.value);
    } else if (name === 'pad') {
      this.core.setPad(newValue !== null ? raw(newValue) : RN_DEFAULTS.pad);
    } else if (name === 'max') {
      this.core.setMax(newValue !== null ? raw(newValue) : RN_DEFAULTS.max);
    } else if (name === 'interpolate') {
      this.core.setInterpolate(parseInterpolate(newValue));
    } else if (name === 'duration') {
      this.core.setDuration(newValue !== null ? raw(newValue) : RN_DEFAULTS.duration);
    }
  }

  /**
   * Re-applies a property that was set on the instance before upgrade.
   * @internal
   */
  private _upgradeProperty(prop: ObservedProperty): void {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const self = this as unknown as Record<string, unknown>;
      const val = self[prop];
      delete self[prop];
      self[prop] = val;
    }
  }

  /**
   * Reads the raw (not yet normalized) options from the current attributes.
   * @internal
   */
  private readOptions(): RollingNumberOptions {
    const value = this.getAttribute('value');
    const pad = this.getAttribute('pad');
    const max = this.getAttribute('max');
    const duration = this.getAttribute('duration');
    return {
      value: value !== null ? raw(value) : RN_DEFAULTS.value,
      pad: pad !== null ? raw(pad) : RN_DEFAULTS.pad,
      max: max !== null ? raw(max) : RN_DEFAULTS.max,
      interpolate: parseInterpolate(this.getAttribute('interpolate')),
      duration: duration !== null ? raw(duration) : RN_DEFAULTS.duration
    };
  }

  /**
   * Reflects a property to its attribute. `null`/`undefined` remove the
   * attribute so the option falls back to its default. The core is driven
   * solely by `attributeChangedCallback`.
   * @internal
   */
  private reflect(name: ObservedProperty, val: unknown): void {
    if (val === null || val === undefined) {
      this.removeAttribute(name);
    } else {
      this.setAttribute(name, String(val));
    }
  }

  // Getter and Setter properties for programmatic usage in JS/Frameworks

  /**
   * The number to display (reflects the `value` attribute). Reads return the
   * normalized target value; setting `null`/`undefined` resets it to `0`.
   * @default 0
   */
  get value(): number {
    return this.core ? this.core.getValue() : normalizeOptions(this.readOptions()).value;
  }

  set value(val: number | null | undefined) {
    this.reflect('value', val);
  }

  /**
   * Minimum number of digit columns, padded with leading zeros (1..64; reflects
   * the `pad` attribute). Setting `null`/`undefined` resets it to `1`.
   * @default 1
   */
  get pad(): number {
    return normalizeOptions(this.readOptions()).pad;
  }

  set pad(val: number | null | undefined) {
    this.reflect('pad', val);
  }

  /**
   * Upper bound of the displayed absolute value, or `null` for none (reflects
   * the `max` attribute). Setting `null`/`undefined` removes the limit.
   * @default null
   */
  get max(): number | null {
    return normalizeOptions(this.readOptions()).max;
  }

  set max(val: number | null | undefined) {
    this.reflect('max', val);
  }

  /**
   * Whether value changes count through the intermediate numbers. `false`
   * reflects as `interpolate="false"`; `true` removes the attribute. Setting
   * `null`/`undefined` resets it to `true`.
   * @default true
   */
  get interpolate(): boolean {
    return parseInterpolate(this.getAttribute('interpolate'));
  }

  set interpolate(val: boolean | null | undefined) {
    const loose = val as unknown;
    const enabled = loose === null || loose === undefined ? RN_DEFAULTS.interpolate : loose !== 'false' && Boolean(loose);
    if (enabled) {
      this.removeAttribute('interpolate');
    } else {
      this.setAttribute('interpolate', 'false');
    }
  }

  /**
   * Interpolation duration in milliseconds (reflects the `duration`
   * attribute). Reads return the duration in use (negative → `0`; a
   * non-numeric attribute keeps the previous duration once connected).
   * Setting `null`/`undefined` resets it to `400`.
   * @default 400
   */
  get duration(): number {
    return this.core ? getCoreDuration(this.core) : normalizeOptions(this.readOptions()).duration;
  }

  set duration(val: number | null | undefined) {
    this.reflect('duration', val);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    /** Animated number counter, see {@link RollingNumberElement}. */
    'rolling-number': RollingNumberElement;
  }
}

/** @internal */
let baseDefined = false;

/**
 * Registers the `<rolling-number>` custom element (or a custom tag name) if not
 * already defined. Safe to call in non-DOM environments (no-op), and safe to
 * call for additional tag names: each extra tag gets its own subclass, since a
 * constructor can only be registered once.
 *
 * @param tagName Custom element name to register (must contain a hyphen).
 *
 * @example
 * ```ts
 * import { defineRollingNumber } from 'rolling-number';
 * defineRollingNumber();            // <rolling-number> (already done on import)
 * defineRollingNumber('my-counter'); // <my-counter>, same API
 * ```
 */
export function defineRollingNumber(tagName: string = 'rolling-number'): void {
  if (typeof window === 'undefined' || !('customElements' in window) || !window.customElements) return;

  const registry = window.customElements;
  if (registry.get(tagName)) return;

  const getName = (registry as { getName?: (ctor: CustomElementConstructor) => string | null }).getName;
  const baseTaken = typeof getName === 'function' ? getName.call(registry, RollingNumberElement) != null : baseDefined;

  if (!baseTaken) {
    try {
      registry.define(tagName, RollingNumberElement);
      baseDefined = true;
      return;
    } catch {
      // Base constructor registered elsewhere (e.g. via customElements.define
      // directly in a browser without getName): fall back to a subclass below.
      if (registry.get(tagName)) return;
    }
  }

  registry.define(tagName, class extends RollingNumberElement {});
}
