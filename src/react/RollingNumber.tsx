import React, { useRef } from 'react';
import { useRollingNumber } from './useRollingNumber';
import { RollingNumberOptions } from '../core';

export interface RollingNumberProps extends RollingNumberOptions, React.HTMLAttributes<HTMLSpanElement> {}

export const RollingNumber: React.FC<RollingNumberProps> = ({
  value = 0,
  pad = 1,
  max = null,
  className,
  style,
  ...rest
}) => {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useRollingNumber(containerRef, { value, pad, max });

  return <span ref={containerRef} className={className} style={style} {...rest} />;
};
