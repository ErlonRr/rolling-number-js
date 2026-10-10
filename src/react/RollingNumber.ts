import { createElement, forwardRef, useCallback, useRef } from 'react';
import type { ForwardedRef, HTMLAttributes, MutableRefObject } from 'react';
import { useRollingNumber } from './useRollingNumber';
import { RN_DEFAULTS, RollingNumberOptions } from '../core';

/**
 * Props of the `<RollingNumber>` component: the rolling number options plus any `<span>` attribute.
 * `children` and `dangerouslySetInnerHTML` are not allowed, because the counter owns the span content.
 *
 * | Prop          | Type             | Default | Notes                                   |
 * |---------------|------------------|---------|-----------------------------------------|
 * | `value`       | `number`         | `0`     | displayed rounded to an integer         |
 * | `pad`         | `number`         | `1`     | min digits, zero-padded, 1..64          |
 * | `max`         | `number \| null` | `null`  | display clamp (e.g. `99`), null = none  |
 * | `interpolate` | `boolean`        | `true`  | count through the intermediate numbers  |
 * | `duration`    | `number`         | `400`   | interpolation duration in ms            |
 *
 * `className` is merged with `rn-rolling-number`; `ref` receives the `<span>`.
 */
export interface RollingNumberProps
  extends RollingNumberOptions,
    Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'> {}

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
 * Forwards its ref to the underlying `<span>`.
 *
 * Changing a prop animates/updates the counter in place; removing a prop
 * restores its default. Client component (`'use client'`): on the server it
 * renders an empty span that is filled on hydration.
 *
 * @example
 * ```tsx
 * import { RollingNumber } from 'rolling-number/react';
 * import 'rolling-number/style.css';
 *
 * function Badge({ count }: { count: number }) {
 *   return <RollingNumber value={count} pad={2} max={99} duration={600} className="badge" />;
 * }
 * ```
 */
export const RollingNumber = forwardRef<HTMLSpanElement, RollingNumberProps>(function RollingNumber(
  {
    value = RN_DEFAULTS.value,
    pad = RN_DEFAULTS.pad,
    max = RN_DEFAULTS.max,
    interpolate = RN_DEFAULTS.interpolate,
    duration = RN_DEFAULTS.duration,
    className,
    ...rest
  },
  forwardedRef
) {
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

  useRollingNumber(containerRef, { value, pad, max, interpolate, duration });

  const spanProps: Record<string, unknown> = { ...rest };
  // The counter owns the span content: drop children / innerHTML coming from untyped callers.
  delete spanProps.children;
  delete spanProps.dangerouslySetInnerHTML;
  // Set after the spread so consumer props can never override them.
  spanProps.ref = setRef;
  spanProps.className = ['rn-rolling-number', className].filter(Boolean).join(' ');

  return createElement('span', spanProps);
});

RollingNumber.displayName = 'RollingNumber';
