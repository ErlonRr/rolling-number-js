import { useEffect, useLayoutEffect, useRef, MutableRefObject, RefObject } from 'react';
import { RollingNumberCore, RollingNumberOptions } from '../core';

/**
 * `useLayoutEffect` in the browser (so the counter is attached before paint),
 * `useEffect` on the server (avoids the React SSR warning; effects never run there anyway).
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof document !== 'undefined' ? useLayoutEffect : useEffect;

const OPTION_KEYS = ['value', 'pad', 'max', 'interpolate', 'duration'] as const;

type OptionsSnapshot = Pick<RollingNumberOptions, (typeof OPTION_KEYS)[number]>;

function snapshot(options: RollingNumberOptions | null | undefined): OptionsSnapshot {
  const o = options || {};
  return {
    value: o.value,
    pad: o.pad,
    max: o.max,
    interpolate: o.interpolate,
    duration: o.duration
  };
}

function optionsChanged(prev: OptionsSnapshot, next: OptionsSnapshot): boolean {
  for (const key of OPTION_KEYS) {
    // Object.is so that NaN does not count as a change on every render.
    if (!Object.is(prev[key], next[key])) return true;
  }
  return false;
}

/**
 * Attaches a RollingNumberCore to the element held by `ref`.
 *
 * The element is re-checked after every render: if it mounts late (e.g. `show && <span ref={ref} />`)
 * or is swapped for a different node, the previous core is destroyed and a new one is created on the
 * current element. Otherwise `core.update(options)` is called only when one of
 * value/pad/max/interpolate/duration changed. The core is destroyed on unmount.
 *
 * Fields left `undefined` in `options` keep their current value (same semantics as `core.update`).
 *
 * @param ref Ref to the host element (a `useRef` or `createRef` object).
 * @param options Rolling number options ({@link RollingNumberOptions}).
 * @returns A ref holding the current RollingNumberCore instance (null while no element is attached).
 *
 * @example
 * ```tsx
 * import { useRef } from 'react';
 * import { useRollingNumber } from 'rolling-number/react';
 *
 * function Price({ amount }: { amount: number }) {
 *   const ref = useRef<HTMLSpanElement>(null);
 *   const core = useRollingNumber(ref, { value: amount, pad: 4, duration: 800 });
 *   return <span ref={ref} onClick={() => core.current?.setValue(0)} />;
 * }
 * ```
 */
export function useRollingNumber(
  ref: RefObject<HTMLElement | null> | MutableRefObject<HTMLElement | null>,
  options: RollingNumberOptions
): MutableRefObject<RollingNumberCore | null> {
  const coreRef = useRef<RollingNumberCore | null>(null);
  // Element the current core was created for (the core keeps its container private).
  const elRef = useRef<HTMLElement | null>(null);
  // Options last applied to the core.
  const appliedRef = useRef<OptionsSnapshot | null>(null);

  // Runs after every render: (re)attach on element change, otherwise sync changed options.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current || null;
    const next = snapshot(options);

    if (el !== elRef.current) {
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
      elRef.current = el;
      appliedRef.current = null;
      if (el) {
        coreRef.current = new RollingNumberCore(el, next);
        appliedRef.current = next;
      }
      return;
    }

    if (coreRef.current && (!appliedRef.current || optionsChanged(appliedRef.current, next))) {
      coreRef.current.update(next);
      appliedRef.current = next;
    }
  });

  // Destroy on unmount (also runs in the StrictMode simulated unmount; the effect above re-attaches).
  useIsomorphicLayoutEffect(() => {
    return () => {
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
      elRef.current = null;
      appliedRef.current = null;
    };
  }, []);

  return coreRef;
}
