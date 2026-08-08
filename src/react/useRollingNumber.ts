import { useEffect, useRef, MutableRefObject } from 'react';
import { RollingNumberCore, RollingNumberOptions } from '../core';

export function useRollingNumber(
  ref: MutableRefObject<HTMLElement | null>,
  options: RollingNumberOptions
): MutableRefObject<RollingNumberCore | null> {
  const coreRef = useRef<RollingNumberCore | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    if (!coreRef.current) {
      coreRef.current = new RollingNumberCore(ref.current, options);
    } else {
      coreRef.current.update(options);
    }
  }, [options.value, options.pad, options.max, options.interpolate, options.duration, ref]);

  useEffect(() => {
    return () => {
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
    };
  }, []);

  return coreRef;
}
