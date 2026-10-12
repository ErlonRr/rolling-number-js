/**
 * Type-only module: types `<rolling-number>` (the custom element) in React JSX.
 *
 * Included automatically by `rolling-number/react`. When you use the custom
 * element without the React wrapper, opt in once (e.g. in a `global.d.ts` or
 * your entry file):
 *
 * ```ts
 * import type {} from 'rolling-number/jsx';
 * // or: /// <reference types="rolling-number/jsx" />
 * ```
 *
 * It augments both the module-scoped `React.JSX` namespace (React 18.3+/19,
 * `"jsx": "react-jsx"`) and the legacy global `JSX` namespace (older
 * `@types/react`). Requires `@types/react`; non-React projects never load it.
 *
 * React 19 sets known properties on a defined custom element and attaches
 * `on<event>` props as native listeners: `onrn-end={(e) => e.detail.value}`
 * works there. React 18 ignores custom-event props (and writes every other
 * prop as a string attribute): listen with a ref and `addEventListener`, or
 * use the `RollingNumber` component of `rolling-number/react`. With React 19,
 * register the element before the first render so that object and function
 * values (`format`, a function `easing`/`label`) reach the properties instead
 * of being stringified into attributes.
 *
 * @example
 * ```tsx
 * import 'rolling-number/register';
 * import type {} from 'rolling-number/jsx';
 *
 * <rolling-number value={count} pad={3} max={99} overflow-suffix="+" no-interpolate />;
 * <rolling-number value={price} locale="de-DE" format={{ style: 'currency', currency: 'EUR' }}
 *   onrn-end={(e) => console.log(e.detail.value)} />; // React 19
 * ```
 *
 * @packageDocumentation
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { RollingNumberAttributes, RollingNumberElement } from './element';
import type { RollingNumberEvent } from './types';

/**
 * Event props of `<rolling-number>` in React JSX. **React 19 only**: React 19
 * attaches `on<event>` props of custom elements as native listeners (the
 * listener receives the DOM `CustomEvent`); React 18 ignores them.
 */
export interface RollingNumberJSXEvents {
  /** `rn-start` listener (React 19+): the display starts moving from rest. */
  'onrn-start'?: (event: RollingNumberEvent) => void;
  /** `rn-end` listener (React 19+): the display settled on the target. */
  'onrn-end'?: (event: RollingNumberEvent) => void;
}

/**
 * Props of `<rolling-number>` in React JSX: every HTML attribute plus the
 * typed rolling number options ({@link RollingNumberAttributes}) and the
 * React 19 event props ({@link RollingNumberJSXEvents}). `children` and
 * `dangerouslySetInnerHTML` are not allowed, because the element renders its
 * own content. The `ref` receives the {@link RollingNumberElement}.
 *
 * `inject-styles` accepts only `"true"`/`"false"` here: React 19 removes an
 * attribute bound to the boolean `false` (which would silently keep style
 * injection on), so write `inject-styles="false"`.
 *
 * Classes: write `class="…"` (React 18 and 19). `className` only works on
 * React 19; React 18 writes it as an inert `classname` attribute on custom
 * elements. The element keeps its own `rn-rolling-number` class either way.
 */
export type RollingNumberJSXProps = Omit<
  DetailedHTMLProps<HTMLAttributes<RollingNumberElement>, RollingNumberElement>,
  keyof RollingNumberAttributes | keyof RollingNumberJSXEvents | 'children' | 'dangerouslySetInnerHTML' | 'className'
> &
  Omit<RollingNumberAttributes, 'inject-styles'> & {
    /** `"false"` opts this counter out of automatic style injection (a string: React 19 drops `false` attributes). @default 'true' */
    'inject-styles'?: 'true' | 'false' | null;
    /** CSS classes (the `class` attribute). Works on React 18 and 19, unlike `className`. */
    class?: string;
    /**
     * CSS classes. **React 19 only**: React 18 writes `className` on a custom
     * element as an inert `classname` attribute; use `class` there.
     */
    className?: string;
  } & RollingNumberJSXEvents;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      /** Animated number counter custom element (`rolling-number/register`). */
      'rolling-number': RollingNumberJSXProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Animated number counter custom element (`rolling-number/register`). */
      'rolling-number': RollingNumberJSXProps;
    }
  }
}
