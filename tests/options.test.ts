import { describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_KEYS,
  OPTION_ATTRIBUTES,
  OPTION_KEYS,
  RN_DEFAULTS_13,
  normalizeField,
  normalizeFormat,
  resolveOptions
} from '../src/options';
import { RN_DEFAULTS, normalizeOptions } from '../src/core';
import type { NormalizedOptions } from '../src/internal/contracts';
import { loose } from './helpers';

const easeFn = (p: number) => p;
const labelFn = () => 'x';

describe('RN_DEFAULTS_13', () => {
  it('is frozen and keeps the 1.x defaults; the 1.3 auto fields are null', () => {
    expect(Object.isFrozen(RN_DEFAULTS_13)).toBe(true);
    expect(RN_DEFAULTS_13).toEqual({
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
  });

  it('has exactly the keys of OPTION_KEYS', () => {
    expect(Object.keys(RN_DEFAULTS_13).sort()).toEqual([...OPTION_KEYS].sort());
    expect(new Set(OPTION_KEYS).size).toBe(OPTION_KEYS.length);
  });

  it('LAYOUT_KEYS are option keys', () => {
    for (const key of LAYOUT_KEYS) expect(OPTION_KEYS).toContain(key);
  });
});

describe('OPTION_ATTRIBUTES', () => {
  it('names every option, kebab-case', () => {
    expect(Object.keys(OPTION_ATTRIBUTES).sort()).toEqual([...OPTION_KEYS].sort());
    expect(OPTION_ATTRIBUTES.prefixText).toBe('prefix-text');
    expect(OPTION_ATTRIBUTES.suffixText).toBe('suffix-text');
    expect(OPTION_ATTRIBUTES.overflowSuffix).toBe('overflow-suffix');
    expect(OPTION_ATTRIBUTES.injectStyles).toBe('inject-styles');
    for (const name of Object.values(OPTION_ATTRIBUTES)) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(Object.isFrozen(OPTION_ATTRIBUTES)).toBe(true);
  });
});

describe('resolveOptions (constructor semantics)', () => {
  it('returns the defaults for null, undefined, non-objects and empty objects (new object every time)', () => {
    expect(resolveOptions(undefined)).toEqual(RN_DEFAULTS_13);
    expect(resolveOptions(null)).toEqual(RN_DEFAULTS_13);
    expect(resolveOptions(loose(42))).toEqual(RN_DEFAULTS_13);
    const a = resolveOptions({});
    expect(a).toEqual(RN_DEFAULTS_13);
    expect(a).not.toBe(resolveOptions({}));
    expect(Object.isFrozen(a)).toBe(false);
  });

  it('null resets every field to its default', () => {
    const allNull = Object.fromEntries(OPTION_KEYS.map((k) => [k, null]));
    expect(resolveOptions(allNull)).toEqual(RN_DEFAULTS_13);
  });

  // [field, input, expected]
  const table: Array<[keyof NormalizedOptions, unknown, unknown]> = [
    // 1.x fields: same normalization as 1.2
    ['value', '12', 12],
    ['value', NaN, 0],
    ['value', 'abc', 0],
    ['value', 1e21, Number.MAX_SAFE_INTEGER],
    ['value', -1e21, -Number.MAX_SAFE_INTEGER],
    ['value', 1.5, 1.5],
    ['pad', '3', 3],
    ['pad', 2.9, 2],
    ['pad', 0, 1],
    ['pad', Infinity, 1],
    ['pad', 1000, 64],
    ['max', 99, 99],
    ['max', 9.75, 9.75], // kept: the formatter floors it to `decimals` places
    ['max', '', null],
    ['max', -1, null],
    ['max', Infinity, null],
    ['interpolate', 'false', false],
    ['interpolate', 0, false],
    ['interpolate', 'true', true],
    ['interpolate', '', false],
    // duration: unset when non-finite (constructor), negative → 0
    ['duration', 600, 600],
    ['duration', '250', 250],
    ['duration', -5, 0],
    ['duration', 0, 0],
    ['duration', NaN, null],
    ['duration', 'abc', null],
    // 1.3 fields
    ['easing', 'ease-out-expo', 'ease-out-expo'],
    ['easing', '  linear  ', 'linear'],
    ['easing', '', null],
    ['easing', 42, null],
    ['easing', easeFn, easeFn],
    ['decimals', 2, 2],
    ['decimals', '2', 2],
    ['decimals', 2.7, 2],
    ['decimals', -1, 0],
    ['decimals', 99, 20],
    ['decimals', NaN, null],
    ['locale', 'de-DE', ['de-DE']],
    ['locale', 'fr-CA, fr', ['fr-CA', 'fr']],
    ['locale', 'fr-CA fr', ['fr-CA', 'fr']],
    ['locale', ['ja', '', 7, ' en '], ['ja', 'en']],
    ['locale', '', null],
    ['locale', [], null],
    ['locale', 42, null],
    ['format', { style: 'percent' }, { style: 'percent' }],
    ['format', '{"style":"currency","currency":"EUR"}', { style: 'currency', currency: 'EUR' }],
    ['format', '', null],
    ['format', [], null],
    ['format', 42, null],
    ['prefixText', '≈ ', '≈ '],
    ['prefixText', 5, '5'],
    ['suffixText', ' pts', ' pts'],
    ['overflowSuffix', '+', '+'],
    ['mode', 'text', 'text'],
    ['mode', 'columns', 'columns'],
    ['mode', 'overlay', 'auto'],
    ['from', 10, 10],
    ['from', '-3', -3],
    ['from', 1e21, Number.MAX_SAFE_INTEGER],
    ['from', NaN, null],
    ['from', '', null],
    ['trigger', 'visible', 'visible'],
    ['trigger', 'later', 'immediate'],
    ['label', '{value} points', '{value} points'],
    ['label', '', null],
    ['label', labelFn, labelFn],
    ['live', 'polite', 'polite'],
    ['live', 'assertive', 'assertive'],
    ['live', true, 'polite'],
    ['live', '', 'polite'],
    ['live', 'loud', 'off'],
    ['injectStyles', false, false],
    ['injectStyles', 'false', false],
    ['injectStyles', 'true', true]
  ];

  it.each(table)('%s: %j → %j', (field, input, expected) => {
    const resolved = resolveOptions(loose({ [field]: input }));
    expect(resolved[field]).toEqual(expected);
  });

  it('freezes locale arrays and copies format objects', () => {
    const format = { style: 'percent' as const };
    const o = resolveOptions({ locale: ['en'], format });
    expect(Object.isFrozen(o.locale)).toBe(true);
    expect(o.format).not.toBe(format);
    expect(Object.isFrozen(o.format)).toBe(true);
  });

  it('never throws on hostile input', () => {
    const hostile = {
      valueOf() {
        throw new Error('boom');
      }
    };
    const getterThrows = Object.defineProperty({}, 'pad', {
      get() {
        throw new Error('boom');
      }
    });
    expect(() => resolveOptions(loose({ value: hostile, pad: Symbol('x'), max: {}, duration: [], locale: {}, label: 1 }))).not.toThrow();
    expect(resolveOptions(loose(getterThrows)).pad).toBe(1);
  });

  it('never throws when a normalizer meets a hostile value (getter, proxy trap): that field gets its default', () => {
    const format = {
      style: 'currency',
      get currency(): string {
        throw new Error('boom');
      }
    };
    const keysTrap = new Proxy({}, {
      ownKeys() {
        throw new Error('boom');
      }
    });
    const getTrap = new Proxy(['en'], {
      get() {
        throw new Error('boom');
      }
    });
    const { proxy: revoked, revoke } = Proxy.revocable([], {});
    revoke();
    let o: NormalizedOptions | undefined;
    expect(() => (o = resolveOptions(loose({ format, locale: revoked, pad: 3, value: 7 })))).not.toThrow();
    expect(o).toMatchObject({ format: null, locale: null, pad: 3, value: 7 });
    expect(resolveOptions(loose({ format: keysTrap })).format).toBeNull();
    expect(resolveOptions(loose({ locale: getTrap })).locale).toBeNull();
    expect(resolveOptions(loose({ format: revoked })).format).toBeNull();
    // update semantics: the default too
    const current: NormalizedOptions = { ...RN_DEFAULTS_13, format: Object.freeze({ style: 'percent' }), locale: Object.freeze(['de']) };
    expect(normalizeField('format', keysTrap, current)).toBeNull();
    expect(normalizeField('locale', getTrap, current)).toBeNull();
  });

  it('warns once for an invalid format JSON string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeFormat('[object Object]')).toBeNull();
    expect(normalizeFormat('{"style":')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('format');
  });
});

describe('normalizeField (update semantics)', () => {
  const current: NormalizedOptions = {
    ...RN_DEFAULTS_13,
    value: 5,
    pad: 3,
    max: 99,
    interpolate: false,
    duration: 800,
    easing: 'linear',
    decimals: 2,
    locale: ['de-DE'],
    prefixText: '$',
    mode: 'text',
    trigger: 'visible',
    live: 'polite',
    injectStyles: false
  };

  it('undefined keeps the current value', () => {
    for (const key of OPTION_KEYS) {
      expect(normalizeField(key, undefined, current)).toEqual(current[key]);
    }
  });

  it('null resets to the default', () => {
    for (const key of OPTION_KEYS) {
      expect(normalizeField(key, null, current)).toEqual(RN_DEFAULTS_13[key]);
    }
    // S2: duration null → unset (auto), not "unchanged"
    expect(normalizeField('duration', null, current)).toBeNull();
  });

  it('a non-finite duration keeps the current value (1.x setDuration); negative → 0', () => {
    expect(normalizeField('duration', NaN, current)).toBe(800);
    expect(normalizeField('duration', 'abc', current)).toBe(800);
    expect(normalizeField('duration', -1, current)).toBe(0);
    expect(normalizeField('duration', 120, current)).toBe(120);
  });

  it('other fields normalize like the constructor', () => {
    expect(normalizeField('pad', '0', current)).toBe(1);
    expect(normalizeField('max', -3, current)).toBeNull();
    expect(normalizeField('interpolate', 'false', current)).toBe(false);
    expect(normalizeField('decimals', 30, current)).toBe(20);
    expect(normalizeField('mode', 'bogus', current)).toBe('auto');
  });
});

describe('1.2 compatibility shims (core.ts)', () => {
  it('RN_DEFAULTS and normalizeOptions are unchanged', () => {
    expect(RN_DEFAULTS).toEqual({ value: 0, pad: 1, max: null, interpolate: true, duration: 400 });
    expect(Object.isFrozen(RN_DEFAULTS)).toBe(true);
    expect(normalizeOptions({ duration: NaN })).toEqual(RN_DEFAULTS);
    expect(normalizeOptions({ max: 9.5 }).max).toBe(9);
    expect(Object.keys(normalizeOptions(loose({ format: { style: 'percent' }, label: 'x' })))).toEqual([
      'value',
      'pad',
      'max',
      'interpolate',
      'duration'
    ]);
  });
});
