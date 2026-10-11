/**
 * Public types of rolling-number (options, events, formatting, configuration).
 * Types only: re-exported by every entry point.
 *
 * @module
 */

/**
 * Named easings. CSS keywords map to their cubic-bezier; `ease-out-cubic` is
 * the 1.x count curve; `odometer` = `cubic-bezier(0.2, 1, 0.3, 1)`, the 1.x
 * roll curve and the `--rn-easing` default.
 */
export type RollingNumberEasingName =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic'
  | 'ease-out-quart'
  | 'ease-out-expo'
  | 'odometer';

/**
 * Easing of an animation: a preset, a CSS easing string
 * (`cubic-bezier(x1, y1, x2, y2)` with x1, x2 in [0, 1], `linear(…)`,
 * `steps(…)`), or a function mapping progress [0, 1] → [0, 1] (it must return
 * 0 at 0 and 1 at 1; it may overshoot: overshoot bounces the digits when
 * rolling and is flattened at the endpoints when counting).
 * Invalid strings fall back to the default with a one-time console warning.
 *
 * @example
 * ```ts
 * core.update({ easing: 'ease-out-expo' });
 * core.update({ easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
 * core.update({ easing: (p) => 1 - (1 - p) ** 4 });
 * ```
 */
export type RollingNumberEasing =
  | RollingNumberEasingName
  | `cubic-bezier(${string})`
  | `linear(${string})`
  | `steps(${string})`
  | ((progress: number) => number);

/**
 * How the value is drawn.
 * - `auto`: `text` for text-like `<input>`, `<textarea>`, `<option>` and SVG
 *   `<text>`/`<tspan>`/`<textPath>`; `columns` otherwise.
 * - `columns`: odometer digit columns appended to the host.
 * - `text`: the host's text (or `value` for form controls) is rewritten on
 *   every frame.
 */
export type RollingNumberMode = 'auto' | 'columns' | 'text';

/**
 * When animations may run.
 * - `immediate`: animate as soon as the value changes.
 * - `visible`: animations wait until at least 25% of the host is in the viewport.
 */
export type RollingNumberTrigger = 'immediate' | 'visible';

/** Opt-in screen-reader announcement of the settled value through a shared live region. */
export type RollingNumberLive = 'off' | 'polite' | 'assertive';

/**
 * Intl options common to every `format.style`. The locale is the top-level
 * `locale` option; fraction digits are `decimals`.
 */
export interface RollingNumberFormatBase {
  /** Group separators (`1,234`). Default when Intl formatting is on: Intl's default (`'auto'`). */
  useGrouping?: boolean | 'always' | 'auto' | 'min2';
  /**
   * Sign policy. `'always'` shows `+` on positives; `'never'` hides the sign.
   * @default 'auto'
   */
  signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero' | 'negative';
  /** Numbering system for native digits, e.g. `'arab'`, `'deva'`, `'thai'`. Default: the locale's. */
  numberingSystem?: string;
}

/** Sanctioned Intl units (autocompleted); any string is still accepted. */
export type RollingNumberUnit =
  | 'percent'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'bit'
  | 'byte'
  | 'kilobyte'
  | 'megabyte'
  | 'gigabyte'
  | 'terabyte'
  | 'meter'
  | 'kilometer'
  | 'centimeter'
  | 'mile'
  | 'foot'
  | 'inch'
  | 'gram'
  | 'kilogram'
  | 'pound'
  | 'liter'
  | 'milliliter'
  | 'celsius'
  | 'fahrenheit'
  | 'degree'
  | 'kilometer-per-hour'
  | 'mile-per-hour'
  | 'meter-per-second'
  | (string & {});

/** Keys that belong to `style: 'currency'`; `never` makes `{ currency: 'EUR' }` without the style a type error. */
interface RollingNumberNoCurrency {
  currency?: never;
  currencyDisplay?: never;
  currencySign?: never;
}

/** Keys that belong to `style: 'unit'`. */
interface RollingNumberNoUnit {
  unit?: never;
  unitDisplay?: never;
}

/**
 * Intl number formatting, discriminated by `style`: `currency` requires
 * `currency`, `unit` requires `unit`. Setting `format` or `locale` switches on
 * Intl formatting; otherwise the output is the 1.x plain format.
 *
 * @example
 * ```ts
 * { style: 'currency', currency: 'EUR' }           // "€1,234.50" (decimals: the currency's)
 * { style: 'percent' }                             // 0.25 → "25%"
 * { style: 'unit', unit: 'kilometer-per-hour' }    // "88 km/h"
 * { useGrouping: false, signDisplay: 'always' }    // "+1234"
 * ```
 */
export type RollingNumberFormat =
  | (RollingNumberFormatBase & RollingNumberNoCurrency & RollingNumberNoUnit & { style?: 'decimal' })
  | (RollingNumberFormatBase & RollingNumberNoCurrency & RollingNumberNoUnit & {
      /** `0.25` → `"25%"` (the value is multiplied by 100). */
      style: 'percent';
    })
  | (RollingNumberFormatBase &
      RollingNumberNoUnit & {
        style: 'currency';
        /** ISO 4217 code, e.g. `'EUR'`. */
        currency: string;
        currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
        currencySign?: 'standard' | 'accounting';
      })
  | (RollingNumberFormatBase &
      RollingNumberNoCurrency & {
        style: 'unit';
        /** Sanctioned unit or `a-per-b`, e.g. `'kilometer-per-hour'`. */
        unit: RollingNumberUnit;
        unitDisplay?: 'short' | 'narrow' | 'long';
      });

/** Argument of a `label` function. */
export interface RollingNumberLabelInfo {
  /** Formatted target as text, with affixes, unclamped by `max` (e.g. `"$1,234.50"`, `"150"`). */
  text: string;
  /** Normalized target value. */
  value: number;
  /** `true` when `|value| > max` (the display is clamped and shows `overflowSuffix`). */
  overflow: boolean;
}

/** Per-call overrides of `setValue`. */
export interface RollingNumberSetValueOptions {
  /**
   * `'count'`: count through the values; `'roll'`: each digit rolls straight
   * to its new digit; `'none'`: instant. Default: from `interpolate`.
   */
  motion?: 'count' | 'roll' | 'none';
  /** Duration of this change in ms (`0` = instant). */
  duration?: number;
  /** Easing of this change. */
  easing?: RollingNumberEasing;
}

/** Resolution of `setValue()` / `whenSettled()`. Never rejects. */
export interface RollingNumberSettled {
  /** The target this promise was waiting for. */
  value: number;
  /** `true`: the display settled on `value`. `false`: superseded by another target, or `destroy()`. */
  completed: boolean;
}

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

/** Global configuration (`configureRollingNumber`). Shared across the ESM and CJS copies of the package. */
export interface RollingNumberConfig {
  /**
   * Inject the stylesheet into every Document/ShadowRoot that hosts a counter.
   * @default true
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for the `<style>` fallback (only used where constructable
   * stylesheets are unavailable).
   * @default null
   */
  nonce?: string | null;
}

/**
 * Options accepted by `RollingNumberCore` and by every framework adapter
 * (`<RollingNumber>` for React/Vue, `v-rolling-number`, the Angular
 * `[rollingNumber]` directive, the `rollingNumber()` action and the
 * `<rolling-number>` custom element, whose attributes use the kebab-case names).
 *
 * Every field is optional. Invalid input never throws: it is normalized as
 * described on each field. The 1.x fields keep their names, types, defaults
 * and normalization.
 *
 * @example
 * ```ts
 * import { RollingNumberCore } from 'rolling-number';
 *
 * const counter = new RollingNumberCore(document.querySelector('#badge')!, {
 *   value: 0,
 *   pad: 2,          // always show at least 2 digits: "07"
 *   max: 99,         // never display more than 99…
 *   overflowSuffix: '+', // …and show "99+" past it
 *   duration: 600    // ms
 * });
 * counter.setValue(42);
 *
 * new RollingNumberCore(price, {
 *   value: 1234.5,
 *   locale: 'de-DE',
 *   format: { style: 'currency', currency: 'EUR' } // "1.234,50 €"
 * });
 * ```
 */
export interface RollingNumberOptions {
  // ── 1.x ───────────────────────────────────────────────────────────

  /**
   * The number to display (the target value).
   *
   * Non-finite input (`NaN`, `Infinity`, non-numeric strings) becomes `0`. The
   * magnitude is clamped to `Number.MAX_SAFE_INTEGER`, and further to
   * `MAX_SAFE_INTEGER / (scale · 10^decimals)` when decimals or percent are
   * used. It is rounded half away from zero to the displayed precision
   * (`1.5` → `2`, `-1.5` → `-2` with no decimals).
   *
   * @default 0
   */
  value?: number;
  /**
   * Minimum number of integer digits: shorter numbers are padded with leading
   * zeros (`pad: 3` shows `7` as `007`). Longer numbers are never truncated.
   *
   * Range `1..64`: non-finite or `< 1` → `1`, decimals are floored, values
   * above 64 are clamped to 64. Past 21 with Intl formatting, the extra zeros
   * are prepended without group separators.
   *
   * @default 1
   */
  pad?: number;
  /**
   * Upper bound of the displayed absolute value (after percent scaling),
   * floored to `decimals` places, e.g. `99` for a notification badge. The
   * target value itself is kept (the label shows the real value); only the
   * display is clamped. Combine with `overflowSuffix` to show `"99+"`.
   *
   * `null`, `undefined`, `''`, negative or non-finite input → `null` (no limit).
   *
   * @default null
   */
  max?: number | null;
  /**
   * `true`: value changes count through the intermediate values (continuous
   * odometer). `false`: each digit rolls straight to its new digit.
   * With reduced motion every change is instant.
   *
   * `null`/`undefined` → `true` (the default), the string `'false'` → `false`,
   * other values use `Boolean()`.
   *
   * @default true
   */
  interpolate?: boolean;
  /**
   * Duration of animated changes, in milliseconds.
   * - unset: counting uses 400 and rolling uses `--rn-duration` (0.5s); a
   *   non-default `--rn-duration` drives both;
   * - `> 0`: used for counting **and** rolling;
   * - `0`: no counting (1.x meaning); the change rolls with the CSS timing.
   *
   * Negative → `0`. Non-finite at creation → unset; in `setDuration`/`update`
   * a non-finite number keeps the current value and `null` resets to unset.
   *
   * @default 400 (effective counting duration when unset)
   */
  duration?: number;

  // ── 1.3 ───────────────────────────────────────────────────────────

  /**
   * Easing of animated changes. Unset: `'ease-out-cubic'` when counting and
   * `--rn-easing` (default `'odometer'`) when rolling; a non-default
   * `--rn-easing` drives both.
   */
  easing?: RollingNumberEasing;
  /**
   * Fixed fraction digits, `0..20`. Unset: the currency's digits with
   * `format.style: 'currency'`, else `0`.
   */
  decimals?: number;
  /**
   * BCP 47 locale(s), e.g. `'de-DE'` or `['fr-CA', 'fr']`. Setting `locale` or
   * `format` switches on Intl formatting (separators, native digits, affixes).
   * Invalid → the runtime default locale (with a warning).
   */
  locale?: string | readonly string[];
  /** Intl number formatting. See {@link RollingNumberFormat}. */
  format?: RollingNumberFormat;
  /**
   * Static text before the number (and before the sign), rendered as text.
   * Included in the label.
   * @default ''
   */
  prefixText?: string;
  /**
   * Static text after the number. Included in the label.
   * @default ''
   */
  suffixText?: string;
  /**
   * Shown right after the digits when `|value| > max`, e.g. `'+'` → `"99+"`.
   * Ignored when `max` is null.
   * @default ''
   */
  overflowSuffix?: string;
  /**
   * Renderer. Changing it at runtime finishes the current motion and
   * re-creates the renderer. See {@link RollingNumberMode}.
   * @default 'auto'
   */
  mode?: RollingNumberMode;
  /**
   * Value shown at creation; the counter then animates to `value` (respecting
   * `trigger`). Creation-only. Skipped when an SSR fallback (`[data-rn-ssr]`)
   * is adopted and the host is visible, so server-rendered content never
   * regresses.
   * @default null
   */
  from?: number | null;
  /**
   * When animations may run. See {@link RollingNumberTrigger}.
   * @default 'immediate'
   */
  trigger?: RollingNumberTrigger;
  /**
   * Accessible name in columns mode: a string where `{value}` is replaced by
   * the formatted target, or a function. Default: the target (1.x), formatted
   * when formatting options are set.
   *
   * @example
   * ```ts
   * { label: '{value} unread messages' }
   * { label: ({ text, overflow }) => (overflow ? 'Many' : text) + ' notifications' }
   * ```
   */
  label?: string | ((info: RollingNumberLabelInfo) => string);
  /**
   * Announce each settled value through a shared live region (debounced 300 ms).
   * @default 'off'
   */
  live?: RollingNumberLive;
  /**
   * Per-instance switch for automatic style injection (the global
   * `configureRollingNumber({ injectStyles: false })` wins).
   * @default true
   */
  injectStyles?: boolean;
}

/**
 * Options accepted by the constructor and `update()`: `undefined` =
 * unchanged (update) / default (constructor), `null` = reset to the default.
 */
export type RollingNumberUpdate = { [K in keyof RollingNumberOptions]?: RollingNumberOptions[K] | null };
