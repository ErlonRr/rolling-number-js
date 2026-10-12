import { describe, expectTypeOf, it } from 'vitest';
import { createRef } from 'react';
import type { RollingNumberAttributes, RollingNumberElement } from '../src/element';
import type {
  RollingNumberEasing,
  RollingNumberEvent,
  RollingNumberFormat,
  RollingNumberLabelInfo,
  RollingNumberLive,
  RollingNumberMode,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberTrigger
} from '../src/types';
import { RollingNumber } from '../src/react';
import type { RollingNumberJSXProps } from '../src/jsx';
import type { RollingNumberElementEvents, RollingNumberElementProps } from '../src/vue-element';

describe('JSX typing', () => {
  it('types the React component', () => {
    const ok = <RollingNumber value={5} pad={2} max={99} interpolate={false} duration={600} className="b" />;
    expectTypeOf(ok).not.toBeAny();
    // @ts-expect-error pad is numeric
    void (<RollingNumber pad="x" />);
    // @ts-expect-error children are not allowed
    void (<RollingNumber value={1}>text</RollingNumber>);
  });

  it('types the raw <rolling-number> custom element', () => {
    const ref = createRef<RollingNumberElement>();
    const ok = <rolling-number ref={ref} value={5} pad="3" max={null} interpolate="false" duration={600} className="x" />;
    expectTypeOf(ok).not.toBeAny();
    // @ts-expect-error not a numeric string
    void (<rolling-number pad="x" />);
    // @ts-expect-error interpolate only accepts booleans or 'true' / 'false'
    void (<rolling-number interpolate="nope" />);
  });

  it('accepts `class` on <rolling-number> (React 18 writes `className` as an inert attribute)', () => {
    const ok = <rolling-number class="badge" value={1} />;
    expectTypeOf(ok).not.toBeAny();
    expectTypeOf<RollingNumberJSXProps['class']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RollingNumberJSXProps['className']>().toEqualTypeOf<string | undefined>();
    // @ts-expect-error class is a string
    void (<rolling-number class={5} />);
  });

  it('types the 1.3 attributes of <rolling-number>', () => {
    const ok = (
      <rolling-number
        value="1234.5"
        no-interpolate
        easing="ease-out-expo"
        decimals={2}
        locale={['fr-CA', 'fr']}
        format={{ style: 'currency', currency: 'EUR' }}
        prefix-text="≈ "
        suffix-text=" pts"
        overflow-suffix="+"
        mode="columns"
        from={0}
        trigger="visible"
        label="{value} points"
        live="polite"
        inject-styles="false"
      />
    );
    expectTypeOf(ok).not.toBeAny();
    void (<rolling-number easing="cubic-bezier(0.2, 1, 0.3, 1)" decimals="2" locale="de-DE, fr" format='{"style":"percent"}' />);
    void (<rolling-number easing={(p) => p * p} label={({ text, overflow }) => (overflow ? 'many' : text)} />);
    void (<rolling-number no-interpolate={false} from="5" live="" duration={null} easing={null} />);

    // @ts-expect-error unknown easing preset
    void (<rolling-number easing="bouncy" />);
    // @ts-expect-error decimals is numeric
    void (<rolling-number decimals="two" />);
    // @ts-expect-error currency format requires `currency`
    void (<rolling-number format={{ style: 'currency' }} />);
    // @ts-expect-error mode is 'auto' | 'columns' | 'text'
    void (<rolling-number mode="digits" />);
    // @ts-expect-error trigger is 'immediate' | 'visible'
    void (<rolling-number trigger="later" />);
    // @ts-expect-error live is 'off' | 'polite' | 'assertive'
    void (<rolling-number live="loud" />);
    // @ts-expect-error prefix-text is a string
    void (<rolling-number prefix-text={5} />);
    // @ts-expect-error no-interpolate is a boolean attribute
    void (<rolling-number no-interpolate="yes" />);
    // @ts-expect-error inject-styles takes "true" / "false" strings in React (React 19 drops `false` attributes)
    void (<rolling-number inject-styles={false} />);
  });

  it('types the React 19 custom-event props onrn-start / onrn-end', () => {
    void (
      <rolling-number
        onrn-start={(e) => {
          expectTypeOf(e).toEqualTypeOf<RollingNumberEvent>();
          expectTypeOf(e.detail.from).toBeNumber();
        }}
        onrn-end={(e) => expectTypeOf(e.detail.animated).toBeBoolean()}
      />
    );
    expectTypeOf<RollingNumberJSXProps['onrn-end']>().toEqualTypeOf<((event: RollingNumberEvent) => void) | undefined>();
    // @ts-expect-error the listener receives the CustomEvent, not a number
    void (<rolling-number onrn-end={(e: number) => e} />);
    // @ts-expect-error children are not allowed
    void (<rolling-number>text</rolling-number>);
  });
});

describe('<rolling-number> element typings (1.3)', () => {
  it('RollingNumberAttributes has every attribute in attribute form', () => {
    expectTypeOf<keyof RollingNumberAttributes>().toEqualTypeOf<
      | 'value' | 'pad' | 'max' | 'interpolate' | 'no-interpolate' | 'duration' | 'easing' | 'decimals' | 'locale'
      | 'format' | 'prefix-text' | 'suffix-text' | 'overflow-suffix' | 'mode' | 'from' | 'trigger' | 'label' | 'live'
      | 'inject-styles'
    >();
    expectTypeOf<RollingNumberAttributes['decimals']>().toEqualTypeOf<number | `${number}` | null | undefined>();
    expectTypeOf<RollingNumberAttributes['no-interpolate']>().toEqualTypeOf<boolean | '' | null | undefined>();
    expectTypeOf<RollingNumberAttributes['format']>().toEqualTypeOf<RollingNumberFormat | string | null | undefined>();
    expectTypeOf<RollingNumberAttributes['easing']>().toEqualTypeOf<RollingNumberEasing | null | undefined>();
  });

  it('the element exposes typed 1.3 properties and methods', () => {
    const el = document.createElement('rolling-number');
    expectTypeOf(el.easing).toEqualTypeOf<RollingNumberEasing | null>();
    expectTypeOf(el.decimals).toEqualTypeOf<number | null>();
    expectTypeOf(el.locale).toEqualTypeOf<string | null>();
    expectTypeOf(el.format).toEqualTypeOf<RollingNumberFormat | null>();
    expectTypeOf(el.prefixText).toBeString();
    expectTypeOf(el.suffixText).toBeString();
    expectTypeOf(el.overflowSuffix).toBeString();
    expectTypeOf(el.mode).toEqualTypeOf<RollingNumberMode>();
    expectTypeOf(el.from).toEqualTypeOf<number | null>();
    expectTypeOf(el.trigger).toEqualTypeOf<RollingNumberTrigger>();
    expectTypeOf(el.label).toEqualTypeOf<string | ((info: RollingNumberLabelInfo) => string) | null>();
    expectTypeOf(el.live).toEqualTypeOf<RollingNumberLive>();
    expectTypeOf(el.injectStyles).toBeBoolean();
    expectTypeOf(el.setValue).parameters.toEqualTypeOf<[number, (boolean | RollingNumberSetValueOptions)?]>();
    expectTypeOf(el.setValue).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(el.whenSettled).returns.toEqualTypeOf<Promise<RollingNumberSettled>>();
    expectTypeOf(el.finish).returns.toBeVoid();
    expectTypeOf(el.getDisplayValue).returns.toBeNumber();

    el.locale = ['de-DE', 'fr'];
    el.easing = (p) => p * p;
    el.label = ({ text }) => `${text} pts`;
    el.format = { style: 'currency', currency: 'EUR' };
    el.decimals = null;
    el.from = undefined;
    // @ts-expect-error a currency format requires `currency`
    el.format = { style: 'currency' };
    // @ts-expect-error unknown mode
    el.mode = 'digits';
    // @ts-expect-error unknown easing preset
    el.easing = 'bouncy';
  });

  it('the Vue element typing also accepts camelCase names and typed @rn-* listeners', () => {
    expectTypeOf<RollingNumberElementProps['prefixText']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<RollingNumberElementProps['noInterpolate']>().toEqualTypeOf<boolean | '' | null | undefined>();
    expectTypeOf<RollingNumberElementProps['injectStyles']>().toEqualTypeOf<RollingNumberAttributes['inject-styles']>();
    expectTypeOf<RollingNumberElementProps>().not.toHaveProperty('prefix-text');
    expectTypeOf<RollingNumberElementEvents['onRnEnd']>().toEqualTypeOf<((event: RollingNumberEvent) => void) | undefined>();
  });
});
