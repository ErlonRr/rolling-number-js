import React, { useRef } from 'react';
import { useRollingNumber } from './useRollingNumber';
import { RollingNumberOptions } from '../core';

export interface RollingNumberProps extends RollingNumberOptions, React.HTMLAttributes<HTMLSpanElement> {}

export const RollingNumber: React.FC<RollingNumberProps> = ({
  value = 0,
  pad = 1,
  max = null,
  interpolate = true,
  duration = 400,
  className,
  style,
  ...rest
}) => {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useRollingNumber(containerRef, { value, pad, max, interpolate, duration });

  return <span ref={containerRef} className={className} style={style} {...rest} />;
};
