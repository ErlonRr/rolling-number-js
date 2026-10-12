// Vue adapter types (WP9). Template typing (`@rn-start`, template refs in an
// SFC) needs vue-tsc: see tests/vue-types/Fixture.vue (`pnpm check:vue-types`).
import { describe, expectTypeOf, it } from 'vitest';
import { h, ref } from 'vue';
import {
  RollingNumber,
  vRollingNumber,
  type RollingNumberBinding,
  type RollingNumberExposed,
  type RollingNumberInstance,
  type RollingNumberProps
} from '../src/vue';
import type { RollingNumberCore } from '../src/core';
import type {
  RollingNumberEasing,
  RollingNumberEvent,
  RollingNumberFormat,
  RollingNumberOptions,
  RollingNumberSetValueOptions,
  RollingNumberSettled
} from '../src/types';

describe('Vue types', () => {
  it('directive binding accepts numbers, strings, every option and a target', () => {
    expectTypeOf<number>().toMatchTypeOf<RollingNumberBinding>();
    expectTypeOf<string>().toMatchTypeOf<RollingNumberBinding>();
    expectTypeOf({ value: 1, pad: 2, max: 9, interpolate: false, duration: 100 }).toMatchTypeOf<RollingNumberBinding>();
    const full: RollingNumberBinding = {
      value: 1,
      duration: null,
      easing: 'odometer',
      locale: ['de-DE'],
      format: { style: 'currency', currency: 'EUR' },
      prefixText: '~',
      label: (i) => i.text,
      target: '.n'
    };
    const byElement: RollingNumberBinding = { value: 1, target: null as unknown as Element };
    void full;
    void byElement;
    // @ts-expect-error target is a selector or an element
    const badTarget: RollingNumberBinding = { value: 1, target: 5 };
    // @ts-expect-error currency format requires `currency`
    const badFormat: RollingNumberBinding = { value: 1, format: { style: 'currency' } };
    void badTarget;
    void badFormat;
    expectTypeOf(vRollingNumber.mounted).not.toBeUndefined();
    expectTypeOf(vRollingNumber.getSSRProps).not.toBeUndefined();
  });

  it('component props: every option, the Vue extras and typed listeners', () => {
    expectTypeOf<RollingNumberProps['interpolate']>().toEqualTypeOf<boolean | string | undefined>();
    expectTypeOf<RollingNumberProps['max']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<RollingNumberProps['duration']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RollingNumberProps['easing']>().toEqualTypeOf<RollingNumberEasing | undefined>();
    expectTypeOf<RollingNumberProps['format']>().toEqualTypeOf<RollingNumberFormat | undefined>();
    expectTypeOf<RollingNumberProps['staticFallback']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<NonNullable<RollingNumberProps['onRnStart']>>().parameter(0).toEqualTypeOf<RollingNumberEvent>();
    expectTypeOf<NonNullable<RollingNumberProps['onRnEnd']>>().parameter(0).toEqualTypeOf<RollingNumberEvent>();
    expectTypeOf<keyof RollingNumberOptions>().toMatchTypeOf<keyof RollingNumberProps>();
    expectTypeOf(RollingNumber).not.toBeAny();
  });

  it('h() checks the component props', () => {
    h(RollingNumber, {
      value: 1,
      format: { style: 'currency', currency: 'EUR' },
      onRnEnd: (e) => {
        expectTypeOf(e).toEqualTypeOf<RollingNumberEvent>();
        return e.detail.value;
      },
      staticFallback: true,
      class: 'badge'
    });
    // @ts-expect-error pad is numeric
    h(RollingNumber, { pad: 'x' });
    // @ts-expect-error the listener receives a RollingNumberEvent
    h(RollingNumber, { onRnStart: (e: string) => e });
  });

  it('template ref: RollingNumberExposed', () => {
    expectTypeOf<RollingNumberInstance>().toEqualTypeOf<RollingNumberExposed>();
    expectTypeOf<keyof RollingNumberOptions>().toMatchTypeOf<keyof RollingNumberExposed>();
    expectTypeOf<RollingNumberExposed['value']>().toEqualTypeOf<number>();
    expectTypeOf<RollingNumberExposed['interpolate']>().toEqualTypeOf<boolean>();
    expectTypeOf<RollingNumberExposed['duration']>().toEqualTypeOf<number>();
    expectTypeOf<RollingNumberExposed['decimals']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RollingNumberExposed['injectStyles']>().toEqualTypeOf<boolean>();
    expectTypeOf<RollingNumberExposed['core']>().toEqualTypeOf<RollingNumberCore | null>();
    expectTypeOf<RollingNumberExposed['el']>().toEqualTypeOf<HTMLElement | null>();
    expectTypeOf<RollingNumberExposed['setValue']>().parameters.toEqualTypeOf<
      [value: number, animate?: boolean | RollingNumberSetValueOptions]
    >();
    expectTypeOf<RollingNumberExposed['setValue']>().returns.resolves.toEqualTypeOf<RollingNumberSettled>();
    expectTypeOf<RollingNumberExposed['whenSettled']>().returns.resolves.toEqualTypeOf<RollingNumberSettled>();
    expectTypeOf<RollingNumberExposed['getDisplayValue']>().returns.toBeNumber();

    type Instance = InstanceType<typeof RollingNumber>;
    expectTypeOf<Instance['setValue']>().returns.resolves.toEqualTypeOf<RollingNumberSettled>();
    expectTypeOf<Instance['core']>().toEqualTypeOf<RollingNumberCore | null>();
    expectTypeOf<Instance['value']>().toEqualTypeOf<number>();
    expectTypeOf<Instance['interpolate']>().toEqualTypeOf<boolean>();

    const counter = ref<RollingNumberInstance | null>(null);
    void counter.value?.setValue(5, { motion: 'none' }).then((s) => s.completed);
    if (counter.value) {
      // @ts-expect-error exposed props are read-only
      counter.value.value = 3;
    }
  });
});
