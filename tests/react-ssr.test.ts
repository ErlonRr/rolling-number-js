// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RollingNumber } from '../src/react';

describe('<RollingNumber> SSR (React)', () => {
  it('renders an empty span with the merged class and no layout-effect warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(createElement(RollingNumber, { value: 5, className: 's', id: 'n' }));
    expect(html).toBe('<span id="n" class="rn-rolling-number s"></span>');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
