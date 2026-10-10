import { describe, expectTypeOf, it } from 'vitest';
import { createElement, createRef, useRef } from 'react';
import {
  RollingNumberCore,
  RollingNumberElement,
  defineRollingNumber,
  type RollingNumberAttributes,
  type RollingNumberOptions
} from '../src/index';
import { RN_DEFAULTS, normalizeOptions } from '../src/core';
import { RollingNumber as ReactRollingNumber, useRollingNumber, type RollingNumberProps as ReactProps } from '../src/react';
import {
  RollingNumber as VueRollingNumber,
  vRollingNumber,
  type RollingNumberBinding,
  type RollingNumberProps as VueProps
} from '../src/vue';
import { RollingNumberDirective } from '../src/angular';

describe('core option types', () => {
  it('RollingNumberOptions keeps its public shape', () => {
    expectTypeOf<RollingNumberOptions>().toEqualTypeOf<{
      value?: number;
      pad?: number;
      max?: number | null;
      interpolate?: boolean;
      duration?: number;
    }>();
  });

  it('RN_DEFAULTS and normalizeOptions', () => {
    expectTypeOf(RN_DEFAULTS).toEqualTypeOf<
      Readonly<{ value: number; pad: number; max: number | null; interpolate: boolean; duration: number }>
    >();
    expectTypeOf(normalizeOptions).parameter(0).toEqualTypeOf<RollingNumberOptions | undefined | null>();
    expectTypeOf(normalizeOptions).returns.toEqualTypeOf<Required<RollingNumberOptions>>();
    expectTypeOf(normalizeOptions({}).max).toEqualTypeOf<number | null>();
  });

  it('RollingNumberCore public API signatures', () => {
    expectTypeOf(RollingNumberCore).constructorParameters.toEqualTypeOf<[HTMLElement, RollingNumberOptions?]>();
    const core = new RollingNumberCore(document.createElement('span'), { value: 1 });
    expectTypeOf(core.setValue).parameters.toEqualTypeOf<[number, boolean?]>();
    expectTypeOf(core.getValue).returns.toBeNumber();
    expectTypeOf(core.getElement).returns.toEqualTypeOf<HTMLElement>();
    expectTypeOf(core.isAnimating).returns.toBeBoolean();
    expectTypeOf(core.setMax).parameter(0).toEqualTypeOf<number | null>();
    expectTypeOf(core.update).parameter(0).toEqualTypeOf<RollingNumberOptions>();
    expectTypeOf(core.destroy).returns.toBeVoid();

    // @ts-expect-error pad must be a number
    new RollingNumberCore(document.createElement('span'), { pad: 'x' });
    // @ts-expect-error unknown option
    new RollingNumberCore(document.createElement('span'), { format: 'en' });
  });
});

describe('custom element types', () => {
  it('is mapped in HTMLElementTagNameMap', () => {
    expectTypeOf(document.createElement('rolling-number')).toEqualTypeOf<RollingNumberElement>();
    expectTypeOf(document.querySelector('rolling-number')).toEqualTypeOf<RollingNumberElement | null>();
    expectTypeOf(defineRollingNumber).parameters.toEqualTypeOf<[tagName?: string]>();
  });

  it('getters are typed, setters accept null/undefined', () => {
    const el = document.createElement('rolling-number');
    expectTypeOf(el.value).toBeNumber();
    expectTypeOf(el.pad).toBeNumber();
    expectTypeOf(el.max).toEqualTypeOf<number | null>();
    expectTypeOf(el.interpolate).toBeBoolean();
    expectTypeOf(el.duration).toBeNumber();
    el.value = null;
    el.pad = undefined;
    el.max = null;
    el.interpolate = null;
    el.duration = undefined;
    // @ts-expect-error value is numeric
    el.value = 'x';
  });

  it('RollingNumberAttributes accepts typed values and numeric strings only', () => {
    const ok: RollingNumberAttributes = { value: 5, pad: '3', max: null, interpolate: 'false', duration: '200' };
    expectTypeOf(ok).toMatchTypeOf<RollingNumberAttributes>();
    // @ts-expect-error not a numeric string
    const bad: RollingNumberAttributes = { pad: 'x' };
    // @ts-expect-error interpolate only accepts booleans or 'true' / 'false'
    const bad2: RollingNumberAttributes = { interpolate: 'nope' };
    void bad;
    void bad2;
  });
});

describe('React types', () => {
  it('RollingNumberProps = options + span attributes, without children', () => {
    expectTypeOf<ReactProps>().toMatchTypeOf<RollingNumberOptions>();
    expectTypeOf<ReactProps['className']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ReactProps>().not.toHaveProperty('children');
    expectTypeOf<ReactProps>().not.toHaveProperty('dangerouslySetInnerHTML');

    createElement(ReactRollingNumber, { value: 1, pad: 2, max: null, className: 'x', ref: createRef<HTMLSpanElement>() });
    // @ts-expect-error pad is numeric
    createElement(ReactRollingNumber, { pad: 'x' });
  });

  it('useRollingNumber accepts element refs and returns the core ref', () => {
    function Host() {
      const ref = useRef<HTMLDivElement>(null);
      const core = useRollingNumber(ref, { value: 1 });
      expectTypeOf(core.current).toEqualTypeOf<RollingNumberCore | null>();
      return null;
    }
    void Host;
  });
});

describe('Vue types', () => {
  it('directive binding accepts numbers, strings and every option', () => {
    expectTypeOf<number>().toMatchTypeOf<RollingNumberBinding>();
    expectTypeOf<string>().toMatchTypeOf<RollingNumberBinding>();
    expectTypeOf({ value: 1, pad: 2, max: 9, interpolate: false, duration: 100 }).toMatchTypeOf<RollingNumberBinding>();
    expectTypeOf(vRollingNumber.mounted).not.toBeUndefined();
  });

  it('component props', () => {
    expectTypeOf<VueProps['interpolate']>().toEqualTypeOf<boolean | string | undefined>();
    expectTypeOf<VueProps['max']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf(VueRollingNumber).not.toBeAny();
  });
});

describe('Angular types', () => {
  it('inputs read typed values and accept attribute strings', () => {
    const dir = null as unknown as RollingNumberDirective;
    expectTypeOf(dir.pad).toBeNumber();
    expectTypeOf(dir.max).toEqualTypeOf<number | null>();
    expectTypeOf(dir.interpolate).toBeBoolean();
    expectTypeOf(dir.duration).toBeNumber();
    expectTypeOf(dir.valueInput).toEqualTypeOf<number | string>();
    if (dir) {
      dir.pad = '3';
      dir.max = null;
      dir.interpolate = '';
      dir.duration = undefined;
      dir.valueInput = '42';
      // @ts-expect-error boolean is not a valid pad
      dir.pad = true;
    }
  });
});
