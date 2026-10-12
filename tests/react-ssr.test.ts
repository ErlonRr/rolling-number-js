// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createElement, createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { RollingNumber } from '../src/react';
import type { RollingNumberCore } from '../src/core';
import type { RollingNumberOptions } from '../src/types';

/** One valid value for every option (`Required`: a new option must be added here). */
const EVERY_OPTION: Required<RollingNumberOptions> = {
  value: 1,
  pad: 2,
  max: 99,
  interpolate: false,
  duration: 300,
  easing: 'linear',
  decimals: 0,
  locale: 'en-US',
  format: { useGrouping: false },
  prefixText: '<',
  suffixText: '>',
  overflowSuffix: '+',
  mode: 'columns',
  from: 0,
  trigger: 'visible',
  label: 'n={value}',
  live: 'polite',
  injectStyles: false
};

describe('<RollingNumber> SSR (React)', () => {
  it('renders an empty span with the merged class and no layout-effect warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(createElement(RollingNumber, { value: 5, className: 's', id: 'n' }));
    expect(html).toBe('<span id="n" class="rn-rolling-number s"></span>');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('never renders option, event, coreRef or staticFallback props as attributes', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToString(
      createElement(RollingNumber, {
        ...EVERY_OPTION,
        onRnStart: () => {},
        onRnEnd: () => {},
        coreRef: createRef<RollingNumberCore>(),
        staticFallback: false
      })
    );
    expect(html).toBe('<span class="rn-rolling-number"></span>');
    expect(error).not.toHaveBeenCalled();
  });

  it('staticFallback renders the formatted value in a .rn-ssr child', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(
      createElement(RollingNumber, {
        value: 1234.5,
        locale: 'en-US',
        format: { style: 'currency', currency: 'USD' },
        from: 0,
        className: 's',
        staticFallback: true
      })
    );
    expect(html).toBe('<span class="rn-rolling-number s"><span class="rn-ssr" data-rn-ssr="">$1,234.50</span></span>');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('staticFallback escapes the text and shows the clamped value with its affixes', () => {
    const html = renderToString(
      createElement(RollingNumber, { value: 150, max: 99, overflowSuffix: '+', prefixText: '<b>', staticFallback: true })
    );
    expect(html).toBe('<span class="rn-rolling-number"><span class="rn-ssr" data-rn-ssr="">&lt;b&gt;99+</span></span>');
  });
});
