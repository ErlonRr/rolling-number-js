/**
 * Option keys, defaults and normalization of the v1.3 options (single source:
 * every adapter, the element, the action and the SSR helpers iterate
 * {@link OPTION_KEYS} and read {@link OPTION_ATTRIBUTES}). Internal: not
 * re-exported by the package entry points.
 *
 * Semantics (docs/design/v1.3.md §2.2):
 * - {@link resolveOptions} (constructor): `undefined` and `null` → default;
 *   a non-finite `duration` → `null` (unset).
 * - {@link normalizeField} (`update()`): `undefined` → unchanged, `null` →
 *   default; a non-finite `duration` keeps the current value.
 *
 * @internal
 * @module
 */
import type {
  RollingNumberEasing, RollingNumberFormat, RollingNumberLabelInfo, RollingNumberLive,
  RollingNumberMode, RollingNumberOptions, RollingNumberTrigger, RollingNumberUpdate
} from './types';
import type { NormalizedOptions, OptionKey } from './internal/contracts';
import { warn } from './internal/warn';

/** Every option name, in the order adapters apply them (`value` stays last in `update()`). */
export const OPTION_KEYS = [
  'value', 'pad', 'max', 'interpolate', 'duration', 'easing', 'decimals', 'locale', 'format',
  'prefixText', 'suffixText', 'overflowSuffix', 'mode', 'from', 'trigger', 'label', 'live', 'injectStyles'
] as const satisfies readonly (keyof RollingNumberOptions)[];

/** Options whose change alters the number's layout: `update()` finishes the motion and relayouts. */
export const LAYOUT_KEYS = [
  'pad', 'max', 'decimals', 'locale', 'format', 'prefixText', 'suffixText', 'overflowSuffix', 'mode'
] as const satisfies readonly OptionKey[];

/** HTML attribute name of each option (`prefixText` → `prefix-text`), used by `<rolling-number>` and `renderStaticHTML`. */
export const OPTION_ATTRIBUTES: Readonly<Record<OptionKey, string>> = Object.freeze({
  value: 'value',
  pad: 'pad',
  max: 'max',
  interpolate: 'interpolate',
  duration: 'duration',
  easing: 'easing',
  decimals: 'decimals',
  locale: 'locale',
  format: 'format',
  prefixText: 'prefix-text',
  suffixText: 'suffix-text',
  overflowSuffix: 'overflow-suffix',
  mode: 'mode',
  from: 'from',
  trigger: 'trigger',
  label: 'label',
  live: 'live',
  injectStyles: 'inject-styles'
});

/**
 * Normalized defaults. `duration`, `easing`, `decimals`, `locale`, `format`
 * and `label` are `null` = auto/unset.
 */
export const RN_DEFAULTS_13: Readonly<NormalizedOptions> = Object.freeze({
  value: 0,
  pad: 1,
  max: null,
  interpolate: true,
  duration: null,
  easing: null,
  decimals: null,
  locale: null,
  format: null,
  prefixText: '',
  suffixText: '',
  overflowSuffix: '',
  mode: 'auto',
  from: null,
  trigger: 'immediate',
  label: null,
  live: 'off',
  injectStyles: true
});

/** Upper bound for `pad`, prevents runaway DOM creation (e.g. pad=20000). */
export const MAX_PAD = 64;
/** Upper bound for `decimals` (the Intl limit). */
export const MAX_DECIMALS = 20;

/** `src[key]`, or `undefined` when reading it throws (hostile getters and proxies are tolerated). */
export function readOption(src: Record<string, unknown>, key: string): unknown {
  try {
    return src[key];
  } catch {
    return undefined;
  }
}

/**
 * Converts loose input to a number. null, undefined, blank strings and
 * non-coercible values (symbols, throwing valueOf) become NaN.
 */
export function toNumber(input: unknown): number {
  if (input === null || input === undefined) return NaN;
  if (typeof input === 'number') return input;
  if (typeof input === 'string') return input.trim() === '' ? NaN : Number(input);
  try {
    return Number(input);
  } catch {
    return NaN;
  }
}

/** `value`: non-finite → 0, magnitude clamped to `Number.MAX_SAFE_INTEGER` (1.x). */
export function normalizeValue(input: unknown): number {
  const n = toNumber(input);
  if (!Number.isFinite(n)) return 0;
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  if (n < -Number.MAX_SAFE_INTEGER) return -Number.MAX_SAFE_INTEGER;
  return n;
}

/** `pad`: non-finite or < 1 → 1, floored, max 64 (1.x). */
export function normalizePad(input: unknown): number {
  const n = toNumber(input);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_PAD, Math.floor(n));
}

/**
 * `max` (1.x normalization): null/''/negative/non-finite → null, floored.
 * The 1.2 shims and the WP0 core use it; v1.3 code keeps the fraction
 * through {@link normalizeMaxExact} (the formatter floors it to `decimals` places).
 */
export function normalizeMax(input: unknown): number | null {
  const n = normalizeMaxExact(input);
  return n === null ? null : Math.floor(n);
}

/** `max` for v1.3: null/''/negative/non-finite → null; otherwise the number as given (floored to `decimals` places later). */
export function normalizeMaxExact(input: unknown): number | null {
  const n = toNumber(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Boolean options: null/undefined → `fallback`, the string 'false' → false, otherwise `Boolean()` (1.x `interpolate` rule). */
export function normalizeInterpolate(input: unknown, fallback: boolean): boolean {
  if (input === null || input === undefined) return fallback;
  if (input === 'false') return false;
  return Boolean(input);
}

/** `duration`: negative → 0; non-finite or null → null (unset). */
function normalizeDuration(input: unknown): number | null {
  const n = toNumber(input);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/** `easing`: functions and non-empty strings are kept (validated by the engine, which warns once); anything else → unset. */
function normalizeEasing(input: unknown): RollingNumberEasing | null {
  if (typeof input === 'function') return input as RollingNumberEasing;
  if (typeof input === 'string') {
    const s = input.trim();
    return s === '' ? null : (s as RollingNumberEasing);
  }
  return null;
}

/** `decimals`: non-finite/null → auto; otherwise floored and clamped to 0..20. */
function normalizeDecimals(input: unknown): number | null {
  const n = toNumber(input);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_DECIMALS, Math.max(0, Math.floor(n)));
}

/** `locale`: a string (comma- or space-separated list) or an array of strings; empty → null. Frozen. */
function normalizeLocale(input: unknown): readonly string[] | null {
  let list: string[] = [];
  if (typeof input === 'string') {
    list = input.split(/[\s,]+/);
  } else if (Array.isArray(input)) {
    list = input.filter((x): x is string => typeof x === 'string').map((x) => x.trim());
  }
  list = list.filter((x) => x !== '');
  return list.length ? Object.freeze(list) : null;
}

let warnedFormatJson = false;

/**
 * `format`: a plain object (shallow-copied and frozen), or its JSON text (the
 * `format` attribute); anything else → null. Invalid JSON warns once.
 */
export function normalizeFormat(input: unknown): RollingNumberFormat | null {
  let obj: unknown = input;
  if (typeof input === 'string') {
    const s = input.trim();
    if (s === '') return null;
    try {
      obj = JSON.parse(s);
    } catch {
      obj = null;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      if (!warnedFormatJson) {
        warnedFormatJson = true;
        warn(
          `Ignoring format ${JSON.stringify(s.slice(0, 60))}: expected a JSON object such as ` +
            '{"style":"currency","currency":"EUR"}. With React 19, define <rolling-number> before rendering ' +
            'so the property (not the attribute) receives the object.'
        );
      }
      return null;
    }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return Object.freeze({ ...(obj as RollingNumberFormat) });
}

/** Text options: null/undefined → ''; otherwise `String()`. */
function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  try {
    return String(input);
  } catch {
    return '';
  }
}

function normalizeMode(input: unknown): RollingNumberMode {
  return input === 'columns' || input === 'text' ? input : 'auto';
}

/** `from`: finite → clamped like `value`; anything else → null (no intro). */
function normalizeFrom(input: unknown): number | null {
  const n = toNumber(input);
  return Number.isFinite(n) ? normalizeValue(n) : null;
}

function normalizeTrigger(input: unknown): RollingNumberTrigger {
  return input === 'visible' ? 'visible' : 'immediate';
}

/** `label`: a function or a non-empty string; anything else → null (default label). */
function normalizeLabel(input: unknown): string | ((info: RollingNumberLabelInfo) => string) | null {
  if (typeof input === 'function') return input as (info: RollingNumberLabelInfo) => string;
  if (typeof input === 'string' && input !== '') return input;
  return null;
}

/** `live`: 'polite' | 'assertive'; `true` or '' (boolean attribute) → 'polite'; anything else → 'off'. */
function normalizeLive(input: unknown): RollingNumberLive {
  if (input === 'polite' || input === 'assertive') return input;
  if (input === true || input === '') return 'polite';
  return 'off';
}

type Normalizers = { [K in OptionKey]: (input: unknown) => NormalizedOptions[K] };

/** Per-field normalization of a defined, non-null input. */
const NORMALIZERS: Normalizers = {
  value: normalizeValue,
  pad: normalizePad,
  max: normalizeMaxExact,
  interpolate: (x) => normalizeInterpolate(x, RN_DEFAULTS_13.interpolate),
  duration: normalizeDuration,
  easing: normalizeEasing,
  decimals: normalizeDecimals,
  locale: normalizeLocale,
  format: normalizeFormat,
  prefixText: normalizeText,
  suffixText: normalizeText,
  overflowSuffix: normalizeText,
  mode: normalizeMode,
  from: normalizeFrom,
  trigger: normalizeTrigger,
  label: normalizeLabel,
  live: normalizeLive,
  injectStyles: (x) => normalizeInterpolate(x, RN_DEFAULTS_13.injectStyles)
};

/**
 * Constructor semantics: every field of `o` is normalized; `undefined` and
 * `null` give the default; a non-finite `duration` is unset (`null`).
 * Never throws (hostile getters and values are tolerated).
 */
export function resolveOptions(o: RollingNumberUpdate | null | undefined): NormalizedOptions {
  const src = (o !== null && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const out = { ...RN_DEFAULTS_13 } as NormalizedOptions;
  for (const key of OPTION_KEYS) {
    const raw = readOption(src, key);
    if (raw === undefined || raw === null) continue;
    (out as Record<OptionKey, unknown>)[key] = NORMALIZERS[key](raw);
  }
  return out;
}

/**
 * `update()` semantics for one field: `undefined` → `current[key]` (unchanged),
 * `null` → the default, otherwise normalized. A non-finite `duration` keeps
 * the current value (1.x `setDuration`).
 */
export function normalizeField<K extends OptionKey>(key: K, raw: unknown, current: NormalizedOptions): NormalizedOptions[K] {
  if (raw === undefined) return current[key];
  if (raw === null) return RN_DEFAULTS_13[key];
  if (key === 'duration' && !Number.isFinite(toNumber(raw))) return current[key];
  return NORMALIZERS[key](raw);
}
