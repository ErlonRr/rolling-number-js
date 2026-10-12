// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const hasDist = existsSync(join(dist, 'rolling-number.js')) && existsSync(join(dist, 'register.js'));

describe('SSR import safety (no DOM)', () => {
  it('runs without DOM globals', () => {
    expect(typeof (globalThis as { HTMLElement?: unknown }).HTMLElement).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });

  it('src entries import without touching HTMLElement / customElements', async () => {
    const index = await import('../src/index');
    const register = await import('../src/register');
    expect(typeof index.RollingNumberCore).toBe('function');
    expect(typeof index.RollingNumberElement).toBe('function');
    expect(register.RollingNumberElement).toBe(index.RollingNumberElement);
    expect(() => index.defineRollingNumber('x-y')).not.toThrow();
  });

  it('the DOM-free entries (rolling-number/ssr and rolling-number/action) import without DOM globals', async () => {
    const ssr = await import('../src/ssr-entry');
    const action = await import('../src/action-entry');
    expect(Object.keys(ssr).sort()).toEqual(['renderStaticHTML', 'renderStaticText']);
    expect(ssr.renderStaticText({ value: 1234, locale: 'en-US', suffixText: ' pts' })).toBe('1,234 pts');
    expect(ssr.renderStaticHTML({ value: 7 }, { tag: 'span' })).toBe(
      '<span class="rn-rolling-number" role="img" aria-label="7" data-rn-ssr><span class="rn-ssr" data-rn-ssr>7</span></span>'
    );
    expect(typeof action.RollingNumberCore).toBe('function');
    expect(typeof action.rollingNumber).toBe('function');
    expect(typeof action.configureRollingNumber).toBe('function');
    expect(typeof action.injectRollingNumberStyles).toBe('function');
    // importing them defined no DOM globals and registered nothing
    for (const name of ['window', 'document', 'HTMLElement', 'customElements']) {
      expect(typeof (globalThis as Record<string, unknown>)[name], name).toBe('undefined');
    }
  });

  it('the root entry exposes the SSR helpers on the server', async () => {
    const index = await import('../src/index');
    expect(index.renderStaticText({ value: 150, max: 99, overflowSuffix: '+' })).toBe('99+');
    expect(index.renderStaticHTML({ value: 5 })).toBe('<span class="rn-ssr" data-rn-ssr>5</span>');
  });

  it('normalizeOptions works on the server', async () => {
    const { normalizeOptions } = await import('../src/core');
    expect(normalizeOptions({ pad: 3 })).toEqual({ value: 0, pad: 3, max: null, interpolate: true, duration: 400 });
  });

  it.skipIf(!hasDist)('built dist/rolling-number.js and dist/register.js load in plain Node (ESM + CJS)', () => {
    const script = `
      const esm = await import(${JSON.stringify(join(dist, 'rolling-number.js'))});
      const reg = await import(${JSON.stringify(join(dist, 'register.js'))});
      const { createRequire } = await import('node:module');
      const require = createRequire(${JSON.stringify(join(root, 'package.json'))});
      const cjs = require(${JSON.stringify(join(dist, 'rolling-number.cjs'))});
      const cjsReg = require(${JSON.stringify(join(dist, 'register.cjs'))});
      esm.defineRollingNumber('x-y');
      console.log(JSON.stringify({
        esm: typeof esm.RollingNumberCore + ',' + typeof esm.RollingNumberElement,
        reg: typeof reg.RollingNumberElement,
        cjs: typeof cjs.RollingNumberCore + ',' + typeof cjsReg.RollingNumberElement
      }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      esm: 'function,function',
      reg: 'function',
      cjs: 'function,function'
    });
  });
});
