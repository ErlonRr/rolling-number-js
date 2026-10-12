import { createElement, forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { ForwardedRef, HTMLAttributes, MutableRefObject, Ref } from 'react';
import { useIsomorphicLayoutEffect, useRollingNumber } from './useRollingNumber';
import type { RollingNumberCore } from '../core';
import { OPTION_KEYS } from '../options';
import { renderStaticText } from '../ssr';
import type { RollingNumberEvent, RollingNumberOptions } from '../types';

/**
 * Props of the `<RollingNumber>` component: every rolling number option
 * ({@link RollingNumberOptions}), any `<span>` attribute, the event props and
 * `coreRef` / `staticFallback`. `children` and `dangerouslySetInnerHTML` are
 * not allowed, because the counter owns the span content.
 *
 * | Prop             | Type             | Default | Notes                                              |
 * |------------------|------------------|---------|----------------------------------------------------|
 * | `value`          | `number`         | `0`     | target value                                       |
 * | `pad`            | `number`         | `1`     | min integer digits, zero-padded, 1..64             |
 * | `max`            | `number \| null` | `null`  | display clamp (e.g. `99`), null = none             |
 * | `interpolate`    | `boolean`        | `true`  | count through the intermediate numbers             |
 * | `duration`       | `number`         | auto    | ms; unset: 400 when counting, `--rn-duration` when rolling |
 * | `easing`, `decimals`, `locale`, `format`, `prefixText`, `suffixText`, `overflowSuffix`, `mode`, `from`, `trigger`, `label`, `live`, `injectStyles` | | | see {@link RollingNumberOptions} |
 * | `onRnStart`      | `(event) => void`| —       | `rn-start` listener (DOM `CustomEvent`)            |
 * | `onRnEnd`        | `(event) => void`| —       | `rn-end` listener (DOM `CustomEvent`)              |
 * | `coreRef`        | `Ref<RollingNumberCore \| null>` | — | receives the core                         |
 * | `staticFallback` | `boolean`        | `false` | SSR/no-JS text fallback, read at mount             |
 *
 * A prop that is absent (or `undefined`) is unset: the core uses its default,
 * and removing a prop resets it. `className` is merged with
 * `rn-rolling-number`; `ref` receives the `<span>`.
 */
export interface RollingNumberProps
  extends RollingNumberOptions,
    Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** `rn-start` listener; receives the DOM CustomEvent. */
  onRnStart?: (event: RollingNumberEvent) => void;
  /** `rn-end` listener; receives the DOM CustomEvent. */
  onRnEnd?: (event: RollingNumberEvent) => void;
  /** Receives the core (imperative `setValue(...).then`, `finish()`); `ref` stays the `<span>`. */
  coreRef?: Ref<RollingNumberCore | null>;
  /**
   * Render the formatted `value` as a static `<span class="rn-ssr" data-rn-ssr>` child for SSR/no-JS
   * (hidden once mounted). Read at mount. Pass an explicit `locale` when formatting, so the server
   * and the browser produce the same text.
   * @default false
   */
  staticFallback?: boolean;
}

/** Core events forwarded to `onRnStart` / `onRnEnd`. */
const EVENTS = ['rn-start', 'rn-end'] as const;

/**
 * Hands `value` to the consumer's ref. Returns the cleanup function a React 19
 * callback ref may return, so the merged ref can pass it back to React.
 */
function assignRef<T>(ref: ForwardedRef<T> | undefined, value: T | null): (() => void) | undefined {
  if (typeof ref === 'function') {
    const cleanup = (ref as (instance: T | null) => unknown)(value);
    return typeof cleanup === 'function' ? (cleanup as () => void) : undefined;
  }
  if (ref) {
    (ref as MutableRefObject<T | null>).current = value;
  }
  return undefined;
}

/**
 * Rolling number counter rendered as a `<span class="rn-rolling-number">`.
 * Forwards its ref to the underlying `<span>`; `coreRef` receives the
 * {@link RollingNumberCore}.
 *
 * Changing a prop animates/updates the counter in place; removing a prop
 * restores its default. Client component (`'use client'`): on the server it
 * renders an empty span that is filled on hydration, or, with
 * `staticFallback`, a span holding the formatted value as text.
 *
 * @example
 * ```tsx
 * import { useRef } from 'react';
 * import { RollingNumber } from 'rolling-number/react';
 * import type { RollingNumberCore } from 'rolling-number/react';
 *
 * function Badge({ count }: { count: number }) {
 *   const core = useRef<RollingNumberCore | null>(null);
 *   return (
 *     <RollingNumber
 *       value={count}
 *       max={99}
 *       overflowSuffix="+"
 *       className="badge"
 *       coreRef={core}
 *       onRnEnd={(e) => console.log('settled on', e.detail.value)}
 *     />
 *   );
 * }
 * ```
 */
export const RollingNumber = forwardRef<HTMLSpanElement, RollingNumberProps>(function RollingNumber(props, forwardedRef) {
  const { className, coreRef, staticFallback, ...rest } = props;
  const containerRef = useRef<HTMLSpanElement | null>(null);

  // Merged ref: stable as long as the consumer's ref is stable. When the
  // consumer's callback ref returns a cleanup (React 19), it is returned to
  // React, which then calls it on detach instead of calling the ref with null.
  // React 18 ignores the return value and still calls setRef(null).
  const setRef = useCallback(
    (node: HTMLSpanElement | null): (() => void) | undefined => {
      containerRef.current = node;
      const cleanup = assignRef(forwardedRef, node);
      if (!cleanup) return undefined;
      return () => {
        containerRef.current = null;
        cleanup();
      };
    },
    [forwardedRef]
  );

  // Options go to the hook (absent → null = unset/default, so removing a prop
  // resets it); everything else goes to the span.
  const spanProps: Record<string, unknown> = { ...rest };
  const options: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    options[key] = spanProps[key] ?? null;
    delete spanProps[key];
  }
  delete spanProps.onRnStart;
  delete spanProps.onRnEnd;
  // The counter owns the span content: drop children / innerHTML coming from untyped callers.
  delete spanProps.children;
  delete spanProps.dangerouslySetInnerHTML;

  // Latest event handlers, read by listeners attached once.
  const latest = useRef(props);
  useIsomorphicLayoutEffect(() => {
    latest.current = props;
  });
  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
    const listener = (event: Event): void => {
      const handler = event.type === EVENTS[0] ? latest.current.onRnStart : latest.current.onRnEnd;
      if (handler) handler(event as RollingNumberEvent);
    };
    EVENTS.forEach((type) => el?.addEventListener(type, listener));
    return () => EVENTS.forEach((type) => el?.removeEventListener(type, listener));
  }, []);

  const core = useRollingNumber(containerRef, options);
  // Declared after the hook: its layout effects (which create the core) run first.
  useImperativeHandle(coreRef, () => core.current, [coreRef]);

  // Static fallback child, created once: its text is frozen at mount and the
  // same element is returned on every render, so React never patches it (the
  // core hides it on mount).
  const [fallback] = useState(() =>
    staticFallback
      ? createElement(
          'span',
          { className: 'rn-ssr', 'data-rn-ssr': '', suppressHydrationWarning: true },
          renderStaticText(options as RollingNumberOptions)
        )
      : null
  );

  // Set after the spread so consumer props can never override them.
  spanProps.ref = setRef;
  spanProps.className = ['rn-rolling-number', className].filter(Boolean).join(' ');
  if (fallback) spanProps.children = fallback;

  return createElement('span', spanProps);
});

RollingNumber.displayName = 'RollingNumber';
