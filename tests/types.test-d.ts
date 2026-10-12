import { describe, expectTypeOf, it } from 'vitest';
import {
  RollingNumberCore,
  RollingNumberElement,
  configureRollingNumber,
  defineRollingNumber,
  injectRollingNumberStyles,
  renderStaticHTML,
  renderStaticText,
  rollingNumber,
  type RollingNumberActionParam,
  type RollingNumberActionReturn,
  type RollingNumberAttributes,
  type RollingNumberConfig,
  type RollingNumberEasing,
  type RollingNumberEasingName,
  type RollingNumberEvent,
  type RollingNumberEventDetail,
  type RollingNumberEventMap,
  type RollingNumberFormat,
  type RollingNumberLabelInfo,
  type RollingNumberLive,
  type RollingNumberMode,
  type RollingNumberOptions,
  type RollingNumberSetValueOptions,
  type RollingNumberSettled,
  type RollingNumberTrigger,
  type RollingNumberUpdate
} from '../src/index';
import * as ActionEntry from '../src/action-entry';
import * as SsrEntry from '../src/ssr-entry';
import { RN_DEFAULTS, normalizeOptions } from '../src/core';
import { OPTION_ATTRIBUTES, OPTION_KEYS } from '../src/options';
import {
  RollingNumber as VueRollingNumber,
  vRollingNumber,
  type RollingNumberBinding,
  type RollingNumberProps as VueProps
} from '../src/vue';

describe('core option types', () => {
  it('RollingNumberOptions: the 1.x fields keep their types, plus the 1.3 fields', () => {
    expectTypeOf<RollingNumberOptions>().toEqualTypeOf<{
      value?: number;
      pad?: number;
      max?: number | null;
      interpolate?: boolean;
      duration?: number;
      easing?: RollingNumberEasing;
      decimals?: number;
      locale?: string | readonly string[];
      format?: RollingNumberFormat;
      prefixText?: string;
      suffixText?: string;
      overflowSuffix?: string;
      mode?: RollingNumberMode;
      from?: number | null;
      trigger?: RollingNumberTrigger;
      label?: string | ((info: RollingNumberLabelInfo) => string);
      live?: RollingNumberLive;
      injectStyles?: boolean;
    }>();
  });

  it('RollingNumberUpdate accepts null for every field (reset to default)', () => {
    expectTypeOf<RollingNumberUpdate['duration']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<RollingNumberUpdate['format']>().toEqualTypeOf<RollingNumberFormat | null | undefined>();
    const reset: RollingNumberUpdate = { duration: null, easing: null, locale: null, label: null, pad: null };
    void reset;
    expectTypeOf<RollingNumberOptions>().toMatchTypeOf<RollingNumberUpdate>();
  });

  it('OPTION_KEYS lists every option exactly once (exhaustive)', () => {
    expectTypeOf<(typeof OPTION_KEYS)[number]>().toEqualTypeOf<keyof RollingNumberOptions>();
    expectTypeOf(OPTION_ATTRIBUTES).toEqualTypeOf<Readonly<Record<keyof RollingNumberOptions, string>>>();
  });

  it('RN_DEFAULTS and normalizeOptions keep their 1.2 (five fields) shapes', () => {
    type Legacy = { value: number; pad: number; max: number | null; interpolate: boolean; duration: number };
    expectTypeOf(RN_DEFAULTS).toEqualTypeOf<Readonly<Legacy>>();
    expectTypeOf(normalizeOptions).parameter(0).toEqualTypeOf<RollingNumberOptions | undefined | null>();
    expectTypeOf(normalizeOptions).returns.toEqualTypeOf<Legacy>();
    expectTypeOf(normalizeOptions({}).max).toEqualTypeOf<number | null>();
  });

  it('RollingNumberCore public API signatures', () => {
    expectTypeOf(RollingNumberCore).constructorParameters.toEqualTypeOf<[HTMLElement | SVGElement, RollingNumberUpdate?]>();
    const core = new RollingNumberCore(document.createElement('span'), { value: 1 });
    expectTypeOf(core.setValue).parameters.toEqualTypeOf<[number, (boolean | RollingNumberSetValueOptions)?]>();
    expectTypeOf(core.setValue).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(core.whenSettled).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(core.finish).returns.toBeVoid();
    expectTypeOf(core.getValue).returns.toBeNumber();
    expectTypeOf(core.getDisplayValue).returns.toBeNumber();
    expectTypeOf(core.getText).returns.toBeString();
    expectTypeOf(core.getMode).returns.toEqualTypeOf<'columns' | 'text'>();
    expectTypeOf(core.getElement).returns.toEqualTypeOf<HTMLElement>();
    expectTypeOf(core.getHost).returns.toEqualTypeOf<HTMLElement | SVGElement>();
    expectTypeOf(core.isAnimating).returns.toBeBoolean();
    expectTypeOf(core.setMax).parameter(0).toEqualTypeOf<number | null>();
    expectTypeOf(core.setDuration).parameter(0).toEqualTypeOf<number | null>();
    expectTypeOf(core.update).parameter(0).toEqualTypeOf<RollingNumberUpdate>();
    expectTypeOf(core.destroy).returns.toBeVoid();
    core.setDuration(null);
    void core.setValue(5, { motion: 'roll', duration: 300, easing: 'ease-out-expo' });
    new RollingNumberCore(document.createElementNS('http://www.w3.org/2000/svg', 'text'), { mode: 'text' });

    // @ts-expect-error pad must be a number
    new RollingNumberCore(document.createElement('span'), { pad: 'x' });
    // @ts-expect-error format is an object, not a locale string
    new RollingNumberCore(document.createElement('span'), { format: 'en' });
    // @ts-expect-error unknown option
    new RollingNumberCore(document.createElement('span'), { prefix: '$' });
    // @ts-expect-error unknown motion
    void core.setValue(1, { motion: 'jump' });
  });

  it('format is a discriminated union on style', () => {
    const ok: RollingNumberFormat[] = [
      {},
      { useGrouping: false, signDisplay: 'always' },
      { style: 'percent' },
      { style: 'currency', currency: 'EUR', currencySign: 'accounting' },
      { style: 'unit', unit: 'kilometer-per-hour', unitDisplay: 'long' },
      { style: 'unit', unit: 'furlong-per-fortnight' }
    ];
    void ok;
    // @ts-expect-error currency requires `currency`
    const noCurrency: RollingNumberFormat = { style: 'currency' };
    // @ts-expect-error `currency` needs style: 'currency'
    const strayCurrency: RollingNumberFormat = { currency: 'EUR' };
    // @ts-expect-error `unit` does not belong to percent
    const percentUnit: RollingNumberFormat = { style: 'percent', unit: 'meter' };
    // @ts-expect-error unit requires `unit`
    const noUnit: RollingNumberFormat = { style: 'unit' };
    void noCurrency;
    void strayCurrency;
    void percentUnit;
    void noUnit;
  });

  it('easing accepts presets, CSS easing strings and functions', () => {
    const ok: RollingNumberEasing[] = [
      'odometer',
      'ease-out-cubic',
      'linear',
      'cubic-bezier(0.2, 1, 0.3, 1)',
      'linear(0, 0.5 30%, 1)',
      'steps(4, jump-end)',
      (p: number) => p * p
    ];
    void ok;
    expectTypeOf<'odometer'>().toMatchTypeOf<RollingNumberEasingName>();
    // @ts-expect-error not a preset nor a CSS easing function
    const bad: RollingNumberEasing = 'bouncy';
    void bad;
  });

  it('rn-start / rn-end listeners are typed on HTML, SVG and <rolling-number> hosts', () => {
    const html = document.createElement('span');
    html.addEventListener('rn-end', (e) => {
      expectTypeOf(e).toEqualTypeOf<RollingNumberEvent>();
      expectTypeOf(e.detail).toEqualTypeOf<RollingNumberEventDetail>();
      expectTypeOf(e.detail.value).toBeNumber();
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    svg.addEventListener('rn-start', (e) => expectTypeOf(e.detail.animated).toBeBoolean());
    const el = document.createElement('rolling-number');
    el.addEventListener('rn-end', (e) => expectTypeOf(e.detail.from).toBeNumber());
    expectTypeOf<RollingNumberEventMap['rn-start']>().toEqualTypeOf<CustomEvent<RollingNumberEventDetail>>();
  });

  it('entry points export the 1.3 helpers', () => {
    expectTypeOf(configureRollingNumber).parameter(0).toEqualTypeOf<RollingNumberConfig>();
    expectTypeOf(injectRollingNumberStyles).parameter(0).toEqualTypeOf<Document | ShadowRoot>();
    expectTypeOf(rollingNumber).parameters.toEqualTypeOf<[Element, RollingNumberActionParam?]>();
    expectTypeOf(rollingNumber).returns.toEqualTypeOf<RollingNumberActionReturn>();
    expectTypeOf<RollingNumberActionReturn['core']>().toEqualTypeOf<RollingNumberCore | null>();
    expectTypeOf(renderStaticText).returns.toBeString();
    expectTypeOf(renderStaticHTML).parameter(1).toEqualTypeOf<{ tag?: string; attrs?: Record<string, string> } | undefined>();
    expectTypeOf(ActionEntry.rollingNumber).toEqualTypeOf(rollingNumber);
    expectTypeOf(SsrEntry.renderStaticHTML).toEqualTypeOf(renderStaticHTML);
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
