import { useEffect, useLayoutEffect, useRef, MutableRefObject, RefObject } from 'react';
import { RollingNumberCore } from '../core';
import { OPTION_KEYS } from '../options';
import type { RollingNumberUpdate } from '../types';

/**
 * `useLayoutEffect` in the browser (so the counter is attached before paint),
 * `useEffect` on the server (avoids the React SSR warning; effects never run there anyway).
 * @internal
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof document !== 'undefined' ? useLayoutEffect : useEffect;

type Snapshot = Record<string, unknown>;

/**
 * Option equality: `Object.is` (functions by identity, NaN equals NaN), plus a
 * one-level shallow compare of two objects: a `format` object or a `locale`
 * array, so a new but equal literal written inline in JSX is not a change.
 */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && Object.is((a as Snapshot)[k], (b as Snapshot)[k]));
}

/**
 * Attaches a RollingNumberCore to the element held by `ref`.
 *
 * The element is re-checked after every render: if it mounts late (e.g. `show && <span ref={ref} />`)
 * or is swapped for a different node, the previous core is destroyed and a new one is created on the
 * current element (with every option, `from` included). Otherwise `core.update()` receives only the
 * options that changed: values are compared with `Object.is`, a `format` object and a `locale` array
 * one level deep (a new but equal literal is not a change), functions (`easing`, `label`) by identity.
 * `from` is read at creation only. The core is destroyed on unmount.
 *
 * Fields left `undefined` in `options` keep their current value and `null` resets a field to its
 * default (same semantics as `core.update`).
 *
 * @param ref Ref to the host element (a `useRef` or `createRef` object): any container element,
 *   or a form control / SVG text element (text mode, see the `mode` option).
 * @param options Rolling number options ({@link RollingNumberUpdate}).
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
 *   return <span ref={ref} onClick={() => core.current?.setValue(0).then(({ completed }) => console.log(completed))} />;
 * }
 * ```
 */
export function useRollingNumber(
  ref: RefObject<Element | null> | MutableRefObject<Element | null>,
  options: RollingNumberUpdate
): MutableRefObject<RollingNumberCore | null> {
  const coreRef = useRef<RollingNumberCore | null>(null);
  // Element the current core was created for (the core keeps its container private).
  const elRef = useRef<Element | null>(null);
  // Options last applied to the core.
  const appliedRef = useRef<Snapshot>({});

  const release = (): void => {
    if (coreRef.current) {
      coreRef.current.destroy();
      coreRef.current = null;
    }
    elRef.current = null;
  };

  // Runs after every render: (re)attach on element change, otherwise sync changed options.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current || null;
    const o = (options || {}) as Snapshot;
    const next: Snapshot = {};
    const changes: Snapshot = {};
    let changed = false;
    for (const key of OPTION_KEYS) {
      next[key] = o[key];
      // `from` is creation-only.
      if (key !== 'from' && !same(appliedRef.current[key], o[key])) {
        changes[key] = o[key];
        changed = true;
      }
    }

    if (el !== elRef.current) {
      release();
      elRef.current = el;
      appliedRef.current = next;
      if (el) coreRef.current = new RollingNumberCore(el as HTMLElement | SVGElement, next);
    } else if (changed && coreRef.current) {
      appliedRef.current = next;
      coreRef.current.update(changes);
    }
  });

  // Destroy on unmount (also runs in the StrictMode simulated unmount; the effect above re-attaches).
  useIsomorphicLayoutEffect(() => release, []);

  return coreRef;
}
