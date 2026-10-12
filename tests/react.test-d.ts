import { describe, expectTypeOf, it } from 'vitest';
import { createElement, createRef, useRef, type HTMLAttributes, type MutableRefObject, type Ref } from 'react';
import {
  RollingNumber,
  useRollingNumber,
  type RollingNumberCore as ReactEntryCore,
  type RollingNumberEvent,
  type RollingNumberEventDetail,
  type RollingNumberFormat,
  type RollingNumberOptions,
  type RollingNumberProps,
  type RollingNumberSettled,
  type RollingNumberUpdate
} from '../src/react';
import { RollingNumberCore } from '../src/core';
import type * as Types from '../src/types';

type SpanAttributes = HTMLAttributes<HTMLSpanElement>;

describe('React types', () => {
  it('RollingNumberProps = options + span attributes, without children', () => {
    expectTypeOf<RollingNumberProps>().toMatchTypeOf<RollingNumberOptions>();
    expectTypeOf<RollingNumberProps['className']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RollingNumberProps>().not.toHaveProperty('children');
    expectTypeOf<RollingNumberProps>().not.toHaveProperty('dangerouslySetInnerHTML');

    createElement(RollingNumber, { value: 1, pad: 2, max: null, className: 'x', ref: createRef<HTMLSpanElement>() });
    // @ts-expect-error pad is numeric
    createElement(RollingNumber, { pad: 'x' });
    // @ts-expect-error children are owned by the counter
    createElement(RollingNumber, { value: 1, children: 'x' });
    // @ts-expect-error ref is the span, not the core
    createElement(RollingNumber, { ref: createRef<RollingNumberCore>() });
  });

  it('every option keeps its RollingNumberOptions type', () => {
    type OptionProps = Pick<RollingNumberProps, keyof RollingNumberOptions>;
    expectTypeOf<OptionProps>().toEqualTypeOf<Pick<RollingNumberOptions, keyof RollingNumberOptions>>();
  });

  it('no option or adapter prop collides with a span attribute', () => {
    expectTypeOf<Extract<keyof RollingNumberOptions, keyof SpanAttributes>>().toBeNever();
    expectTypeOf<Extract<'onRnStart' | 'onRnEnd' | 'coreRef' | 'staticFallback', keyof SpanAttributes>>().toBeNever();
    // `prefix` stays the (RDFa) span attribute; the option is `prefixText`.
    expectTypeOf<RollingNumberProps['prefix']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RollingNumberProps['prefixText']>().toEqualTypeOf<string | undefined>();
  });

  it('event props receive the DOM CustomEvent', () => {
    expectTypeOf<RollingNumberProps['onRnStart']>().toEqualTypeOf<((event: RollingNumberEvent) => void) | undefined>();
    expectTypeOf<RollingNumberProps['onRnEnd']>().toEqualTypeOf<((event: RollingNumberEvent) => void) | undefined>();
    expectTypeOf<RollingNumberEvent>().toEqualTypeOf<CustomEvent<RollingNumberEventDetail>>();
    createElement(RollingNumber, {
      value: 1,
      onRnStart: (e) => expectTypeOf(e.detail.from).toBeNumber(),
      onRnEnd: (e) => expectTypeOf(e.detail.animated).toBeBoolean()
    });
    // @ts-expect-error the handler receives an event, not a number
    createElement(RollingNumber, { onRnEnd: (value: string) => value });
  });

  it('coreRef accepts object and callback refs to the core', () => {
    expectTypeOf<RollingNumberProps['coreRef']>().toEqualTypeOf<Ref<RollingNumberCore | null> | undefined>();
    function Host() {
      const objectRef = useRef<RollingNumberCore>(null);
      const mutableRef = useRef<RollingNumberCore | null>(null);
      createElement(RollingNumber, { coreRef: objectRef });
      createElement(RollingNumber, { coreRef: mutableRef });
      createElement(RollingNumber, { coreRef: createRef<RollingNumberCore>() });
      createElement(RollingNumber, {
        coreRef: (core) => {
          expectTypeOf(core).toEqualTypeOf<RollingNumberCore | null>();
          void core?.setValue(1).then((s) => expectTypeOf(s).toEqualTypeOf<RollingNumberSettled>());
        }
      });
      // @ts-expect-error coreRef holds the core, not the span
      createElement(RollingNumber, { coreRef: createRef<HTMLSpanElement>() });
      return null;
    }
    void Host;
  });

  it('staticFallback is a boolean', () => {
    expectTypeOf<RollingNumberProps['staticFallback']>().toEqualTypeOf<boolean | undefined>();
    createElement(RollingNumber, { value: 1, staticFallback: true });
    // @ts-expect-error not a string
    createElement(RollingNumber, { staticFallback: 'yes' });
  });

  it('1.3 options are typed', () => {
    createElement(RollingNumber, {
      value: 1234.5,
      decimals: 2,
      locale: ['de-DE', 'en'],
      format: { style: 'currency', currency: 'EUR' },
      easing: 'cubic-bezier(0.2, 1, 0.3, 1)',
      prefixText: '≈ ',
      suffixText: ' pts',
      overflowSuffix: '+',
      mode: 'columns',
      from: 0,
      trigger: 'visible',
      label: ({ text }) => `Score ${text}`,
      live: 'polite',
      injectStyles: false
    });
    // @ts-expect-error currency requires `currency`
    createElement(RollingNumber, { format: { style: 'currency' } });
    // @ts-expect-error unknown easing preset
    createElement(RollingNumber, { easing: 'bouncy' });
    // @ts-expect-error unknown mode
    createElement(RollingNumber, { mode: 'svg' });
    // @ts-expect-error duration is a number (absent = unset)
    createElement(RollingNumber, { duration: '400' });
    expectTypeOf<RollingNumberProps['format']>().toEqualTypeOf<RollingNumberFormat | undefined>();
  });

  it('useRollingNumber accepts element refs and RollingNumberUpdate, and returns the core ref', () => {
    expectTypeOf(useRollingNumber).parameter(1).toEqualTypeOf<RollingNumberUpdate>();
    expectTypeOf(useRollingNumber).returns.toEqualTypeOf<MutableRefObject<RollingNumberCore | null>>();
    function Host() {
      const div = useRef<HTMLDivElement>(null);
      const core = useRollingNumber(div, { value: 1 });
      expectTypeOf(core.current).toEqualTypeOf<RollingNumberCore | null>();
      // Any element: SVG text, form controls, a generic Element ref.
      useRollingNumber(useRef<SVGTextElement>(null), { value: 1, mode: 'text' });
      useRollingNumber(useRef<HTMLInputElement | null>(null), { value: 1 });
      useRollingNumber(useRef<Element | null>(null), { value: 1 });
      // `null` resets a field to its default.
      useRollingNumber(div, { value: 1, duration: null, easing: null, format: null, from: null });
      // @ts-expect-error not an element ref
      useRollingNumber(useRef<string>(null), { value: 1 });
      // @ts-expect-error pad is numeric
      useRollingNumber(div, { pad: 'x' });
      return null;
    }
    void Host;
  });

  it('the entry re-exports the core type and the public types', () => {
    expectTypeOf<ReactEntryCore>().toEqualTypeOf<RollingNumberCore>();
    expectTypeOf<RollingNumberOptions>().toEqualTypeOf<Types.RollingNumberOptions>();
    expectTypeOf<RollingNumberUpdate>().toEqualTypeOf<Types.RollingNumberUpdate>();
    expectTypeOf<RollingNumberSettled>().toEqualTypeOf<Types.RollingNumberSettled>();
    expectTypeOf<RollingNumberEvent>().toEqualTypeOf<Types.RollingNumberEvent>();
  });
});
