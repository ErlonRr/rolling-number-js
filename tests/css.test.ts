import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rolling-number.css'), 'utf8');

/** Body of the first rule whose selector list contains `selector` exactly. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return match ? match[1] : '';
}

describe('rolling-number.css (public styling contract)', () => {
  it('keeps every public class name and CSS variable', () => {
    for (const cls of ['.rn-rolling-number', '.rn-col', '.rn-sizer', '.rn-scale', '.rn-cell', '.rn-sign', '.rn-interpolating']) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(/--rn-duration:\s*0\.5s/);
    expect(css).toMatch(/--rn-easing:/);
  });

  it('isolates the digits from RTL text (B08)', () => {
    const root = ruleBody('.rn-rolling-number');
    expect(root).toMatch(/direction:\s*ltr/);
    expect(root).toMatch(/unicode-bidi:\s*isolate/);
  });

  it('uses overflow: clip with a hidden fallback (B40)', () => {
    const col = ruleBody('.rn-col');
    expect(col.indexOf('overflow: hidden')).toBeGreaterThan(-1);
    expect(col.indexOf('overflow: clip')).toBeGreaterThan(col.indexOf('overflow: hidden'));
  });

  it('honours --rn-lh for the digit window (B20)', () => {
    expect(ruleBody('.rn-rolling-number')).toMatch(/line-height:\s*var\(--rn-lh,\s*1\)/);
    expect(ruleBody('.rn-col')).toMatch(/var\(--rn-lh/);
  });

  it('keeps the cells on --rn-lh without lh support and inherits only inside @supports (R2)', () => {
    for (const sel of ['.rn-sign', '.rn-sizer', '.rn-cell']) {
      const body = ruleBody(sel);
      expect(body).toMatch(/line-height:\s*var\(--rn-lh,\s*1\)/);
      expect(body).not.toMatch(/line-height:\s*inherit/);
    }
    const supports = /@supports\s*\(height:\s*1lh\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(supports).not.toBeNull();
    expect(supports![1]).toMatch(/\.rn-sign,\s*\.rn-sizer,\s*\.rn-cell\s*\{\s*line-height:\s*inherit;/);
  });

  it('disables transitions while animating, via the class and the data attribute (B07)', () => {
    expect(css).toMatch(/\.rn-interpolating \.rn-scale/);
    expect(css).toMatch(/\[data-rn-state="animating"\] \.rn-scale/);
  });

  it('limits will-change to the animating state (I06)', () => {
    expect(ruleBody('.rn-scale')).not.toMatch(/will-change/);
    expect(css).toMatch(/\[data-rn-state="animating"\] \.rn-scale\s*\{[^}]*will-change:\s*transform/);
  });

  it('turns transitions off for prefers-reduced-motion (B29)', () => {
    const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(media).not.toBeNull();
    expect(media![1]).toMatch(/\.rn-scale/);
    expect(media![1]).toMatch(/transition:\s*none/);
  });
});
