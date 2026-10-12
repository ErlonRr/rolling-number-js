import { describe, expectTypeOf, it } from 'vitest';
import type { EventEmitter } from '@angular/core';
import {
  RollingNumberDirective,
  type RollingNumberEasing,
  type RollingNumberEvent,
  type RollingNumberEventDetail,
  type RollingNumberFormat,
  type RollingNumberLabelInfo,
  type RollingNumberLive,
  type RollingNumberMode,
  type RollingNumberSetValueOptions,
  type RollingNumberSettled,
  type RollingNumberTrigger
} from '../src/angular';
import type { RollingNumberCore } from '../src/core';
import type { RollingNumberOptions } from '../src/types';

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

  it('rn* aliases of the 1.x inputs read the same types (rnDuration exposes unset as null)', () => {
    const dir = null as unknown as RollingNumberDirective;
    expectTypeOf(dir.rnPad).toEqualTypeOf<number>();
    expectTypeOf(dir.rnMax).toEqualTypeOf<number | null>();
    expectTypeOf(dir.rnInterpolate).toEqualTypeOf<boolean>();
    expectTypeOf(dir.rnDuration).toEqualTypeOf<number | null>();
    if (dir) {
      dir.rnPad = '3';
      dir.rnMax = '';
      dir.rnInterpolate = 'false';
      dir.rnInterpolate = 0;
      dir.rnDuration = null;
      dir.rnDuration = '';
      // @ts-expect-error objects are not durations
      dir.rnDuration = {};
    }
  });

  it('v1.3 rn* inputs: precise getters, setters accept attribute strings', () => {
    const dir = null as unknown as RollingNumberDirective;
    expectTypeOf(dir.rnEasing).toEqualTypeOf<RollingNumberEasing | null>();
    expectTypeOf(dir.rnDecimals).toEqualTypeOf<number | null>();
    expectTypeOf(dir.rnLocale).toEqualTypeOf<readonly string[] | null>();
    expectTypeOf(dir.rnFormat).toEqualTypeOf<RollingNumberFormat | null>();
    expectTypeOf(dir.rnPrefixText).toEqualTypeOf<string>();
    expectTypeOf(dir.rnSuffixText).toEqualTypeOf<string>();
    expectTypeOf(dir.rnOverflowSuffix).toEqualTypeOf<string>();
    expectTypeOf(dir.rnMode).toEqualTypeOf<RollingNumberMode>();
    expectTypeOf(dir.rnFrom).toEqualTypeOf<number | null>();
    expectTypeOf(dir.rnTrigger).toEqualTypeOf<RollingNumberTrigger>();
    expectTypeOf(dir.rnLabel).toEqualTypeOf<string | ((info: RollingNumberLabelInfo) => string) | null>();
    expectTypeOf(dir.rnLabel).toEqualTypeOf<NonNullable<RollingNumberOptions['label']> | null>();
    expectTypeOf(dir.rnLive).toEqualTypeOf<RollingNumberLive>();
    expectTypeOf(dir.rnInjectStyles).toEqualTypeOf<boolean>();
    expectTypeOf(dir.rnTarget).toMatchTypeOf<string>();
    expectTypeOf<'auto'>().toMatchTypeOf<typeof dir.rnTarget>();

    if (dir) {
      // Static attribute forms (string literals under strictTemplates).
      dir.rnEasing = 'ease-out-expo';
      dir.rnEasing = 'cubic-bezier(0.2, 1, 0.3, 1)';
      dir.rnEasing = (p) => p * p;
      dir.rnDecimals = '2';
      dir.rnLocale = 'de-DE, en';
      dir.rnLocale = ['de-CH', 'en'];
      dir.rnFormat = '{"style":"percent"}';
      dir.rnFormat = { style: 'currency', currency: 'EUR' };
      dir.rnPrefixText = '~';
      dir.rnSuffixText = null;
      dir.rnOverflowSuffix = '+';
      dir.rnMode = 'text';
      dir.rnFrom = '0';
      dir.rnTrigger = 'visible';
      dir.rnLabel = '{value} unread';
      dir.rnLabel = (info) => `${info.text} ${info.overflow ? '(max)' : ''}`;
      dir.rnLive = '';
      dir.rnLive = true;
      dir.rnLive = 'assertive';
      dir.rnInjectStyles = 'false';
      dir.rnTarget = 'host';
      dir.rnTarget = 'input.p-inputnumber-input';
      dir.rnTarget = null;

      // @ts-expect-error not a renderer
      dir.rnMode = 'sideways';
      // @ts-expect-error not a trigger
      dir.rnTrigger = 'hover';
      // @ts-expect-error not a politeness
      dir.rnLive = 'loud';
      // @ts-expect-error a currency format requires `currency`
      dir.rnFormat = { style: 'currency' };
      // @ts-expect-error `currency` belongs to `style: 'currency'`
      dir.rnFormat = { currency: 'EUR' };
      // @ts-expect-error not an easing
      dir.rnEasing = 'bouncy';
      // @ts-expect-error decimals are numbers
      dir.rnDecimals = true;
    }
  });

  it('outputs carry the rn-start / rn-end CustomEvent', () => {
    const dir = null as unknown as RollingNumberDirective;
    expectTypeOf(dir.rnStart).toEqualTypeOf<EventEmitter<RollingNumberEvent>>();
    expectTypeOf(dir.rnEnd).toEqualTypeOf<EventEmitter<RollingNumberEvent>>();
    expectTypeOf<RollingNumberEvent>().toEqualTypeOf<CustomEvent<RollingNumberEventDetail>>();
    if (dir) {
      dir.rnEnd.subscribe((e) => {
        expectTypeOf(e.detail.value).toBeNumber();
        expectTypeOf(e.detail.animated).toBeBoolean();
      });
    }
  });

  it('exportAs API: setValue / whenSettled / finish / getDisplayValue / core', () => {
    const dir = null as unknown as RollingNumberDirective;
    expectTypeOf(dir.setValue).parameters.toEqualTypeOf<[value: number, animate?: boolean | RollingNumberSetValueOptions]>();
    expectTypeOf(dir.setValue).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(dir.whenSettled).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(dir.finish).returns.toBeVoid();
    expectTypeOf(dir.getDisplayValue).returns.toBeNumber();
    expectTypeOf(dir.core).toEqualTypeOf<RollingNumberCore | null>();
    if (dir) {
      void dir.setValue(5, { motion: 'none' });
      // @ts-expect-error a string is not a target value here (the input coerces, the method does not)
      void dir.setValue('5');
      // @ts-expect-error read-only
      dir.core = null;
    }
  });
});
