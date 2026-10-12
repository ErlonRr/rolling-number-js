/**
 * Number formatting (plain 1.x path and Intl), layouts, motion layouts and the
 * label (docs/design/v1.3.md §7, §3.3). Owned by WP2.
 *
 * DOM-free: only `Intl` and `console` are used, so the SSR helpers and Vue's
 * `getSSRProps` can call it on the server.
 *
 * Units: `A` is the signed displayed number in last-digit units
 * (`A = value · S · 10^f`, `S` = 100 for percent), always a safe integer.
 * Every text is formatted from `A`, never from the raw value, so "-0" never
 * shows.
 *
 * Written with closures (not a class) so the minifier can mangle the
 * internals: this module ships in the main, action and SSR bundles.
 *
 * @internal
 * @module
 */
import type {
  DisplayState, Formatter, LayoutShape, MotionToken, NormalizedOptions, NumberLayout, Tie, Token, TokenRole
} from './internal/contracts';
import { warn } from './internal/warn';

type NF = Intl.NumberFormat;
type NFOptions = Record<string, unknown>;
/** One part of `Intl.NumberFormat#formatToParts` (also produced by the plain path). */
interface Part { type: string; value: string; }

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
/** Intl's limit for `minimumIntegerDigits`; extra pad zeros are prepended without separators. */
const INTL_MAX_INT = 21;
/** Upper bound of a layout's integer digits (`pad` ≤ 64; a safe integer has ≤ 16 digits). */
const MAX_INT = 64;
/** Plain-path sign in columns (texts and labels use ASCII `-`). */
const MINUS = '−';
/** `format` keys forwarded to Intl; anything else (notation, digit options, …) is stripped with a one-time warning. */
const INTL_KEYS = 'style currency currencyDisplay currencySign unit unitDisplay useGrouping signDisplay numberingSystem'.split(' ');
const SIDES = ['pre', 'post'] as const;

// ── helpers ───────────────────────────────────────────────────────────

const warned = new Set<string>();

/** `console.warn` once per `id` for the lifetime of the module. */
function warnOnce(id: string, message: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  warn(message);
}

/**
 * `x · 10^f` as an integer, rounded half away from zero or floored, computed
 * on the shortest decimal representation of `x` (what `String(x)` and Intl
 * print): `1.005` with `f = 2` gives 101, like Intl, not the binary-float 100.
 * `x` is finite and ≥ 0; with `f = 0` this equals `Math.round` / `Math.floor`.
 */
function scaleDecimal(x: number, f: number, floor?: boolean): number {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(x));
  if (!m) return Math[floor ? 'floor' : 'round'](x * 10 ** f);
  const frac = m[2] || '';
  let digits = m[1] + frac;
  const cut = frac.length - f - (m[3] ? +m[3] : 0);
  if (cut <= 0) return +(digits + '0'.repeat(-cut));
  digits = digits.padStart(cut + 1, '0');
  const head = +digits.slice(0, -cut);
  return !floor && digits.charCodeAt(digits.length - cut) > 52 ? head + 1 : head;
}

/** Integer and fraction digits of a safe integer magnitude: (12345, 2) → ['123', '45']. */
function splitDigits(absA: number, f: number): [string, string] {
  const s = String(absA).padStart(f + 1, '0');
  return [s.slice(0, s.length - f), s.slice(s.length - f)];
}

/** Exact decimal string of `digits · 10^-shift` (Intl keeps every digit of a numeric string): ('12345', 2) → '123.45'. */
function toDecimal(digits: string, shift: number, negative: boolean): string {
  if (shift > 0) {
    digits = digits.padStart(shift + 1, '0');
    digits = digits.slice(0, -shift) + '.' + digits.slice(-shift);
  }
  return negative ? '-' + digits : digits;
}

/** A finite, safe, integral `A` (callers pass `round(fs.A)` or clamped targets). */
function safeA(A: number): number {
  return Number.isFinite(A) ? Math.max(-MAX_SAFE, Math.min(MAX_SAFE, Math.round(A))) || 0 : 0;
}

const codePoints = (s: string): number => Array.from(s).length;
const joinParts = (parts: Part[]): string => parts.map((p) => p.value).join('');

function roleOf(partType: string): TokenRole {
  return partType == 'currency' || partType == 'unit' ? partType : partType == 'percentSign' ? 'percent' : 'literal';
}

/**
 * Identity of a static part across the layouts of one formatter: a literal by
 * its text, a currency/unit/percent part by its role only, since a name follows
 * the plural form of the number ("1 day", "5 days") and keeps its key.
 */
function idOf(p: Part): string {
  const role = roleOf(p.type);
  return role == 'literal' ? role + '\0' + p.value : role;
}

function makeNF(locales: string[] | undefined, opts: NFOptions): NF {
  return new Intl.NumberFormat(locales, opts as Intl.NumberFormatOptions);
}

/** Parts of a numeric string (exact on engines with Intl.NumberFormat v3; converted by ToNumber elsewhere). */
function partsOf(nf: NF, s: string): Part[] {
  return nf.formatToParts(s as unknown as number);
}

/** Valid tags of the `locale` option; invalid ones are dropped with a one-time warning (none left → runtime default). */
function validLocales(list: readonly string[] | null): string[] | undefined {
  const ok: string[] = [];
  for (const tag of list || []) {
    try {
      ok.push(...Intl.getCanonicalLocales(tag));
    } catch {
      warnOnce('locale:' + tag, `Invalid locale ${JSON.stringify(tag)} ignored.`);
    }
  }
  return ok.length ? ok : undefined;
}

// ── formatter ─────────────────────────────────────────────────────────

function newFormatter(o: NormalizedOptions): Formatter {
  const { pad, prefixText: prefix, suffixText: suffix, overflowSuffix: ovfText } = o;
  const padCore = Math.min(pad, INTL_MAX_INT);
  let f = o.decimals ?? 0;
  let scale: 1 | 100 = 1;
  let glyphs: readonly string[] | null = null;
  let zeroText = '0';
  let resolved: unknown = 0;
  /** Ids (idOf) of the static parts of the canonical positive layout: [pre side, post side]. */
  let canon: string[][] = [[], []];
  // Intl formatters (null on the plain path): main, quantization twin, label twin, twin with k integer digits.
  let nf: NF | null = null;
  let nfq: NF | null = null;
  let nfLabel: NF | null = null;
  let nfInt: (k: number) => NF = () => nf as NF;
  /** Plural rules of the shown number (null unless a unit or currency name is shown: "1 day" / "5 days"). */
  let pr: Intl.PluralRules | null = null;

  if (o.locale || o.format) {
    try {
      const locales = validLocales(o.locale);
      const base: NFOptions = {};
      const src = (o.format || {}) as unknown as NFOptions;
      for (const k of Object.keys(src)) {
        if (src[k] === undefined) continue;
        if (INTL_KEYS.includes(k)) base[k] = src[k];
        else warnOnce('format.' + k, `format.${k} is not supported and was ignored (use decimals for fraction digits).`);
      }
      const fI =
        o.decimals ??
        (base.style == 'currency'
          ? Math.min(20, makeNF(locales, { style: 'currency', currency: base.currency }).resolvedOptions().maximumFractionDigits ?? 0)
          : 0);
      let opts: NFOptions = { ...base, notation: 'standard', minimumFractionDigits: fI, maximumFractionDigits: fI, minimumIntegerDigits: padCore };
      let main: NF;
      try {
        main = makeNF(locales, opts);
      } catch (e) {
        // Engines without the string values of useGrouping throw a RangeError: retry with `true`.
        if (typeof opts.useGrouping != 'string' || (e as Error).name != 'RangeError') throw e;
        main = makeNF(locales, (opts = { ...opts, useGrouping: true }));
      }
      const twin = (x: NFOptions): NF => makeNF(locales, { ...opts, ...x });
      const ro = main.resolvedOptions() as unknown as NFOptions;
      const sI = ro.style == 'percent' ? 100 : 1;
      // Native digit glyphs (ASCII when they are ASCII, or when one is not a single code point).
      const nf0 = makeNF(locales, { numberingSystem: ro.numberingSystem, useGrouping: false });
      const native = Array.from({ length: 10 }, (_, d) => joinParts(nf0.formatToParts(d).filter((p) => p.type == 'integer')));
      const canonI: string[][] = [[], []];
      let side = 0;
      for (const p of partsOf(main, toDecimal('1', sI == 100 ? 2 : 0, false))) {
        if (p.type == 'integer' || p.type == 'fraction') side = 1;
        else if (!/^(group|decimal|minusSign|plusSign)$/.test(p.type)) canonI[side].push(idOf(p));
      }
      const q = twin({ numberingSystem: 'latn', useGrouping: false });
      const label = padCore > 1 ? twin({ minimumIntegerDigits: 1 }) : main;
      // Currency and unit names follow the plural form of the shown number, with its fraction digits ("1.00 euros").
      const prI =
        ro.style == 'currency' || ro.style == 'unit'
          ? new Intl.PluralRules(ro.locale as string, { minimumFractionDigits: fI, maximumFractionDigits: fI })
          : null;
      // Commit (nothing below throws).
      const byInt = new Map<number, NF>([[padCore, main]]);
      nfInt = (k) => byInt.get(k) || (byInt.set(k, twin({ minimumIntegerDigits: k })), byInt.get(k) as NF);
      nf = main;
      nfq = q;
      nfLabel = label;
      f = fI;
      scale = sI;
      glyphs = native.some((g, d) => g != String(d)) && native.every((g) => codePoints(g) == 1) ? Object.freeze(native) : null;
      zeroText = native[0] || '0';
      canon = canonI;
      pr = prI;
      resolved = Object.keys(ro).sort().map((k) => [k, ro[k]]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      warnOnce('intl:' + msg, `Intl formatting failed (${msg}); using the plain format.`);
    }
  }

  const shift = f + (scale == 100 ? 2 : 0);
  const pow = 10 ** f;
  const layouts = new Map<string, NumberLayout>();
  /** Clamped magnitude (`|A|`) of the shapes returned by `shapeOf`, for their plural form (only with `pr`). */
  const shownA = new WeakMap<LayoutShape, number>();

  /** Plain-path parts of `a` with `padTo` integer digits. */
  const plainParts = (a: number, padTo: number, sign: string): Part[] => {
    const [int, frac] = splitDigits(Math.abs(a), f);
    const parts: Part[] = a < 0 ? [{ type: 'minusSign', value: sign }] : [];
    parts.push({ type: 'integer', value: int.padStart(padTo, '0') });
    if (f) parts.push({ type: 'decimal', value: '.' }, { type: 'fraction', value: frac });
    return parts;
  };
  /** Exact numeric string of `A` for Intl ("0" for zero, never "-0"). */
  const numStr = (a: number): string => {
    const [int, frac] = splitDigits(Math.abs(a), f);
    return a ? toDecimal(int + frac, shift, a < 0) : '0';
  };

  const quantize = (value: number): number => {
    const v = Number.isFinite(value) ? value : 0;
    const x = Math.min(Math.abs(v), MAX_SAFE / (scale * pow));
    let A: number;
    if (nfq) {
      // Digits of the latn twin (same rounding as the display); native-digit parts are not parseable (§7.3).
      A = +joinParts(nfq.formatToParts(x).filter((p) => p.type == 'integer' || p.type == 'fraction'));
    } else {
      A = scaleDecimal(x, f);
    }
    A = Number.isFinite(A) ? Math.min(MAX_SAFE, A) : 0;
    return (v < 0 ? -A : A) || 0;
  };

  /** Canonical shape: integer digits in [max(pad, 1), 64]; zero is never negative; no overflow without a suffix. */
  const norm = (s: LayoutShape): LayoutShape => {
    const zero = !!s.zero;
    return {
      intDigits: Math.min(MAX_INT, Math.max(pad, Math.floor(+s.intDigits) || 1)),
      negative: !zero && !!s.negative,
      overflow: !!s.overflow && ovfText != '',
      zero
    };
  };

  /** Layout of `s`, formatted from the representative `10^(k−1)` or from the numeric string `num` (same digit count and sign). */
  const build = (s: LayoutShape, num: string): NumberLayout => {
    const core = nf ? Math.min(s.intDigits, INTL_MAX_INT) : s.intDigits;
    const extra = s.intDigits - core;
    const parts = nf
      ? s.zero
        ? partsOf(nfInt(Math.max(core, padCore)), '0')
        : partsOf(nf, num || toDecimal('1' + '0'.repeat(core - 1), shift - f, s.negative))
      : plainParts(s.zero ? 0 : s.negative ? -1 : 1, core, MINUS);
    let n = extra;
    for (const p of parts) if (p.type == 'integer') n += codePoints(p.value);

    const out: Token[] = prefix ? [{ kind: 'static', key: 'pre', role: 'prefix', text: prefix }] : [];
    const used = [new Set<number>(), new Set<number>()];
    const next = [canon[0].length, canon[1].length];
    let intIdx = 0;
    let fracIdx = 0;
    let side = 0;
    let afterDigits = -1;
    const pushInt = (): void => {
      const j = n - 1 - intIdx++;
      out.push({ kind: 'digit', key: 'i' + j, place: j + f });
      afterDigits = out.length;
      side = 1;
    };
    for (const p of parts) {
      const t = p.type;
      if (t == 'integer') {
        if (!intIdx) for (let z = 0; z < extra; z++) pushInt(); // pad > 21: zeros before Intl's first digit
        for (let c = codePoints(p.value); c > 0; c--) pushInt();
      } else if (t == 'fraction') {
        for (let c = codePoints(p.value); c > 0; c--) {
          out.push({ kind: 'digit', key: 'f' + ++fracIdx, place: f - fracIdx });
          afterDigits = out.length;
        }
      } else if (t == 'group') {
        out.push({ kind: 'static', key: 'g' + (n - intIdx), role: 'group', text: p.value });
      } else if (t == 'decimal') {
        out.push({ kind: 'static', key: 'dec', role: 'decimal', text: p.value });
      } else if (t == 'minusSign' || t == 'plusSign') {
        out.push({ kind: 'sign', key: 'sign', text: p.value });
      } else {
        // Literal/currency/unit/percent: `lit:{side}:n`, n = the index of its id (idOf) in the canonical (positive)
        // layout of that side, so e.g. "$" keeps its key when accounting parentheses or bidi marks come and go, and
        // "days" the key of "day"; others follow.
        const role = roleOf(t);
        const id = idOf(p);
        let j = canon[side].findIndex((c, i) => c == id && !used[side].has(i));
        if (j < 0) j = next[side]++;
        else used[side].add(j);
        out.push({ kind: 'static', key: `lit:${SIDES[side]}:${j}`, role, text: p.value });
      }
    }
    if (s.overflow) out.splice(afterDigits < 0 ? out.length : afterDigits, 0, { kind: 'static', key: 'ovf', role: 'overflow', text: ovfText });
    if (suffix) out.push({ kind: 'static', key: 'suf', role: 'suffix', text: suffix });
    out.forEach((t) => Object.freeze(t));
    return Object.freeze({
      key: out.map((t) => (t.kind == 'digit' ? t.key : t.key + '=' + t.text)).join('\u001f'),
      tokens: Object.freeze(out)
    });
  };

  const layout = (shape: LayoutShape): NumberLayout => {
    const s = norm(shape);
    const M = shownA.get(shape);
    let num = '';
    let cat = '';
    if (pr && !s.zero) {
      // Plural-dependent names ("1 day", "5 days", ru "21 день"): a shape from shapeOf takes the plural form of
      // the number it shows, built from that number when the representative's form differs (cached per form).
      cat = pr.select(10 ** (Math.min(s.intDigits, INTL_MAX_INT) - 1));
      const c = M ? pr.select(+toDecimal(String(M), f, false)) : cat;
      if (c != cat) num = numStr(s.negative ? -(M as number) : (M as number));
      cat = c;
    }
    const k = [s.intDigits, +s.negative, +s.overflow, +s.zero, cat].join();
    let l = layouts.get(k);
    if (!l) layouts.set(k, (l = build(s, num)));
    return l;
  };
  const keysOf = (l: NumberLayout): Set<string> => new Set(l.tokens.map((t) => t.key));

  const text = (A: number, overflow: boolean): string => {
    const a = safeA(A);
    const ovf = overflow && ovfText != '';
    const extra = nf ? Math.max(0, pad - INTL_MAX_INT) : 0;
    if (!ovf && !extra) return prefix + (nf ? nf.format(numStr(a) as unknown as number) : joinParts(plainParts(a, pad, '-'))) + suffix;
    let out = '';
    let afterDigits = -1;
    for (const p of nf ? partsOf(nf, numStr(a)) : plainParts(a, pad, '-')) {
      if (p.type == 'integer' && afterDigits < 0) out += zeroText.repeat(extra);
      out += p.value;
      if (p.type == 'integer' || p.type == 'fraction') afterDigits = out.length;
    }
    if (ovf) out = afterDigits < 0 ? out + ovfText : out.slice(0, afterDigits) + ovfText + out.slice(afterDigits);
    return prefix + out + suffix;
  };

  return {
    key: JSON.stringify([resolved, f, pad, prefix, suffix, ovfText]),
    plain: !nf,
    f,
    scale,
    glyphs,
    quantize,
    maxA: (max) => (max != null && Number.isFinite(max) && max >= 0 ? Math.min(MAX_SAFE, scaleDecimal(max, f, true)) : Infinity),
    shapeOf(A, Amax) {
      const a = safeA(A);
      const M = Math.floor(Math.min(Math.abs(a), Amax >= 0 ? Amax : Infinity));
      const shape = {
        intDigits: Math.min(MAX_INT, Math.max(pad, String(M).length - f, 1)),
        negative: a < 0 && M > 0,
        overflow: Math.abs(a) > Amax,
        zero: !M
      };
      if (pr && M) shownA.set(shape, M);
      return shape;
    },
    shapeOfDisplay(d: DisplayState) {
      let k = d.inn.length - 1;
      while (k >= 0 && !(d.inn[k] > 0)) k--;
      return { intDigits: Math.max(1, k - f + 1), negative: d.sigma > 0, overflow: d.ovf > 0, zero: false };
    },
    layout,
    motionLayout(fromShape, toShape) {
      const from = norm(fromShape);
      const to = norm(toShape);
      // Same sign/overflow/zero state as `from`, with `d` integer digits.
      const fromAt = (d: number): NumberLayout => layout({ ...from, intDigits: d });
      // The original shapes: a shape from shapeOf keeps the plural form of its number.
      const L0 = layout(fromShape);
      const L3 = layout(toShape);
      const S0 = keysOf(L0);
      const S1 = keysOf(fromAt(to.intDigits));
      const S2 = keysOf(layout({ ...to, overflow: from.overflow }));
      const S3 = keysOf(L3);
      const lo = Math.min(from.intDigits, to.intDigits);
      const hi = Math.max(from.intDigits, to.intDigits);
      // A non-digit token gets its tie from the first diff where it enters or leaves (§7.2): digits, then sign, then overflow.
      const tieOf = (t: Token): Tie => {
        const k = t.key;
        if (t.kind == 'digit') return null;
        if (S0.has(k) != S1.has(k)) {
          // Tied to the column whose arrival/departure makes it appear/disappear: a group enters with the first
          // column that needs it (g3 with i3 for "1,000"; with i4 for es min2 "10.000").
          const base = keysOf(fromAt(lo)).has(k);
          let d = lo + 1;
          while (d < hi && keysOf(fromAt(d)).has(k) == base) d++;
          return { kind: 'place', place: d - 1 + f };
        }
        if (S1.has(k) != S2.has(k)) return { kind: 'sign' };
        return S2.has(k) != S3.has(k) ? { kind: 'overflow' } : null;
      };
      const merged: MotionToken[] = L3.tokens.map((t) => ({ token: t, presence: S0.has(t.key) ? 'both' : 'enter', tie: tieOf(t) }));
      // Leaving tokens go right after their nearest preceding from-token already placed.
      L0.tokens.forEach((t, i) => {
        if (S3.has(t.key)) return;
        let at = 0;
        for (let p = i - 1; p >= 0 && !at; p--) at = merged.findIndex((m) => m.token.key == L0.tokens[p].key) + 1;
        merged.splice(at, 0, { token: t, presence: 'leave', tie: tieOf(t) });
      });
      merged.forEach((m) => Object.freeze(m));
      return Object.freeze({ tokens: Object.freeze(merged) });
    },
    text,
    // ASCII `-`, pad zeros, `.` and the fraction: the plain-path parts.
    numericText: (A) => joinParts(plainParts(safeA(A), pad, '-')),
    labelText(value) {
      const a = quantize(value);
      return prefix + (nfLabel ? nfLabel.format(numStr(a) as unknown as number) : joinParts(plainParts(a, 1, '-'))) + suffix;
    }
  };
}

// ── public (internal) API ─────────────────────────────────────────────

/** Formatters by input key (least recently used evicted past 32). */
const cache = new Map<string, Formatter>();

/**
 * Formatter for the normalized options (§7). The plain 1.x path is used when
 * neither `locale` nor `format` is set; otherwise `Intl.NumberFormat`, with a
 * fallback to the plain path (and a one-time warning) when it cannot be
 * constructed. Equal formatting options return the same instance (LRU of 32).
 *
 * @param o Normalized options (only `locale`, `format`, `decimals`, `pad`,
 *   `prefixText`, `suffixText` and `overflowSuffix` are read).
 * @returns The formatter.
 */
export function createFormatter(o: NormalizedOptions): Formatter {
  let key: string | null = null;
  try {
    const fmt = (o.format || {}) as unknown as NFOptions;
    // `undefined` fields are absent (newFormatter skips them); the others keep their type ("true" is not true,
    // null is not undefined) and their string form (what Intl reads).
    const fields = Object.keys(fmt).sort().filter((k) => fmt[k] !== undefined).map((k) => [k, typeof fmt[k], String(fmt[k])]);
    key = JSON.stringify([o.locale, !!o.format, fields, o.decimals, o.pad, o.prefixText, o.suffixText, o.overflowSuffix]);
  } catch {
    // not serializable: not cached
  }
  let f = key === null ? undefined : cache.get(key);
  if (f) cache.delete(key as string);
  else f = newFormatter(o);
  if (key !== null) {
    cache.set(key, f);
    if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  }
  return f;
}

const warnedLabelFns = new WeakSet<object>();

/**
 * Accessible label of `value` (§7.4). Default: `formatter.labelText(value)`
 * (unclamped, with affixes, without pad zeros). A string `label` replaces
 * every `{value}` with that text; a function receives
 * `{ text, value, overflow }` (when it throws or returns nothing, the default
 * text is used; a throw is warned once per function).
 *
 * @param o Normalized options (`label` is read).
 * @param f Formatter of `o`.
 * @param value Normalized target value.
 * @param overflow `true` when `|value| > max`.
 * @returns The label text.
 */
export function resolveLabel(o: NormalizedOptions, f: Formatter, value: number, overflow: boolean): string {
  const text = f.labelText(value);
  const label = o.label;
  if (typeof label == 'string') return label.split('{value}').join(text);
  if (typeof label == 'function') {
    try {
      const out: unknown = label({ text, value, overflow });
      if (out != null) return String(out);
    } catch (e) {
      if (!warnedLabelFns.has(label)) {
        warnedLabelFns.add(label);
        warn('label function threw; using the default label.', e);
      }
    }
  }
  return text;
}
