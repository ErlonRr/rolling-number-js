import { RollingNumberCore, RN_DEFAULTS, getResolved } from './core';
import {
  OPTION_ATTRIBUTES,
  OPTION_KEYS,
  RN_DEFAULTS_13,
  normalizeField,
  normalizeFormat,
  normalizeValue
} from './options';
import type { NormalizedOptions, OptionKey } from './internal/contracts';
import type {
  RollingNumberEasing,
  RollingNumberFormat,
  RollingNumberLabelInfo,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger,
  RollingNumberUpdate
} from './types';

/**
 * SSR-safe base class: in environments without a DOM (Node, workers, SSR
 * renderers) `HTMLElement` is not defined, so importing this module must not
 * throw. The element is only ever instantiated in a browser, where the real
 * `HTMLElement` is used.
 */
const HTMLElementBase = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as unknown as typeof HTMLElement;

/** Boolean attribute: present → `interpolate: false`, unless its value is `"false"` (React 18 writes `"false"`). */
const NO_INTERPOLATE = 'no-interpolate';

/** Attribute name → option key: {@link OPTION_ATTRIBUTES} reversed, plus `no-interpolate` → `interpolate`. */
const ATTRIBUTE_KEYS: ReadonlyMap<string, OptionKey> = new Map<string, OptionKey>([
  ...OPTION_KEYS.map((key): [string, OptionKey] => [OPTION_ATTRIBUTES[key], key]),
  [NO_INTERPOLATE, 'interpolate']
]);

/** Options that accept a function, kept in a private slot (a function cannot be reflected). */
type FunctionKey = 'easing' | 'label';

/** `setValue()` options waiting for the `value` attribute change they belong to. */
interface ValueStash {
  options: boolean | RollingNumberSetValueOptions | undefined;
  promise: Promise<RollingNumberSettled> | null;
}

/**
 * Options of `<rolling-number>` as written in markup: each one can be given as
 * a typed value (property binding, e.g. React 19 / Vue `:value="5"`) or as its
 * string form (plain attribute, e.g. `pad="3"`). `null`/`undefined` mean
 * "default" (for `duration` and `easing`: unset, so the CSS timing applies).
 * Used by the React JSX and Vue template typings of the custom element; see
 * {@link RollingNumberOptions} for the semantics of each option.
 *
 * @example
 * ```tsx
 * <rolling-number value={count} pad="3" max={99} overflow-suffix="+" interpolate="false" duration={600} />
 * <rolling-number value={price} locale="de-DE" format='{"style":"currency","currency":"EUR"}' />
 * ```
 */
export interface RollingNumberAttributes {
  /** The number to display. Non-numeric → `0`. @default 0 */
  value?: number | `${number}` | null;
  /** Minimum number of integer digits, padded with leading zeros (1..64). @default 1 */
  pad?: number | `${number}` | null;
  /** Upper bound of the displayed absolute value; `null` → no limit. @default null */
  max?: number | `${number}` | null;
  /** `false` / `"false"`: each digit rolls straight to its new digit instead of counting. @default true */
  interpolate?: boolean | 'true' | 'false' | null;
  /**
   * Boolean attribute: present → `interpolate: false`. The value `"false"`
   * counts as absent (React 18 writes `"false"` for `false`).
   */
  'no-interpolate'?: boolean | '' | null;
  /**
   * Duration of animated changes in milliseconds (counting and rolling).
   * Absent: counting uses 400 ms and rolling uses `--rn-duration`.
   */
  duration?: number | `${number}` | null;
  /**
   * Easing: a preset (`'odometer'`, `'ease-out-expo'`, …), a CSS easing
   * string, or (as a property only) a function. Absent: `'ease-out-cubic'`
   * when counting, `--rn-easing` when rolling.
   */
  easing?: RollingNumberEasing | null;
  /** Fixed fraction digits (0..20). Absent: the currency's digits with a currency format, else 0. */
  decimals?: number | `${number}` | null;
  /** BCP 47 locale(s); the attribute takes a comma- or space-separated list (`"fr-CA, fr"`). Switches on Intl formatting. */
  locale?: string | readonly string[] | null;
  /**
   * Intl number formatting: an object as a property, JSON as an attribute
   * (`'{"style":"currency","currency":"EUR"}'`). Invalid JSON is ignored with
   * a one-time warning.
   */
  format?: RollingNumberFormat | string | null;
  /** Static text before the number (and before the sign). @default '' */
  'prefix-text'?: string | null;
  /** Static text after the number. @default '' */
  'suffix-text'?: string | null;
  /** Shown right after the digits when `|value| > max`, e.g. `"+"` → `"99+"`. @default '' */
  'overflow-suffix'?: string | null;
  /** Renderer: `columns` (odometer), `text`, or `auto`. @default 'auto' */
  mode?: RollingNumberMode | null;
  /** Value shown on the first connection; the counter then animates to `value`. Never replayed on reconnection. @default null */
  from?: number | `${number}` | null;
  /** `visible`: animations wait until the counter is on screen. @default 'immediate' */
  trigger?: RollingNumberTrigger | null;
  /** Accessible name: a string with `{value}`, or (as a property only) a function. Default: the formatted target. */
  label?: string | ((info: RollingNumberLabelInfo) => string) | null;
  /** Announce each settled value through a shared live region. An empty value means `'polite'`. @default 'off' */
  live?: RollingNumberLive | '' | null;
  /** `false` / `"false"` opts this counter out of automatic style injection. @default true */
  'inject-styles'?: boolean | 'true' | 'false' | null;
}

/** `interpolate` attribute semantics: absent → true, `"false"` → false, anything else → true. */
function parseInterpolate(attr: string | null): boolean {
  return attr !== 'false';
}

/** `String(val)` that never throws (objects with a throwing `toString`). */
function toAttributeString(val: unknown): string | null {
  try {
    return String(val);
  } catch {
    return null;
  }
}

/**
 * `<rolling-number>`: an animated, odometer-style number counter.
 *
 * Registered by `import 'rolling-number'` or `import 'rolling-number/register'`
 * (or call {@link defineRollingNumber} for a custom tag name). The stylesheet
 * is injected automatically; `rolling-number/style.css` is optional.
 *
 * Every option is available both as an attribute (strings, as in HTML) and as
 * a property (typed). Setting a property reflects it to the attribute; setting
 * it to `null`/`undefined` removes the attribute and restores the default.
 * Only a function `easing` or `label` is not reflected (it is forwarded to the
 * counter directly). Invalid input never throws: it is normalized like
 * {@link RollingNumberOptions}. An absent `duration`/`easing` means unset: the
 * CSS custom properties `--rn-duration`/`--rn-easing` then time the rolls.
 *
 * `setValue(value, options)` sets the value with per-call motion options and
 * returns a promise that resolves when the display settles; `whenSettled()`,
 * `finish()` and `getDisplayValue()` mirror the core API. The `rn-start` and
 * `rn-end` events are dispatched on the element (they bubble and are
 * composed).
 *
 * Rendering happens in light DOM (no shadow root, so there are no CSS parts):
 * the element gets the class `rn-rolling-number`, `role="img"` and an
 * `aria-label` with the target value, plus child nodes `.rn-sign`, `.rn-static`
 * (affixes, separators) and `.rn-col` (one per digit). While a motion runs the
 * element carries the attribute `data-rn-state="animating"` (and the legacy
 * class `rn-interpolating`), removed when it ends: use it as a styling hook.
 * The read-only custom properties `--rn-in` (0..1 presence) and `--rn-w`
 * (measured width) are set inline on entering and leaving nodes.
 *
 * Disconnecting the element destroys its counter; reconnecting renders the
 * current value again without replaying the `from` intro.
 *
 * @tagname rolling-number
 * @summary Animated odometer-style number counter (light DOM, no shadow root).
 *
 * @attr {number} value - The number to display. Rounded to the displayed precision; non-numeric → 0.
 * @attr {number} pad - Minimum number of integer digits, padded with leading zeros (1..64).
 * @attr {number} max - Upper bound of the displayed absolute value (e.g. `99`). Absent, empty or negative → no limit.
 * @attr {"true" | "false"} interpolate - Set to `"false"` to roll each digit straight to its new digit instead of counting through the intermediate numbers. Any other value (or absent) → `true`.
 * @attr {boolean} no-interpolate - Boolean form of `interpolate="false"`. The value `"false"` counts as absent.
 * @attr {number} duration - Duration of animated changes in milliseconds (counting and rolling). Absent: counting uses 400 ms and rolling uses `--rn-duration`. `0` disables counting.
 * @attr {"linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "ease-out-cubic" | "ease-in-out-cubic" | "ease-out-quart" | "ease-out-expo" | "odometer" | string} easing - Easing of animated changes: a preset or a CSS easing (`cubic-bezier(…)`, `linear(…)`, `steps(…)`). Absent: `ease-out-cubic` when counting, `--rn-easing` when rolling.
 * @attr {number} decimals - Fixed fraction digits (0..20). Absent: the currency's digits with a currency format, else 0.
 * @attr {string} locale - BCP 47 locale(s), comma- or space-separated (e.g. `"de-DE"`, `"fr-CA, fr"`). Switches on Intl formatting.
 * @attr {string} format - Intl number formatting as JSON, e.g. `{"style":"currency","currency":"EUR"}`. Invalid JSON is ignored (one-time warning).
 * @attr {string} prefix-text - Static text before the number (and before the sign).
 * @attr {string} suffix-text - Static text after the number.
 * @attr {string} overflow-suffix - Shown right after the digits when the value exceeds `max`, e.g. `+` → "99+".
 * @attr {"auto" | "columns" | "text"} mode - Renderer: odometer `columns`, plain `text`, or `auto`.
 * @attr {number} from - Value shown on the first connection; the counter then animates to `value`. Never replayed on reconnection.
 * @attr {"immediate" | "visible"} trigger - `visible`: animations wait until at least 25% of the counter is in the viewport.
 * @attr {string} label - Accessible name; `{value}` is replaced by the formatted target (e.g. `"{value} unread messages"`).
 * @attr {"off" | "polite" | "assertive"} live - Announce each settled value through a shared live region (an empty value means `polite`).
 * @attr {"true" | "false"} inject-styles - `"false"` opts this counter out of automatic style injection.
 *
 * @fires {RollingNumberEvent} rn-start - The display starts moving from rest (instant changes too, in a microtask). `detail`: `{ value, from, animated }`. Bubbles, composed. Not re-fired when the target changes mid-motion.
 * @fires {RollingNumberEvent} rn-end - The display settled on the target: the DOM is final, then `setValue()` promises resolve. Same `detail`. Bubbles, composed.
 *
 * @cssprop [--rn-duration=0.5s] - Default timing of rolls; a non-default value also times counting when `duration` is absent.
 * @cssprop [--rn-easing=cubic-bezier(0.2, 1, 0.3, 1)] - Default easing of rolls; a non-default value also eases counting when `easing` is absent.
 * @cssprop [--rn-lh=1] - Height of the digit window, in multiples of the font size (also sets the line-height).
 * @cssprop [--rn-fill=none] - Background image painted through the glyphs, e.g. `linear-gradient(…)` with `color: transparent`.
 * @cssprop [--rn-bleed=0px] - Reveals glow and overhangs beyond the digit window (`overflow-clip-margin`); pair it with a larger `--rn-lh`.
 * @cssprop [--rn-decoration=none] - Inherited `text-decoration` painted statically under the digits, e.g. `underline` or `line-through`.
 *
 * @example
 * ```html
 * <script type="module">
 *   import 'rolling-number/register';
 * </script>
 *
 * <rolling-number value="42" pad="3" max="999" duration="600"></rolling-number>
 * <rolling-number value="7" no-interpolate></rolling-number>
 * <rolling-number value="1234.5" locale="de-DE" format='{"style":"currency","currency":"EUR"}'></rolling-number>
 * <rolling-number value="150" max="99" overflow-suffix="+" label="{value} notifications"></rolling-number>
 * ```
 *
 * @example
 * ```ts
 * const el = document.querySelector('rolling-number')!; // typed as RollingNumberElement
 * el.value = 1200;   // number property, reflected to the `value` attribute
 * el.max = null;     // removes the limit
 * el.format = { style: 'percent' };
 * el.addEventListener('rn-end', (e) => console.log(e.detail.value));
 * await el.setValue(0, { motion: 'roll', duration: 800 });
 * ```
 */
export class RollingNumberElement extends HTMLElementBase {
  /** @internal */
  private core: RollingNumberCore | null = null;

  /**
   * Function values of `easing`/`label` (not reflectable). A string attribute
   * set later replaces them.
   * @internal
   */
  private fnSlot: { easing: RollingNumberEasing | null; label: ((info: RollingNumberLabelInfo) => string) | null } = { easing: null, label: null };

  /**
   * The first connection used `from`: reconnecting never replays the intro.
   * @internal
   */
  private fromConsumed = false;

  /**
   * Options of the `setValue()` call in progress, consumed by the `value`
   * attribute change it causes.
   * @internal
   */
  private stash: ValueStash | null = null;

  /**
   * Parsed `format` attribute, cached by its text.
   * @internal
   */
  private formatCache: { attr: string | null; value: RollingNumberFormat | null } = { attr: null, value: null };

  /** Attributes that drive the counter: every option attribute plus `no-interpolate`. */
  static get observedAttributes(): string[] {
    return [...ATTRIBUTE_KEYS.keys()];
  }

  constructor() {
    super();
  }

  /** Creates the counter (re-applying properties set before the upgrade). */
  connectedCallback(): void {
    // Properties assigned before the element was upgraded live as own data
    // properties and shadow the prototype accessors: re-route them through
    // the setters so they are reflected to attributes.
    for (const key of OPTION_KEYS) {
      this._upgradeProperty(key);
    }

    if (!this.core) {
      const options = this.readOptions();
      if (this.fromConsumed) options.from = null;
      this.fromConsumed = true;
      this.core = new RollingNumberCore(this, options);
    }
  }

  /** Destroys the counter: the element is restored and re-rendered on reconnection. */
  disconnectedCallback(): void {
    if (this.core) {
      this.core.destroy();
      this.core = null;
    }
  }

  /** Forwards attribute changes to the counter (the only path from attributes and properties to it). */
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    const key = ATTRIBUTE_KEYS.get(name);
    if (key === undefined) return;
    // A string attribute replaces a function assigned through the property.
    if (newValue !== null && (key === 'easing' || key === 'label')) this.fnSlot[key] = null;

    const core = this.core;
    if (!core || key === 'from') return; // `from` is creation-only

    if (key === 'value') {
      const stash = this.stash;
      if (stash && !stash.promise) {
        stash.promise = core.setValue(this.option('value') as number, stash.options);
      } else {
        void core.setValue(this.option('value') as number);
      }
      return;
    }
    core.update({ [key]: this.option(key) });
  }

  /**
   * Re-applies a property that was set on the instance before upgrade.
   * @internal
   */
  private _upgradeProperty(prop: OptionKey): void {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const self = this as unknown as Record<string, unknown>;
      const val = self[prop];
      delete self[prop];
      self[prop] = val;
    }
  }

  /**
   * The (not yet normalized) value handed to the counter for `key`, read from
   * the attributes and the function slots. Absent `value`/`pad`/`max`/
   * `interpolate` map to their defaults (1.2); every other absent attribute
   * maps to `null` = unset (S5: an absent `duration`/`easing` never becomes 400).
   * @internal
   */
  private option(key: OptionKey): unknown {
    const attr = this.getAttribute(OPTION_ATTRIBUTES[key]);
    switch (key) {
      case 'value':
      case 'pad':
      case 'max':
        // Attribute strings are handed to the core as-is: it normalizes loose input.
        return attr ?? RN_DEFAULTS_13[key];
      case 'interpolate': {
        const no = this.getAttribute(NO_INTERPOLATE);
        return parseInterpolate(attr) && (no === null || no === 'false');
      }
      case 'injectStyles':
        return attr === null ? null : attr !== 'false';
      case 'format':
        return this.parseFormat(attr);
      case 'easing':
      case 'label':
        return attr ?? this.fnSlot[key];
      default:
        return attr;
    }
  }

  /**
   * Normalized option as the counter would see it on creation (property getters).
   * @internal
   */
  private normalized<K extends OptionKey>(key: K): NormalizedOptions[K] {
    return normalizeField(key, this.option(key), RN_DEFAULTS_13);
  }

  /**
   * `format` attribute → object (invalid JSON → `null` and a one-time warning).
   * @internal
   */
  private parseFormat(attr: string | null): RollingNumberFormat | null {
    const cache = this.formatCache;
    if (cache.attr !== attr) {
      cache.attr = attr;
      cache.value = attr === null ? null : normalizeFormat(attr);
    }
    return cache.value;
  }

  /**
   * Every option, read from the attributes (constructor input of the counter).
   * @internal
   */
  private readOptions(): RollingNumberUpdate {
    const options: Record<string, unknown> = {};
    for (const key of OPTION_KEYS) options[key] = this.option(key);
    return options as RollingNumberUpdate;
  }

  /**
   * Reflects a property to its attribute. `null`/`undefined` remove the
   * attribute so the option falls back to its default. The counter is
   * driven solely by `attributeChangedCallback`.
   * @internal
   */
  private reflect(key: OptionKey, val: unknown): void {
    const name = OPTION_ATTRIBUTES[key];
    const text = val === null || val === undefined ? null : toAttributeString(val);
    if (text === null) {
      this.removeAttribute(name);
    } else {
      this.setAttribute(name, text);
    }
  }

  /**
   * Boolean options reflected as `"false"` (default `true` = no attribute).
   * @internal
   */
  private reflectFlag(key: 'interpolate' | 'injectStyles', val: unknown): boolean {
    const enabled = val === null || val === undefined ? RN_DEFAULTS_13[key] : val !== 'false' && Boolean(val);
    if (enabled) {
      this.removeAttribute(OPTION_ATTRIBUTES[key]);
    } else {
      this.setAttribute(OPTION_ATTRIBUTES[key], 'false');
    }
    return enabled;
  }

  /**
   * `easing`/`label` setter: a function goes to the private slot and is
   * forwarded (removing the attribute forwards it through
   * `attributeChangedCallback`); anything else is reflected.
   * @internal
   */
  private setFunctionOption(key: FunctionKey, val: unknown): void {
    const name = OPTION_ATTRIBUTES[key];
    const slot = this.fnSlot as Record<FunctionKey, unknown>;
    if (typeof val === 'function') {
      if (slot[key] === val && !this.hasAttribute(name)) return;
      slot[key] = val;
      if (this.hasAttribute(name)) {
        this.removeAttribute(name);
      } else {
        this.core?.update({ [key]: val });
      }
      return;
    }
    const hadFunction = slot[key] !== null;
    slot[key] = null;
    const before = this.getAttribute(name);
    this.reflect(key, val);
    // The attribute did not change, so attributeChangedCallback will not drop the function.
    if (hadFunction && this.getAttribute(name) === before) this.core?.update({ [key]: this.option(key) });
  }

  // ── Properties ────────────────────────────────────────────────────

  /**
   * The number to display (reflects the `value` attribute). Reads return the
   * normalized target value; setting `null`/`undefined` resets it to `0`.
   * Use {@link RollingNumberElement.setValue} for per-call motion options and
   * a settle promise.
   * @default 0
   */
  get value(): number {
    return this.core ? this.core.getValue() : this.normalized('value');
  }

  set value(val: number | null | undefined) {
    this.reflect('value', val);
  }

  /**
   * Minimum number of integer digits, padded with leading zeros (1..64;
   * reflects the `pad` attribute). Setting `null`/`undefined` resets it to `1`.
   * @default 1
   */
  get pad(): number {
    return this.normalized('pad');
  }

  set pad(val: number | null | undefined) {
    this.reflect('pad', val);
  }

  /**
   * Upper bound of the displayed absolute value, or `null` for none (reflects
   * the `max` attribute), floored to the fraction digits in use. Setting
   * `null`/`undefined` removes the limit.
   * @default null
   */
  get max(): number | null {
    const max = this.normalized('max');
    if (max === null) return null;
    return this.decimals ? max : Math.floor(max);
  }

  set max(val: number | null | undefined) {
    this.reflect('max', val);
  }

  /**
   * Whether value changes count through the intermediate numbers (`false`:
   * each digit rolls straight to its new digit). `false` reflects as
   * `interpolate="false"`; `true` removes `interpolate` and `no-interpolate`.
   * Setting `null`/`undefined` resets it to `true`.
   * @default true
   */
  get interpolate(): boolean {
    return this.normalized('interpolate');
  }

  set interpolate(val: boolean | null | undefined) {
    if (this.reflectFlag('interpolate', val)) this.removeAttribute(NO_INTERPOLATE);
  }

  /**
   * Duration of animated changes in milliseconds (reflects the `duration`
   * attribute). Reads return the duration in use, `400` when unset (negative
   * → `0`; a non-numeric attribute keeps the previous duration once
   * connected). Setting `null`/`undefined` makes it unset again: counting
   * uses 400 ms and rolling uses `--rn-duration`.
   * @default 400
   */
  get duration(): number {
    const duration = this.core ? getResolved(this.core).duration : this.normalized('duration');
    return duration ?? RN_DEFAULTS.duration;
  }

  set duration(val: number | null | undefined) {
    this.reflect('duration', val);
  }

  /**
   * Easing of animated changes (reflects the `easing` attribute): a preset,
   * a CSS easing string, or a function (kept on the element, not reflected).
   * `null` when unset: `'ease-out-cubic'` when counting, `--rn-easing` when
   * rolling.
   * @default null
   */
  get easing(): RollingNumberEasing | null {
    return this.normalized('easing');
  }

  set easing(val: RollingNumberEasing | null | undefined) {
    this.setFunctionOption('easing', val);
  }

  /**
   * Fraction digits (reflects the `decimals` attribute). Reads return the
   * digits in use once connected (e.g. `2` for a EUR currency format without
   * `decimals`); before that, the attribute, or `null` when unset (auto).
   * @default null
   */
  get decimals(): number | null {
    return this.core ? getResolved(this.core).f : this.normalized('decimals');
  }

  set decimals(val: number | null | undefined) {
    this.reflect('decimals', val);
  }

  /**
   * BCP 47 locale(s) (reflects the `locale` attribute, a comma- or
   * space-separated list). Reads return the normalized list joined by
   * commas, or `null`; an array is accepted and reflected comma-separated.
   * @default null
   */
  get locale(): string | null {
    const list = this.normalized('locale');
    return list ? list.join(',') : null;
  }

  set locale(val: string | readonly string[] | null | undefined) {
    this.reflect('locale', Array.isArray(val) ? val.join(',') : val);
  }

  /**
   * Intl number formatting (reflects the `format` attribute as JSON). Reads
   * return the parsed object, or `null` when absent or invalid.
   * @default null
   */
  get format(): RollingNumberFormat | null {
    return this.parseFormat(this.getAttribute(OPTION_ATTRIBUTES.format));
  }

  set format(val: RollingNumberFormat | null | undefined) {
    if (val !== null && typeof val === 'object') {
      let json: string | undefined;
      try {
        json = JSON.stringify(val);
      } catch {
        json = undefined;
      }
      this.reflect('format', json);
    } else {
      this.reflect('format', val);
    }
  }

  /**
   * Static text before the number and its sign (reflects `prefix-text`).
   * @default ''
   */
  get prefixText(): string {
    return this.normalized('prefixText');
  }

  set prefixText(val: string | null | undefined) {
    this.reflect('prefixText', val);
  }

  /**
   * Static text after the number (reflects `suffix-text`).
   * @default ''
   */
  get suffixText(): string {
    return this.normalized('suffixText');
  }

  set suffixText(val: string | null | undefined) {
    this.reflect('suffixText', val);
  }

  /**
   * Text shown after the digits when `|value| > max`, e.g. `'+'` → "99+"
   * (reflects `overflow-suffix`).
   * @default ''
   */
  get overflowSuffix(): string {
    return this.normalized('overflowSuffix');
  }

  set overflowSuffix(val: string | null | undefined) {
    this.reflect('overflowSuffix', val);
  }

  /**
   * Renderer (reflects `mode`): `'columns'` (odometer), `'text'` or `'auto'`.
   * @default 'auto'
   */
  get mode(): RollingNumberMode {
    return this.normalized('mode');
  }

  set mode(val: RollingNumberMode | null | undefined) {
    this.reflect('mode', val);
  }

  /**
   * Value shown on the first connection, before animating to `value`
   * (reflects `from`). Used once: reconnecting never replays the intro.
   * @default null
   */
  get from(): number | null {
    return this.normalized('from');
  }

  set from(val: number | null | undefined) {
    this.reflect('from', val);
  }

  /**
   * When animations may run (reflects `trigger`): `'immediate'`, or
   * `'visible'` (wait until at least 25% of the counter is in the viewport).
   * @default 'immediate'
   */
  get trigger(): RollingNumberTrigger {
    return this.normalized('trigger');
  }

  set trigger(val: RollingNumberTrigger | null | undefined) {
    this.reflect('trigger', val);
  }

  /**
   * Accessible name (reflects `label`): a string where `{value}` is replaced
   * by the formatted target, or a function (kept on the element, not
   * reflected). `null`: the default label (the formatted target).
   * @default null
   */
  get label(): string | ((info: RollingNumberLabelInfo) => string) | null {
    return this.normalized('label');
  }

  set label(val: string | ((info: RollingNumberLabelInfo) => string) | null | undefined) {
    this.setFunctionOption('label', val);
  }

  /**
   * Live announcements of each settled value (reflects `live`): `'off'`,
   * `'polite'` or `'assertive'`.
   * @default 'off'
   */
  get live(): RollingNumberLive {
    return this.normalized('live');
  }

  set live(val: RollingNumberLive | null | undefined) {
    const loose = val as unknown;
    this.reflect('live', loose === true ? 'polite' : loose === false ? null : loose);
  }

  /**
   * Automatic style injection for this counter. `false` reflects as
   * `inject-styles="false"`; `true` removes the attribute.
   * @default true
   */
  get injectStyles(): boolean {
    return this.normalized('injectStyles');
  }

  set injectStyles(val: boolean | null | undefined) {
    this.reflectFlag('injectStyles', val);
  }

  // ── Methods ───────────────────────────────────────────────────────

  /**
   * Sets the value (reflected to the `value` attribute) with per-call motion
   * options, and resolves when it settles.
   *
   * @param value New target value.
   * @param animate `true`: count; `false`: roll; or per-call options
   *   (`{ motion, duration, easing }`). Defaults to the `interpolate` option.
   * @returns Resolves `{ value, completed: true }` when the display settles on
   *   `value`; `completed: false` when superseded, or when the element is not
   *   connected. Never rejects.
   *
   * @example
   * ```ts
   * await el.setValue(250);
   * el.setValue(0, { motion: 'none' }); // instant
   * ```
   */
  setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled> {
    const core = this.core;
    if (!core) {
      this.reflect('value', value);
      return Promise.resolve({ value: normalizeValue(value), completed: false });
    }
    const stash: ValueStash = { options: animate, promise: null };
    this.stash = stash;
    try {
      this.reflect('value', value);
    } finally {
      this.stash = null;
    }
    // Unchanged attribute string: attributeChangedCallback returned early.
    return stash.promise ?? core.setValue(value, animate);
  }

  /**
   * Resolves when the current motion settles (immediately when idle).
   *
   * @returns `{ value, completed }` as for {@link RollingNumberElement.setValue};
   *   `completed: false` when the element is not connected.
   */
  whenSettled(): Promise<RollingNumberSettled> {
    return this.core ? this.core.whenSettled() : Promise.resolve({ value: this.value, completed: false });
  }

  /** Jumps to the target now: final DOM, `rn-end`, pending promises resolve. No-op when idle or not connected. */
  finish(): void {
    this.core?.finish();
  }

  /**
   * Value on screen (signed; fractional mid-count).
   *
   * @returns The displayed value, or the target value when not connected.
   */
  getDisplayValue(): number {
    return this.core ? this.core.getDisplayValue() : this.value;
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
