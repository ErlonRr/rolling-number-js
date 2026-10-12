// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createFormatter, resolveLabel } from '../src/format';
import { resolveOptions } from '../src/options';
import type { DisplayState, Formatter, MotionLayout, NumberLayout, Token } from '../src/internal/contracts';
import type { RollingNumberUpdate } from '../src/types';

/*
 * Intl output differs across ICU versions (R13): exact strings are asserted
 * only for stable locales (en-US, de-DE, fr-FR, es, en-IN, ja); the others are
 * checked structurally (token kinds, keys, places, glyphs).
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function fmt(o: RollingNumberUpdate = {}): Formatter {
  return createFormatter(resolveOptions(o));
}

/** Compact layout signature: digits by key, `sign(−)`, statics as `key(text)`. */
function sig(l: NumberLayout): string {
  return l.tokens.map((t) => (t.kind === 'digit' ? t.key : t.kind === 'sign' ? `sign(${t.text})` : `${t.key}(${t.text})`)).join(' ');
}

/** Compact motion signature: `key` + `+`/`-` for enter/leave + `[tie]`. */
function msig(m: MotionLayout): string {
  return m.tokens
    .map((x) => {
      const p = x.presence === 'both' ? '' : x.presence === 'enter' ? '+' : '-';
      const tie = x.tie === null ? '' : x.tie.kind === 'place' ? `[p${x.tie.place}]` : `[${x.tie.kind}]`;
      return x.token.key + p + tie;
    })
    .join(' ');
}

/** What a counter shows at rest for `v` (text clamped by `max`). */
function rest(f: Formatter, v: number, max: number | null = null) {
  const A = f.quantize(v);
  const Amax = f.maxA(max);
  const shape = f.shapeOf(A, Amax);
  const shown = (A < 0 ? -1 : 1) * Math.min(Math.abs(A), Amax) || 0;
  return { A, shape, layout: f.layout(shape), text: f.text(shown, shape.overflow), label: f.labelText(v) };
}

function shapeAt(f: Formatter, v: number, max: number | null = null) {
  return f.shapeOf(f.quantize(v), f.maxA(max));
}

/** The 1.2 `toDisplayInteger` (rounds half away from zero). */
const toDisplayInteger = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));

/** The 1.2/WP0 `getText()` of the plain path. */
function getText12(value: number, o: { pad?: number; max?: number | null; overflowSuffix?: string; prefixText?: string; suffixText?: string }): string {
  const a = toDisplayInteger(value);
  const max = o.max ?? null;
  const overflow = max !== null && Math.abs(a) > max;
  const m = overflow ? (max as number) : Math.abs(a);
  return (o.prefixText ?? '') + (a < 0 && m !== 0 ? '-' : '') + String(m).padStart(o.pad ?? 1, '0') + (overflow ? o.overflowSuffix ?? '' : '') + (o.suffixText ?? '');
}

function digitTokens(l: NumberLayout): Extract<Token, { kind: 'digit' }>[] {
  return l.tokens.filter((t): t is Extract<Token, { kind: 'digit' }> => t.kind === 'digit');
}

describe('plain path (no locale, no format)', () => {
  const VALUES = [0, -0, 0.4, -0.4, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 42, -42, 999.5, -1234567.89, 1e15 + 0.5, MAX_SAFE, -MAX_SAFE];

  it('label equals the 1.2 String(toDisplayInteger(value))', () => {
    const f = fmt();
    expect(f.plain).toBe(true);
    expect(f.f).toBe(0);
    expect(f.scale).toBe(1);
    expect(f.glyphs).toBeNull();
    for (const v of VALUES) expect(f.labelText(v)).toBe(String(toDisplayInteger(v)));
    // seeded pseudo-random values, halves included
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 16807) % 2147483647;
      const v = ((seed % 200001) - 100000) / (i % 2 ? 2 : 10);
      expect(f.labelText(v)).toBe(String(toDisplayInteger(v)));
    }
  });

  it('text equals the 1.2 display text (pad, max, overflowSuffix, affixes)', () => {
    const cases: Parameters<typeof getText12>[1][] = [
      {},
      { pad: 3 },
      { pad: 5, max: 99 },
      { max: 99, overflowSuffix: '+' },
      { max: 0, overflowSuffix: '+' },
      { pad: 2, prefixText: '≈ ', suffixText: ' pts' },
      { pad: 4, max: 999, overflowSuffix: 'k+', prefixText: '$', suffixText: '!' }
    ];
    for (const o of cases) {
      const f = fmt(o);
      for (const v of [...VALUES, 150, -150, 7, -7, 99.5, -99.4]) {
        expect(rest(f, v, o.max ?? null).text, `${JSON.stringify(o)} ${v}`).toBe(getText12(v, o));
      }
    }
  });

  it('layouts are the 1.2 DOM: U+2212 sign, digit columns, no static tokens', () => {
    const f = fmt({ pad: 3 });
    expect(sig(rest(f, -12).layout)).toBe('sign(−) i2 i1 i0');
    expect(sig(rest(f, 1234).layout)).toBe('i3 i2 i1 i0');
    expect(sig(rest(fmt(), 0).layout)).toBe('i0');
    expect(rest(f, -12).text).toBe('-012'); // ASCII in text
    expect(rest(f, -12).label).toBe('-12'); // 1.2 label: no pad zeros
  });

  it('decimals: Token.place example of §3.3 (f = 2: f2 → 0, f1 → 1, i0 → 2, i1 → 3)', () => {
    const f = fmt({ decimals: 2 });
    const r = rest(f, -12.5);
    expect(r.A).toBe(-1250);
    expect(sig(r.layout)).toBe('sign(−) i1 i0 dec(.) f1 f2');
    const places = Object.fromEntries(digitTokens(r.layout).map((t) => [t.key, t.place]));
    expect(places).toEqual({ f2: 0, f1: 1, i0: 2, i1: 3 });
    expect(r.text).toBe('-12.50');
    expect(r.label).toBe('-12.50');
    expect(f.numericText(r.A)).toBe('-12.50');
    expect(f.numericText(5)).toBe('0.05');
  });

  it('rounds half away from zero on the decimal value (1.005 → 1.01, as Intl does)', () => {
    const f = fmt({ decimals: 2 });
    expect(f.quantize(1.005)).toBe(101);
    expect(f.quantize(-1.005)).toBe(-101);
    expect(f.quantize(0.125)).toBe(13);
    expect(f.maxA(0.29)).toBe(29); // not floor(28.999999999999996)
    expect(f.maxA(null)).toBe(Infinity);
    expect(fmt().maxA(99.9)).toBe(99);
    const intl = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    for (const v of [1.005, 2.675, 10.235, 0.045, 123.455, 8.345]) {
      expect(f.text(f.quantize(v), false)).toBe(intl.format(v));
    }
  });

  it('−0 and −0.4 show "0" (text, label, numeric text)', () => {
    for (const f of [fmt(), fmt({ locale: 'en-US' })]) {
      for (const v of [-0, -0.4]) {
        const r = rest(f, v);
        expect(Object.is(r.A, 0)).toBe(true);
        expect(r.text).toBe('0');
        expect(r.label).toBe('0');
        expect(f.numericText(r.A)).toBe('0');
        expect(r.shape).toEqual({ intDigits: 1, negative: false, overflow: false, zero: true });
      }
    }
  });

  it('H7: A is always a safe integer, so no exponent ever shows', () => {
    const cases: RollingNumberUpdate[] = [
      {},
      { decimals: 2 },
      { decimals: 20 },
      { locale: 'en-US', decimals: 3 },
      { locale: 'en-US', format: { style: 'percent' }, decimals: 2 },
      { locale: 'en-US', format: { style: 'currency', currency: 'USD' } }
    ];
    for (const o of cases) {
      const f = fmt(o);
      for (const v of [1e15, -1e15, 1e21, MAX_SAFE, 1e300, -1e300, Infinity, NaN, 5e-324]) {
        const A = f.quantize(v);
        expect(Number.isSafeInteger(A), `${JSON.stringify(o)} ${v}`).toBe(true);
        expect(String(A)).not.toMatch(/e/i);
        expect(f.text(A, false)).not.toMatch(/e[+-]/i);
        expect(f.labelText(v)).not.toMatch(/e[+-]/i);
      }
    }
    // the magnitude is clamped to MAX_SAFE_INTEGER / (S · 10^f)
    expect(fmt({ decimals: 2 }).quantize(1e15)).toBe(9007199254740990);
    expect(fmt({ locale: 'en-US', decimals: 2 }).quantize(1e15)).toBe(9007199254740990);
  });
});

describe('Intl path: locale matrix', () => {
  const NEG = -1234567.5;

  it('en-US', () => {
    const f = fmt({ locale: 'en-US' });
    expect(f.plain).toBe(false);
    expect(f.glyphs).toBeNull();
    const r = rest(f, NEG);
    expect(r.A).toBe(-1234568);
    expect(sig(r.layout)).toBe('sign(-) i6 g6(,) i5 i4 i3 g3(,) i2 i1 i0');
    expect(r.text).toBe('-1,234,568');
    expect(r.label).toBe('-1,234,568');
    expect(f.numericText(r.A)).toBe('-1234568');
  });

  it('de-DE (decimals 2)', () => {
    const f = fmt({ locale: 'de-DE', decimals: 2 });
    const r = rest(f, NEG);
    expect(sig(r.layout)).toBe('sign(-) i6 g6(.) i5 i4 i3 g3(.) i2 i1 i0 dec(,) f1 f2');
    expect(r.text).toBe('-1.234.567,50');
  });

  it('de-CH: apostrophe-like group, "." decimal', () => {
    const f = fmt({ locale: 'de-CH', decimals: 2 });
    const r = rest(f, NEG);
    const groups = r.layout.tokens.filter((t) => t.kind === 'static' && t.role === 'group');
    expect(groups.map((t) => t.key)).toEqual(['g6', 'g3']);
    for (const g of groups) expect(g.kind === 'static' && [...g.text].length === 1 && !/[\d,.]/.test(g.text)).toBe(true);
    expect(r.layout.tokens.find((t) => t.key === 'dec')).toMatchObject({ text: '.' });
  });

  it('fr-FR: narrow no-break space (U+202F) groups', () => {
    const r = rest(fmt({ locale: 'fr-FR' }), NEG);
    expect(sig(r.layout)).toBe('sign(-) i6 g6( ) i5 i4 i3 g3( ) i2 i1 i0');
    expect(r.text).toBe('-1 234 568');
  });

  it('es: minimum grouping digits 2 (no separator below 10 000)', () => {
    const f = fmt({ locale: 'es' });
    expect(sig(rest(f, 1234).layout)).toBe('i3 i2 i1 i0');
    expect(rest(f, 1234).text).toBe('1234');
    expect(sig(rest(f, 12345).layout)).toBe('i4 i3 g3(.) i2 i1 i0');
    expect(rest(f, 12345).text).toBe('12.345');
  });

  it('en-IN: lakh grouping', () => {
    const r = rest(fmt({ locale: 'en-IN' }), 1234567);
    expect(sig(r.layout)).toBe('i6 i5 g5(,) i4 i3 g3(,) i2 i1 i0');
    expect(r.text).toBe('12,34,567');
  });

  it('hi-IN-u-nu-deva: native glyphs, lakh grouping', () => {
    const f = fmt({ locale: 'hi-IN-u-nu-deva' });
    expect(f.glyphs).toEqual([...'०१२३४५६७८९']);
    const r = rest(f, 1234567);
    expect(digitTokens(r.layout).map((t) => t.key)).toEqual(['i6', 'i5', 'i4', 'i3', 'i2', 'i1', 'i0']);
    expect(r.layout.tokens.filter((t) => t.kind === 'static' && t.role === 'group').map((t) => t.key)).toEqual(['g5', 'g3']);
    expect(r.text).toContain('१२');
  });

  it.each([
    ['ar-EG', '٠١٢٣٤٥٦٧٨٩'],
    ['fa', '۰۱۲۳۴۵۶۷۸۹']
  ])('%s: native glyphs, bidi marks as static literals, sign token', (locale, glyphs) => {
    const f = fmt({ locale });
    expect(f.glyphs).toEqual([...glyphs]);
    const r = rest(f, NEG);
    expect(digitTokens(r.layout).map((t) => t.key)).toEqual(['i6', 'i5', 'i4', 'i3', 'i2', 'i1', 'i0']);
    expect(r.layout.tokens.filter((t) => t.kind === 'static' && t.role === 'group').map((t) => t.key)).toEqual(['g6', 'g3']);
    expect(r.layout.tokens.filter((t) => t.kind === 'sign')).toHaveLength(1);
    for (const t of r.layout.tokens) {
      if (t.kind === 'static' && t.role === 'literal') expect(t.key).toMatch(/^lit:(pre|post):\d+$/);
    }
    expect(r.text).toContain(glyphs[1]);
    expect(sig(rest(f, 1234).layout).replace(/\(.\)/g, '(_)')).toBe('i3 g3(_) i2 i1 i0');
  });

  it('he: ASCII digits, bidi literal before the sign', () => {
    const f = fmt({ locale: 'he' });
    expect(f.glyphs).toBeNull();
    const l = rest(f, NEG).layout;
    expect(digitTokens(l)).toHaveLength(7);
    const signAt = l.tokens.findIndex((t) => t.kind === 'sign');
    expect(signAt).toBeGreaterThanOrEqual(0);
    expect(l.tokens.slice(0, signAt).every((t) => t.kind === 'static' && t.key.startsWith('lit:pre:'))).toBe(true);
  });

  it('ja', () => {
    const r = rest(fmt({ locale: 'ja' }), NEG);
    expect(sig(r.layout)).toBe('sign(-) i6 g6(,) i5 i4 i3 g3(,) i2 i1 i0');
    expect(r.text).toBe('-1,234,568');
  });

  it('quantize with native digits equals the en result (latn twin formatter)', () => {
    const en = fmt({ locale: 'en', decimals: 2 });
    const natives = [
      fmt({ locale: 'ar-EG', decimals: 2 }),
      fmt({ locale: 'fa', decimals: 2 }),
      fmt({ locale: 'hi-IN-u-nu-deva', decimals: 2 }),
      fmt({ locale: 'en', format: { numberingSystem: 'deva' }, decimals: 2 })
    ];
    expect(natives[3].glyphs).toEqual([...'०१२३४५६७८९']);
    for (const v of [0, -0, -0.004, 0.005, 1.005, -1234567.891, 42.125, 1e13, -1e300, MAX_SAFE]) {
      const want = en.quantize(v);
      expect(Number.isSafeInteger(want)).toBe(true);
      for (const f of natives) expect(f.quantize(v), `${v}`).toBe(want);
    }
  });
});

describe('Intl path: invariants over the locale × style matrix', () => {
  const LOCALES = ['en-US', 'de-DE', 'de-CH', 'fr-FR', 'es', 'en-IN', 'hi-IN-u-nu-deva', 'ar-EG', 'fa', 'he', 'ja'];
  const STYLES: RollingNumberUpdate[] = [
    {},
    { decimals: 2 },
    { format: { style: 'currency', currency: 'EUR' } },
    { format: { style: 'currency', currency: 'USD', currencySign: 'accounting' } },
    { format: { style: 'percent' }, decimals: 1 },
    { format: { style: 'unit', unit: 'kilometer-per-hour' } },
    { format: { signDisplay: 'always' } },
    { format: { signDisplay: 'exceptZero' }, pad: 2 }
  ];
  const VALUES = [0, 5, -5, 99.5, -0.004, 1234.5, -98765.4321, 1e7];

  /** ASCII digits of a text, native glyphs mapped back. */
  const digitsOf = (s: string, glyphs: readonly string[] | null): string =>
    [...s].map((c) => (/[0-9]/.test(c) ? c : glyphs && glyphs.includes(c) ? String(glyphs.indexOf(c)) : '')).join('');

  it.each(LOCALES)('%s', (locale) => {
    for (const style of STYLES) {
      const f = fmt({ locale, overflowSuffix: '+', ...style });
      expect(f.plain, `${locale} ${JSON.stringify(style)}`).toBe(false);
      const ref = fmt({ locale: 'en', ...style, format: { ...style.format, numberingSystem: 'latn' } });
      const shapes = VALUES.map((v) => shapeAt(f, v, 9999));
      for (const v of VALUES) {
        const ctx = `${locale} ${JSON.stringify(style)} ${v}`;
        const r = rest(f, v, 9999);
        expect(Number.isSafeInteger(r.A), ctx).toBe(true);
        expect(r.A, ctx).toBe(ref.quantize(v));
        const keys = r.layout.tokens.map((t) => t.key);
        expect(new Set(keys).size, ctx).toBe(keys.length);
        expect(digitTokens(r.layout), ctx).toHaveLength(r.shape.intDigits + f.f);
        // columns, text and A agree digit for digit
        const shown = (r.A < 0 ? -1 : 1) * Math.min(Math.abs(r.A), f.maxA(9999));
        expect(digitsOf(r.text, f.glyphs), ctx).toBe(f.numericText(shown).replace(/[-.]/g, ''));
        expect(r.text.includes('+') || !r.shape.overflow, ctx).toBe(true);
      }
      for (const from of shapes) {
        for (const to of shapes) {
          const m = f.motionLayout(from, to);
          const ctx = `${locale} ${JSON.stringify(style)} ${JSON.stringify(from)} → ${JSON.stringify(to)}`;
          const keys = m.tokens.map((t) => t.token.key);
          expect(new Set(keys).size, ctx).toBe(keys.length);
          const fromKeys = new Set(f.layout(from).tokens.map((t) => t.key));
          const toKeys = f.layout(to).tokens.map((t) => t.key);
          expect(m.tokens.filter((t) => t.presence !== 'leave').map((t) => t.token.key), ctx).toEqual(toKeys);
          for (const t of m.tokens) {
            expect(t.presence, ctx).toBe(fromKeys.has(t.token.key) ? (toKeys.includes(t.token.key) ? 'both' : 'leave') : 'enter');
            if (t.token.kind === 'digit' || t.presence === 'both') expect(t.tie, ctx).toBeNull();
            else expect(t.tie, `${ctx} ${t.token.key}`).not.toBeNull();
          }
        }
      }
    }
  });

  it('text formats A exactly (no float round trip): text, label and columns agree on 16-digit values', () => {
    const f = fmt({ locale: 'en-US', decimals: 2 });
    expect(f.text(9007199254740991, false)).toBe('90,071,992,547,409.91');
    expect(f.text(-9007199254740991, false)).toBe('-90,071,992,547,409.91');
    const p = fmt({ locale: 'en-US', format: { style: 'percent' }, decimals: 2 });
    expect(p.text(9007199254740991, false)).toBe('90,071,992,547,409.91%');
  });
});

describe('Intl path: styles and signs', () => {
  it('currency: decimals default to the currency digits', () => {
    expect(fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD' } }).f).toBe(2);
    expect(fmt({ locale: 'ja', format: { style: 'currency', currency: 'JPY' } }).f).toBe(0);
    expect(fmt({ locale: 'en-US', format: { style: 'currency', currency: 'KWD' } }).f).toBe(3);
    expect(fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD' }, decimals: 0 }).f).toBe(0);
    const f = fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD' } });
    const r = rest(f, 1234.5);
    expect(r.A).toBe(123450);
    expect(sig(r.layout)).toBe('lit:pre:0($) i3 g3(,) i2 i1 i0 dec(.) f1 f2');
    expect(r.layout.tokens[0]).toMatchObject({ kind: 'static', role: 'currency' });
    expect(r.text).toBe('$1,234.50');
    expect(f.numericText(r.A)).toBe('1234.50');
  });

  it('currency after the number (de-DE EUR): literal + currency on the post side', () => {
    const r = rest(fmt({ locale: 'de-DE', format: { style: 'currency', currency: 'EUR' } }), -1234.5);
    expect(r.text).toBe('-1.234,50 €');
    expect(sig(r.layout)).toBe('sign(-) i3 g3(.) i2 i1 i0 dec(,) f1 f2 lit:post:0( ) lit:post:1(€)');
    expect(r.layout.tokens.slice(-2).map((t) => t.kind === 'static' && t.role)).toEqual(['literal', 'currency']);
  });

  it('accounting: parentheses instead of a sign; the currency keeps its key', () => {
    const f = fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD', currencySign: 'accounting' } });
    const neg = rest(f, -1234.5);
    expect(neg.text).toBe('($1,234.50)');
    expect(sig(neg.layout)).toBe('lit:pre:1(() lit:pre:0($) i3 g3(,) i2 i1 i0 dec(.) f1 f2 lit:post:0())');
    expect(neg.layout.tokens.some((t) => t.kind === 'sign')).toBe(false);
    expect(sig(rest(f, 1234.5).layout)).toBe('lit:pre:0($) i3 g3(,) i2 i1 i0 dec(.) f1 f2');
    expect(msig(f.motionLayout(shapeAt(f, -5), shapeAt(f, 5)))).toBe('lit:pre:1-[sign] lit:pre:0 i0 dec f1 f2 lit:post:0-[sign]');
  });

  it('percent: scale 100, max is after percent scaling', () => {
    const f = fmt({ locale: 'en-US', format: { style: 'percent' } });
    expect(f.scale).toBe(100);
    expect(f.quantize(0.256)).toBe(26);
    expect(rest(f, 0.256).text).toBe('26%');
    expect(sig(rest(f, 0.256).layout)).toBe('i1 i0 lit:post:0(%)');
    expect(rest(f, -0.5).text).toBe('-50%');
    expect(f.maxA(50)).toBe(50);
    const g = fmt({ locale: 'en-US', format: { style: 'percent' }, decimals: 1, overflowSuffix: '+' });
    expect(g.quantize(0.2567)).toBe(257);
    expect(rest(g, 0.2567).text).toBe('25.7%');
    expect(g.maxA(50)).toBe(500);
    expect(rest(g, 0.75, 50).text).toBe('50.0+%');
    expect(rest(g, 0.75, 50).label).toBe('75.0%');
  });

  it('unit', () => {
    const r = rest(fmt({ locale: 'en-US', format: { style: 'unit', unit: 'kilometer-per-hour' } }), 1234);
    expect(r.text).toBe('1,234 km/h');
    expect(sig(r.layout)).toBe('i3 g3(,) i2 i1 i0 lit:post:0( ) lit:post:1(km/h)');
    expect(r.layout.tokens.at(-1)).toMatchObject({ role: 'unit' });
  });

  it("signDisplay 'always': + on zero and positives, the sign token swaps text", () => {
    const f = fmt({ locale: 'en-US', format: { signDisplay: 'always' } });
    expect(sig(rest(f, 0).layout)).toBe('sign(+) i0');
    expect(rest(f, 0).text).toBe('+0');
    expect(sig(rest(f, 5).layout)).toBe('sign(+) i0');
    expect(sig(rest(f, -5).layout)).toBe('sign(-) i0');
    expect(rest(f, -0.4).text).toBe('+0'); // formatted from A = 0, never "-0"
    const m = f.motionLayout(shapeAt(f, -5), shapeAt(f, 5));
    expect(msig(m)).toBe('sign i0');
    expect(m.tokens[0].token).toMatchObject({ kind: 'sign', text: '+' });
  });

  it("signDisplay 'exceptZero': the zero layout has no sign token", () => {
    const f = fmt({ locale: 'en-US', format: { signDisplay: 'exceptZero' } });
    const zero = rest(f, 0);
    expect(zero.shape.zero).toBe(true);
    expect(sig(zero.layout)).toBe('i0');
    expect(zero.text).toBe('0');
    expect(sig(rest(f, 5).layout)).toBe('sign(+) i0');
    expect(sig(rest(f, -5).layout)).toBe('sign(-) i0');
    expect(msig(f.motionLayout(shapeAt(f, 0), shapeAt(f, 1234)))).toBe('sign+[sign] i3+ g3+[p3] i2+ i1+ i0');
    expect(msig(f.motionLayout(shapeAt(f, 1234), shapeAt(f, 0)))).toBe('sign-[sign] i3- g3-[p3] i2- i1- i0');
  });

  it('pad > 21: extra zeros are prepended as digit tokens without separators', () => {
    const f = fmt({ locale: 'en-US', pad: 25 });
    const r = rest(f, 5);
    expect(r.shape.intDigits).toBe(25);
    const keys = r.layout.tokens.map((t) => t.key);
    expect(keys.slice(0, 7)).toEqual(['i24', 'i23', 'i22', 'i21', 'i20', 'i19', 'i18']);
    expect(keys[7]).toBe('g18');
    expect(digitTokens(r.layout)).toHaveLength(25);
    expect(r.text).toBe('0000' + '000,000,000,000,000,000,005');
    expect(r.label).toBe('5');
    expect(f.numericText(r.A)).toBe('0'.repeat(24) + '5');
    const neg = rest(fmt({ locale: 'en-US', pad: 23, prefixText: '#' }), -5);
    expect(neg.text).toBe('#-00' + '000,000,000,000,000,000,005');
    const plain = rest(fmt({ pad: 25 }), 5);
    expect(plain.text).toBe('0'.repeat(24) + '5');
    expect(sig(plain.layout)).toBe(Array.from({ length: 25 }, (_, i) => `i${24 - i}`).join(' '));
  });

  it('overflow: the ovf token sits right after the last digit; the label stays unclamped', () => {
    const plain = fmt({ overflowSuffix: '+' });
    const r = rest(plain, 150, 99);
    expect(r.shape).toEqual({ intDigits: 2, negative: false, overflow: true, zero: false });
    expect(sig(r.layout)).toBe('i1 i0 ovf(+)');
    expect(r.text).toBe('99+');
    expect(r.label).toBe('150');
    expect(rest(plain, -150, 99).text).toBe('-99+');
    expect(sig(rest(plain, -150, 99).layout)).toBe('sign(−) i1 i0 ovf(+)');
    // max 0: the clamped display is 0 (no sign), still overflowing
    expect(rest(plain, -5, 0)).toMatchObject({ text: '0+', shape: { negative: false, zero: true, overflow: true } });
    // no suffix: exactly 1.2 (no token)
    const bare = fmt();
    expect(sig(rest(bare, 150, 99).layout)).toBe('i1 i0');
    expect(rest(bare, 150, 99).text).toBe('99');
    // Intl: before the post-side literals
    const eur = fmt({ locale: 'de-DE', format: { style: 'currency', currency: 'EUR' }, overflowSuffix: '+', prefixText: '≈', suffixText: '!' });
    const e = rest(eur, 150, 99);
    expect(e.text).toBe('≈99,00+ €!');
    expect(sig(e.layout)).toBe('pre(≈) i1 i0 dec(,) f1 f2 ovf(+) lit:post:0( ) lit:post:1(€) suf(!)');
    expect(e.label).toBe('≈150,00 €!');
  });
});

describe('plural-dependent literals (unit and currency names)', () => {
  /** What the columns show at rest: the layout's tokens with the digits of the clamped `A`. */
  function columnsText(f: Formatter, v: number, max: number | null = null): string {
    const r = rest(f, v, max);
    const digits = String(Math.min(Math.abs(r.A), f.maxA(max)));
    return r.layout.tokens
      .map((t) => {
        if (t.kind !== 'digit') return t.text;
        const d = +(digits[digits.length - 1 - t.place] ?? '0');
        return f.glyphs ? f.glyphs[d] : String(d);
      })
      .join('');
  }

  /** Columns, text and label agree for every value (no `max`, no affixes; the label has no pad zeros). */
  function expectAgree(o: RollingNumberUpdate, values: number[]): void {
    const f = fmt(o);
    const unpadded = fmt({ ...o, pad: 1 });
    expect(f.plain).toBe(false);
    for (const v of values) {
      const r = rest(f, v);
      const ctx = `${JSON.stringify(o)} ${v}`;
      expect(columnsText(f, v), ctx).toBe(r.text);
      expect(r.label, ctx).toBe(rest(unpadded, v).text);
    }
  }

  it('en long units: "1 day", "5 days" (the layout follows the plural category of the value)', () => {
    const f = fmt({ locale: 'en', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } });
    expect(columnsText(f, 5)).toBe('5 days');
    expect(rest(f, 5).text).toBe('5 days');
    expect(columnsText(f, 1)).toBe('1 day');
    expect(columnsText(f, 0)).toBe('0 days');
    expect(columnsText(f, 21)).toBe('21 days');
    expect(columnsText(f, 150, 99)).toBe('99 days');
    expectAgree({ locale: 'en', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [0, 1, 2, 5, 10, 11, 21, 100, 101, -1, -5]);
    expectAgree({ locale: 'en', pad: 3, format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [1, 5, 1234]);
    // with fraction digits "1.0" is plural ("1.0 days"), as Intl formats it
    expectAgree({ locale: 'en', decimals: 1, format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [1, 1.5, 2]);
  });

  it('ru: one / few / many forms ("1 день", "2 дня", "5 дней", "21 день")', () => {
    const f = fmt({ locale: 'ru', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } });
    const word = (v: number): string => columnsText(f, v).replace(/^[\d\s]+/, '');
    expect(new Set([1, 21, 101].map(word)).size).toBe(1);
    expect(new Set([2, 3, 22].map(word)).size).toBe(1);
    expect(new Set([5, 11, 25, 100].map(word)).size).toBe(1);
    expect(new Set([word(1), word(2), word(5)]).size).toBe(3);
    expectAgree({ locale: 'ru', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [0, 1, 2, 5, 11, 12, 21, 22, 25, 101, 111]);
    expectAgree({ locale: 'ru', format: { style: 'currency', currency: 'RUB', currencyDisplay: 'name' } }, [1, 2, 5, 21, 1.5]);
  });

  it('currency names: "1 euro", "3 euros" (decimals 0); "1.00 euros"', () => {
    const f = fmt({ locale: 'en', decimals: 0, format: { style: 'currency', currency: 'EUR', currencyDisplay: 'name' } });
    expect(columnsText(f, 3)).toBe('3 euros');
    expect(columnsText(f, 1)).toBe('1 euro');
    expectAgree({ locale: 'en', decimals: 0, format: { style: 'currency', currency: 'EUR', currencyDisplay: 'name' } }, [0, 1, 3, 10, 1234]);
    expectAgree({ locale: 'en', format: { style: 'currency', currency: 'EUR', currencyDisplay: 'name' } }, [0, 1, 3, 1234.5]);
    expectAgree({ locale: 'fr', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [0, 1, 1.4, 2, 5]);
  });

  it('other plural systems agree too (pl, ar, ja)', () => {
    expectAgree({ locale: 'pl', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [1, 2, 5, 12, 22, 25]);
    expectAgree({ locale: 'ar', format: { style: 'unit', unit: 'day', unitDisplay: 'long', numberingSystem: 'latn' } }, [3, 5, 11, 100, 101]);
    expectAgree({ locale: 'ja', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } }, [1, 5]);
  });

  it('the unit/currency token keeps its key when only its text changes ("day" → "days")', () => {
    const f = fmt({ locale: 'en', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } });
    const one = rest(f, 1).layout;
    const five = rest(f, 5).layout;
    expect(sig(one)).toBe('i0 lit:post:0( ) lit:post:1(day)');
    expect(sig(five)).toBe('i0 lit:post:0( ) lit:post:1(days)');
    expect(sig(rest(f, 10).layout)).toBe('i1 i0 lit:post:0( ) lit:post:1(days)');
    const m = f.motionLayout(shapeAt(f, 1), shapeAt(f, 5));
    expect(msig(m)).toBe('i0 lit:post:0 lit:post:1');
    expect(m.tokens.at(-1)?.token).toMatchObject({ key: 'lit:post:1', text: 'days' });
    expect(msig(f.motionLayout(shapeAt(f, 5), shapeAt(f, 1)))).toBe('i0 lit:post:0 lit:post:1');
    expect(msig(f.motionLayout(shapeAt(f, 1), shapeAt(f, 10)))).toBe('i1+ i0 lit:post:0 lit:post:1');
    const ru = fmt({ locale: 'ru', format: { style: 'unit', unit: 'day', unitDisplay: 'long' } });
    const keys = (v: number): string[] => rest(ru, v).layout.tokens.map((t) => t.key);
    expect(keys(5)).toEqual(keys(1));
    expect(keys(2)).toEqual(keys(1));
    const eur = fmt({ locale: 'en', decimals: 0, format: { style: 'currency', currency: 'EUR', currencyDisplay: 'name' } });
    expect(rest(eur, 3).layout.tokens.map((t) => t.key)).toEqual(rest(eur, 1).layout.tokens.map((t) => t.key));
    // layouts are still cached (per shape and plural form)
    expect(rest(f, 7).layout).toBe(five);
    expect(rest(f, 1).layout).toBe(one);
  });
});

describe('motion layouts and ties', () => {
  it('a group separator enters with the column that needs it (en-US vs es min2)', () => {
    const en = fmt({ locale: 'en-US' });
    expect(msig(en.motionLayout(shapeAt(en, 999), shapeAt(en, 1000)))).toBe('i3+ g3+[p3] i2 i1 i0');
    expect(msig(en.motionLayout(shapeAt(en, 999), shapeAt(en, 10000)))).toBe('i4+ i3+ g3+[p3] i2 i1 i0');
    expect(msig(en.motionLayout(shapeAt(en, 10000), shapeAt(en, 999)))).toBe('i4- i3- g3-[p3] i2 i1 i0');
    expect(msig(en.motionLayout(shapeAt(en, 0), shapeAt(en, 1e6)))).toBe('i6+ g6+[p6] i5+ i4+ i3+ g3+[p3] i2+ i1+ i0');
    const es = fmt({ locale: 'es' });
    expect(msig(es.motionLayout(shapeAt(es, 999), shapeAt(es, 1000)))).toBe('i3+ i2 i1 i0');
    expect(msig(es.motionLayout(shapeAt(es, 9999), shapeAt(es, 10000)))).toBe('i4+ i3 g3+[p4] i2 i1 i0');
    expect(msig(es.motionLayout(shapeAt(es, 999), shapeAt(es, 10000)))).toBe('i4+ i3+ g3+[p4] i2 i1 i0');
    // places are k: with f = 2 the units column is place 2
    const usd = fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD' } });
    expect(msig(usd.motionLayout(shapeAt(usd, 999), shapeAt(usd, 1000)))).toBe('lit:pre:0 i3+ g3+[p5] i2 i1 i0 dec f1 f2');
  });

  it('sign and overflow ties; leaving tokens keep their relative position', () => {
    const f = fmt({ overflowSuffix: '+' });
    expect(msig(f.motionLayout(shapeAt(f, -5), shapeAt(f, 5)))).toBe('sign-[sign] i0');
    expect(msig(f.motionLayout(shapeAt(f, 5), shapeAt(f, -50)))).toBe('sign+[sign] i1+ i0');
    expect(msig(f.motionLayout(shapeAt(f, -5), shapeAt(f, 50)))).toBe('sign-[sign] i1+ i0');
    expect(msig(f.motionLayout(shapeAt(f, 100), shapeAt(f, 5)))).toBe('i2- i1- i0');
    expect(msig(f.motionLayout(shapeAt(f, 95, 99), shapeAt(f, 150, 99)))).toBe('i1 i0 ovf+[overflow]');
    expect(msig(f.motionLayout(shapeAt(f, 150, 99), shapeAt(f, 5, 99)))).toBe('i1- i0 ovf-[overflow]');
    // all three at once, plain path with decimals
    const g = fmt({ decimals: 2, overflowSuffix: '+', prefixText: '$' });
    expect(msig(g.motionLayout(shapeAt(g, -150, 99), shapeAt(g, 5, 99)))).toBe('pre sign-[sign] i1- i0 dec f1 f2 ovf-[overflow]');
    expect(msig(g.motionLayout(shapeAt(g, 5, 99), shapeAt(g, -150, 99)))).toBe('pre sign+[sign] i1+ i0 dec f1 f2 ovf+[overflow]');
  });

  it('identical shapes: every token is "both" with no tie; digits never carry a tie', () => {
    const f = fmt({ locale: 'de-DE', format: { style: 'currency', currency: 'EUR' } });
    const m = f.motionLayout(shapeAt(f, -1234), shapeAt(f, -5678));
    expect(m.tokens.every((t) => t.presence === 'both' && t.tie === null)).toBe(true);
    const n = f.motionLayout(shapeAt(f, 5), shapeAt(f, -12345));
    for (const t of n.tokens) if (t.token.kind === 'digit') expect(t.tie).toBeNull();
    // keys are unique in a motion layout
    const keys = n.tokens.map((t) => t.token.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('bidi literals around the sign are tied to the sign (ar-EG, fa, he)', () => {
    for (const locale of ['ar-EG', 'fa', 'he']) {
      const f = fmt({ locale, format: { style: 'currency', currency: 'EUR' } });
      const m = f.motionLayout(shapeAt(f, 5), shapeAt(f, -5));
      for (const t of m.tokens) {
        if (t.presence !== 'both' && t.token.kind !== 'digit') expect(t.tie, `${locale} ${t.token.key}`).toEqual({ kind: 'sign' });
      }
      expect(m.tokens.some((t) => t.token.kind === 'sign' && t.presence === 'enter')).toBe(true);
    }
  });
});

describe('shapes', () => {
  it('shapeOf: pad, clamped digits, sign of the clamped value, zero', () => {
    const f = fmt({ pad: 3 });
    expect(f.shapeOf(5, Infinity)).toEqual({ intDigits: 3, negative: false, overflow: false, zero: false });
    expect(f.shapeOf(-12345, Infinity)).toEqual({ intDigits: 5, negative: true, overflow: false, zero: false });
    expect(f.shapeOf(-12345, 99)).toEqual({ intDigits: 3, negative: true, overflow: true, zero: false });
    expect(f.shapeOf(-5, 0)).toEqual({ intDigits: 3, negative: false, overflow: true, zero: true });
    expect(fmt({ decimals: 2 }).shapeOf(5, Infinity)).toEqual({ intDigits: 1, negative: false, overflow: false, zero: false });
    expect(fmt({ decimals: 2 }).shapeOf(123456, Infinity).intDigits).toBe(4);
  });

  it('shapeOfDisplay: a half-collapsed leaving column and a fading sign stay in the layout', () => {
    const f = fmt({ decimals: 1, overflowSuffix: '+' });
    // on screen: "−1x.y" while going -105.0 → 5.0: place 3 (hundreds) half collapsed, sign fading
    const d: DisplayState = { pos: [0, 5, 0, 1], inn: [1, 1, 1, 0.5], sigma: 0.3, ovf: 0, reel: [false, false, false, false] };
    const from = f.shapeOfDisplay(d);
    expect(from).toEqual({ intDigits: 3, negative: true, overflow: false, zero: false });
    expect(sig(f.layout(from))).toBe('sign(−) i2 i1 i0 dec(.) f1');
    const m = f.motionLayout(from, shapeAt(f, 5));
    expect(msig(m)).toBe('sign-[sign] i2- i1- i0 dec f1');
    // fully collapsed places do not count; a fading overflow does
    expect(f.shapeOfDisplay({ ...d, inn: [1, 1, 1, 0], sigma: 0, ovf: 0.1 })).toEqual({
      intDigits: 2, negative: false, overflow: true, zero: false
    });
    expect(f.shapeOfDisplay({ pos: [], inn: [], sigma: 0, ovf: 0, reel: [] }).intDigits).toBe(1);
  });

  it('layouts are cached by shape and frozen', () => {
    const f = fmt({ locale: 'en-US' });
    const a = f.layout({ intDigits: 4, negative: true, overflow: false, zero: false });
    expect(f.layout({ intDigits: 4, negative: true, overflow: false, zero: false })).toBe(a);
    expect(Object.isFrozen(a.tokens)).toBe(true);
    expect(Object.isFrozen(a.tokens[0])).toBe(true);
    // overflow without a suffix normalizes to the same layout
    expect(f.layout({ intDigits: 4, negative: true, overflow: true, zero: false })).toBe(a);
    expect(a.key).not.toBe(f.layout({ intDigits: 4, negative: false, overflow: false, zero: false }).key);
  });
});

describe('createFormatter cache and key', () => {
  it('returns the same instance for equal formatting options', () => {
    const a = fmt({ locale: 'de-DE', format: { style: 'currency', currency: 'EUR' }, value: 1 });
    const b = createFormatter(resolveOptions({ locale: ['de-DE'], format: { currency: 'EUR', style: 'currency' }, value: 2, max: 5 }));
    expect(b).toBe(a);
    expect(fmt({ locale: 'de-DE', format: { style: 'currency', currency: 'EUR' }, decimals: 0 })).not.toBe(a);
  });

  it('key changes iff the output changes', () => {
    const a = fmt({ locale: 'en-US', format: { style: 'currency', currency: 'EUR' } });
    const b = fmt({ locale: 'en-US', format: { style: 'currency', currency: 'EUR' }, decimals: 2 });
    expect(b.key).toBe(a.key); // auto decimals resolve to the same 2
    expect(fmt({ locale: 'en-US', format: { style: 'currency', currency: 'EUR' }, prefixText: '~' }).key).not.toBe(a.key);
    expect(fmt({ locale: 'en-US', format: { style: 'currency', currency: 'USD' } }).key).not.toBe(a.key);
    expect(fmt({ pad: 2 }).key).not.toBe(fmt().key);
  });

  it('an undefined format field is absent; null is a value (different cache keys)', () => {
    const nul = fmt({ locale: 'en-US', format: { useGrouping: null as unknown as boolean } });
    expect(rest(nul, 1234567).text).toBe('1234567'); // Intl: null → false
    const undef = fmt({ locale: 'en-US', format: { useGrouping: undefined } });
    expect(undef).not.toBe(nul);
    expect(rest(undef, 1234567).text).toBe('1,234,567');
    expect(undef).toBe(fmt({ locale: 'en-US', format: {} }));
    // values keep their type in the key: "true" (a string Intl rejects) is not true
    const str = fmt({ locale: 'de-DE', format: { useGrouping: 'false' as unknown as boolean } });
    expect(fmt({ locale: 'de-DE', format: { useGrouping: false } })).not.toBe(str);
  });

  it('is bounded (least recently used evicted)', () => {
    const first = fmt({ suffixText: 'lru-0' });
    for (let i = 1; i <= 40; i++) fmt({ suffixText: `lru-${i}` });
    expect(fmt({ suffixText: 'lru-0' })).not.toBe(first);
    const hot = fmt({ suffixText: 'hot' });
    for (let i = 0; i < 40; i++) {
      fmt({ suffixText: `lru2-${i}` });
      expect(fmt({ suffixText: 'hot' })).toBe(hot);
    }
  });
});

describe('fallbacks and warnings (each issued once)', () => {
  async function freshFormat() {
    vi.resetModules();
    const format = await import('../src/format');
    const options = await import('../src/options');
    return (o: RollingNumberUpdate) => format.createFormatter(options.resolveOptions(o));
  }

  it('strips unsupported format keys with a one-time warning per key', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { notation: 'compact', maximumFractionDigits: 3 } as unknown as RollingNumberUpdate['format'];
    const f = make({ locale: 'en-US', format: bad });
    make({ locale: 'en-US', format: bad, prefixText: 'x' });
    make({ locale: 'de-DE', format: bad });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('format.notation');
    expect(String(warn.mock.calls[1][0])).toContain('format.maximumFractionDigits');
    expect(f.plain).toBe(false);
    expect(rest(f, 1234).text).toBe('1,234');
  });

  it('an invalid locale falls back to the runtime default locale, warning once', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = make({ locale: 'xx-$$' });
    make({ locale: 'xx-$$', prefixText: 'y' });
    expect(f.plain).toBe(false);
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    const n = warn.mock.calls.length;
    make({ locale: 'xx-$$', suffixText: 'z' });
    expect(warn).toHaveBeenCalledTimes(n);
    // a list keeps its valid tags silently
    warn.mockClear();
    expect(rest(make({ locale: ['$$', 'de-DE'] }), 1234.5).text).toBe('1.235');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('distinct warnings are capped (e.g. Accept-Language locales on a server): 100, then one notice', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 1000; i++) make({ locale: `xx-$$${i}` });
    expect(warn).toHaveBeenCalledTimes(101);
    expect(String(warn.mock.calls[99][0])).toContain('"xx-$$99"');
    expect(String(warn.mock.calls[100][0])).toMatch(/further .*warnings .*suppressed/i);
    // nothing else is warned (or remembered) afterwards
    make({ locale: 'en-US', format: { notation: 'compact' } as unknown as RollingNumberUpdate['format'] });
    expect(warn).toHaveBeenCalledTimes(101);
  });

  it('a value clamped by decimals or percent scaling warns once, naming the safe maximum', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // in range, or clamped by the 1.x MAX_SAFE_INTEGER rule only: silent
    expect(rest(make({ decimals: 10 }), 900719.92).text).toBe('900719.9200000000');
    expect(rest(make({}), 1e300).text).toBe(String(MAX_SAFE));
    expect(rest(make({ locale: 'en-US' }), 1e300).text).toBe('9,007,199,254,740,991');
    expect(warn).not.toHaveBeenCalled();
    const f = make({ decimals: 10 });
    expect(rest(f, 1e6).text).toBe('900719.9254740991');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('900719.9254740991');
    rest(f, -5e6);
    rest(make({ decimals: 10, prefixText: '$' }), 2e6);
    expect(warn).toHaveBeenCalledTimes(1);
    const p = make({ locale: 'en-US', format: { style: 'percent' } });
    expect(rest(p, 1e14).text).toMatch(/^9,007,199,254,740,99\d%$/);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('±90071992547409.9,');
  });

  it('an Intl construction error falls back to the plain path, warning once', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noCurrency = { style: 'currency' } as unknown as RollingNumberUpdate['format'];
    const f = make({ locale: 'en-US', format: noCurrency, value: 1 });
    make({ locale: 'en-US', format: noCurrency, prefixText: '1' });
    expect(f.plain).toBe(true);
    expect(rest(f, -1234).text).toBe('-1234');
    expect(warn).toHaveBeenCalledTimes(1);
    const badUnit = make({ locale: 'en-US', format: { style: 'unit', unit: 'not-a-unit' } });
    expect(badUnit.plain).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a string useGrouping the engine rejects is retried with true', async () => {
    const make = await freshFormat();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = make({ locale: 'en-US', format: { useGrouping: 'bogus' as unknown as 'min2' } });
    expect(f.plain).toBe(false);
    expect(rest(f, 1234).text).toBe('1,234');
    expect(warn).not.toHaveBeenCalled();
    expect(rest(make({ locale: 'en-US', format: { useGrouping: 'min2' } }), 1234).text).toBe('1234');
    expect(rest(make({ locale: 'en-US', format: { useGrouping: false } }), 1234).text).toBe('1234');
  });
});

describe('resolveLabel', () => {
  const o = (x: RollingNumberUpdate) => resolveOptions(x);

  it('default: the unclamped formatted value with affixes', () => {
    const opts = o({ value: 150, max: 99, overflowSuffix: '+', prefixText: '#', suffixText: ' pts' });
    const f = createFormatter(opts);
    expect(resolveLabel(opts, f, 150, true)).toBe('#150 pts');
    const eur = o({ locale: 'en-US', format: { style: 'currency', currency: 'EUR' } });
    expect(resolveLabel(eur, createFormatter(eur), -1234.5, false)).toBe('-€1,234.50');
    expect(resolveLabel(o({}), createFormatter(o({})), -0.4, false)).toBe('0');
  });

  it('string: every {value} is replaced by the default text', () => {
    const opts = o({ label: '{value} points ({value}) $& $1', locale: 'en-US' });
    expect(resolveLabel(opts, createFormatter(opts), 1234, false)).toBe('1,234 points (1,234) $& $1');
    const fixed = o({ label: 'Score' });
    expect(resolveLabel(fixed, createFormatter(fixed), 5, false)).toBe('Score');
  });

  it('function: receives { text, value, overflow }', () => {
    const fn = vi.fn((i: { text: string; value: number; overflow: boolean }) => `${i.text}|${i.value}|${i.overflow}`);
    const opts = o({ label: fn, overflowSuffix: '+' });
    expect(resolveLabel(opts, createFormatter(opts), 150, true)).toBe('150|150|true');
    expect(fn).toHaveBeenCalledWith({ text: '150', value: 150, overflow: true });
    const num = o({ label: (() => 42) as unknown as () => string });
    expect(resolveLabel(num, createFormatter(num), 1, false)).toBe('42');
  });

  it('a throwing or empty function falls back to the default text (warned once per function)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrower = () => {
      throw new Error('boom');
    };
    const opts = o({ label: thrower });
    const f = createFormatter(opts);
    expect(resolveLabel(opts, f, 7, false)).toBe('7');
    expect(resolveLabel(opts, f, 8, false)).toBe('8');
    expect(warn).toHaveBeenCalledTimes(1);
    const empty = o({ label: (() => undefined) as unknown as () => string });
    expect(resolveLabel(empty, createFormatter(empty), 9, false)).toBe('9');
  });
});
