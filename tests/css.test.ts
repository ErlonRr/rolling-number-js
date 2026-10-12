import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Stylesheet contract (docs/design/v1.3.md §4.3, §11 WP3). `src/rolling-number.css`
 * only imports `css/defaults.css` (the `:root` defaults) and `css/rules.css`
 * (every rule, also the injected sheet), so the assertions read those two
 * files. Every 1.2 assertion is kept with the same meaning (B08, B40, B20, R2,
 * B07, I06, B29).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]): string => readFileSync(join(root, ...p), 'utf8');
const entry = read('src', 'rolling-number.css');
const defaults = read('src', 'css', 'defaults.css');
const rules = read('src', 'css', 'rules.css');
const css = defaults + '\n' + rules;

interface Block { prelude: string; body: string }

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits a stylesheet (or an at-rule body) into its top-level `prelude { body }` blocks. */
function blocks(src: string): Block[] {
  const s = stripComments(src);
  const out: Block[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    out.push({ prelude: s.slice(i, open).trim(), body: s.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

const normalize = (sel: string): string => sel.trim().replace(/\s+/g, ' ');
const selectorsOf = (b: Block): string[] => b.prelude.split(',').map(normalize);
/** Top-level style rules (at-rule blocks excluded). */
const styleRules = (src: string): Block[] => blocks(src).filter((b) => !b.prelude.startsWith('@'));
/** Inner rules of every at-rule block whose prelude matches. */
const atRules = (src: string, prelude: RegExp): Block[] =>
  blocks(src).filter((b) => b.prelude.startsWith('@') && prelude.test(b.prelude)).flatMap((b) => styleRules(b.body));

/** Merged body of every top-level rule whose selector list contains `selector` exactly. */
function ruleBody(selector: string, src: string = css): string {
  const want = normalize(selector);
  return styleRules(src)
    .filter((b) => selectorsOf(b).includes(want))
    .map((b) => b.body)
    .join(';');
}

/** Declarations of a body, in order, as [property, value] pairs. */
function decls(body: string): Array<[string, string]> {
  return stripComments(body)
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const c = d.indexOf(':');
      return [d.slice(0, c).trim(), d.slice(c + 1).trim()] as [string, string];
    });
}

describe('rolling-number.css (public styling contract)', () => {
  it('is the defaults followed by the rules', () => {
    const imports = stripComments(entry).trim().split(/;\s*/).filter(Boolean);
    expect(imports).toEqual(["@import './css/defaults.css'", "@import './css/rules.css'"]);
  });

  it('keeps every public class name and CSS variable', () => {
    for (const cls of ['.rn-rolling-number', '.rn-col', '.rn-sizer', '.rn-scale', '.rn-cell', '.rn-sign', '.rn-interpolating']) {
      expect(rules).toContain(cls);
    }
    expect(css).toMatch(/--rn-duration:\s*0\.5s/);
    expect(css).toMatch(/--rn-easing:/);
    expect(rules).toMatch(/var\(--rn-lh,\s*1\)/);
    expect(rules).toMatch(/var\(--rn-duration,\s*0\.5s\)/);
    expect(rules).toMatch(/var\(--rn-easing,\s*cubic-bezier\(0\.2,\s*1,\s*0\.3,\s*1\)\)/);
  });

  it('isolates the digits from RTL text (B08)', () => {
    const host = ruleBody('.rn-rolling-number');
    expect(host).toMatch(/direction:\s*ltr/);
    expect(host).toMatch(/unicode-bidi:\s*isolate/);
  });

  it('uses overflow: clip with a hidden fallback (B40)', () => {
    for (const sel of ['.rn-col', '.rn-col[data-rn-in]']) {
      const body = ruleBody(sel);
      expect(body.indexOf('overflow: hidden')).toBeGreaterThan(-1);
      expect(body.indexOf('overflow: clip')).toBeGreaterThan(body.indexOf('overflow: hidden'));
    }
  });

  it('honours --rn-lh for the digit window (B20)', () => {
    expect(ruleBody('.rn-rolling-number')).toMatch(/line-height:\s*var\(--rn-lh,\s*1\)/);
    expect(ruleBody('.rn-col')).toMatch(/var\(--rn-lh/);
    // the window, the sizer and every cell (wrap cell included) are calc(--rn-lh) then 1lh
    for (const sel of ['.rn-col', '.rn-sizer', '.rn-cell', '.rn-scale::after']) {
      const body = ruleBody(sel);
      expect(body).toMatch(/height:\s*calc\(var\(--rn-lh,\s*1\)\s*\*\s*1em\);\s*height:\s*1lh/);
    }
  });

  it('keeps the cells on --rn-lh without lh support and inherits only inside @supports (R2)', () => {
    const supports = atRules(rules, /^@supports\s*\(height:\s*1lh\)$/);
    expect(supports.length).toBeGreaterThan(0);
    for (const sel of ['.rn-sign', '.rn-sizer', '.rn-cell', '.rn-static', '.rn-scale::after', '.rn-col::before']) {
      const body = ruleBody(sel);
      expect(body).toMatch(/line-height:\s*var\(--rn-lh,\s*1\)/);
      expect(body).not.toMatch(/line-height:\s*inherit/);
      const inside = supports.filter((b) => selectorsOf(b).includes(sel)).map((b) => b.body).join(';');
      expect(inside).toMatch(/line-height:\s*inherit/);
    }
    expect(stripComments(rules)).toMatch(/\.rn-sign,\s*\.rn-sizer,\s*\.rn-cell\s*\{\s*line-height:\s*inherit;/);
  });

  it('disables transitions while animating, via the class and the data attribute (B07)', () => {
    for (const sel of ['.rn-interpolating .rn-scale', '[data-rn-state="animating"] .rn-scale', '.rn-interpolating .rn-sign', '[data-rn-state="animating"] .rn-sign']) {
      expect(ruleBody(sel)).toMatch(/transition:\s*none\s*!important/);
    }
  });

  it('limits will-change to the animating state (I06)', () => {
    expect(ruleBody('.rn-scale')).not.toMatch(/will-change/);
    expect(ruleBody('[data-rn-state="animating"] .rn-scale')).toMatch(/will-change:\s*transform/);
  });

  it('turns transitions off for prefers-reduced-motion (B29)', () => {
    const media = atRules(rules, /^@media\s*\(prefers-reduced-motion:\s*reduce\)$/);
    expect(media.length).toBeGreaterThan(0);
    const scale = media.filter((b) => selectorsOf(b).includes('.rn-scale'));
    expect(scale.length).toBeGreaterThan(0);
    expect(scale.map((b) => b.body).join(';')).toMatch(/transition:\s*none/);
  });
});

describe('rolling-number.css (1.3 contract, §4.3)', () => {
  it('declares :root only in defaults.css, with the two timing defaults', () => {
    expect(stripComments(rules)).not.toMatch(/:root/);
    const top = blocks(defaults);
    expect(top.map((b) => b.prelude)).toEqual([':root']);
    expect(decls(top[0].body)).toEqual([
      ['--rn-duration', '0.5s'],
      ['--rn-easing', 'cubic-bezier(0.2, 1, 0.3, 1)']
    ]);
  });

  it('has no CSS transition on the digits, the sign or anything else (only the legacy "none" hooks)', () => {
    const all = [...styleRules(rules), ...blocks(rules).filter((b) => b.prelude.startsWith('@')).flatMap((b) => styleRules(b.body))];
    for (const b of all) {
      for (const [prop, value] of decls(b.body)) {
        if (prop.startsWith('transition')) expect(value, `${b.prelude} { ${prop} }`).toMatch(/^none\s*!important$/);
        expect(prop).not.toMatch(/^animation(-name)?$/);
      }
    }
    expect(ruleBody('.rn-sign')).not.toMatch(/transition/);
    expect(ruleBody('.rn-scale')).not.toMatch(/transition/);
  });

  it('keeps the verbatim 1.2 data-digit positions', () => {
    for (let n = 0; n <= 9; n++) {
      const body = ruleBody(`.rn-col[data-digit="${n}"] > .rn-scale`);
      expect(decls(body)).toEqual([['transform', `translateY(${n === 0 ? '0' : -n * 10}%)`]]);
    }
  });

  it('lays a column out as a one-cell grid (stable width, I07)', () => {
    expect(ruleBody('.rn-col')).toMatch(/display:\s*inline-grid/);
    for (const sel of ['.rn-col::before', '.rn-sizer', '.rn-scale']) expect(ruleBody(sel)).toMatch(/grid-area:\s*1\s*\/\s*1/);
    expect(ruleBody('.rn-scale')).toMatch(/position:\s*relative/);
    expect(ruleBody('.rn-scale')).toMatch(/flex-direction:\s*column/);
    expect(ruleBody('.rn-rolling-number')).toMatch(/white-space:\s*nowrap/);
  });

  it('draws the wrap cell below the 10 cells (B19)', () => {
    const after = ruleBody('.rn-scale::after');
    expect(after).toMatch(/content:\s*"0"/);
    expect(after).toMatch(/position:\s*absolute/);
    expect(after).toMatch(/top:\s*100%/);
    expect(ruleBody('.rn-scale[data-rn-zero]::after')).toMatch(/content:\s*attr\(data-rn-zero\)/);
  });

  it('hides cell 0 and the wrap cell of leading-zero columns', () => {
    for (const sel of ['.rn-col[data-rn-lead] > .rn-scale > .rn-cell:first-child', '.rn-col[data-rn-lead] > .rn-scale::after']) {
      expect(ruleBody(sel)).toMatch(/visibility:\s*hidden/);
    }
  });

  it('sizes entering and leaving nodes with --rn-in × --rn-w', () => {
    for (const sel of ['.rn-col[data-rn-in]', '.rn-sign[data-rn-in]', '.rn-static[data-rn-in]']) {
      const body = ruleBody(sel);
      expect(body).toMatch(/width:\s*calc\(var\(--rn-in,\s*0\)\s*\*\s*var\(--rn-w,\s*0px\)\)/);
      expect(body).toMatch(/opacity:\s*var\(--rn-in,\s*0\)/);
    }
    expect(ruleBody('.rn-sign')).toMatch(/margin-right:\s*calc\(var\(--rn-in,\s*1\)\s*\*\s*0\.05em\)/);
  });

  it('exposes the timing probe on the sizer without animating it', () => {
    const sizer = ruleBody('.rn-sizer');
    expect(sizer).toMatch(/animation-duration:\s*var\(--rn-duration,\s*0\.5s\)/);
    expect(sizer).toMatch(/animation-timing-function:\s*var\(--rn-easing,\s*cubic-bezier\(0\.2,\s*1,\s*0\.3,\s*1\)\)/);
    expect(stripComments(rules)).not.toMatch(/animation-name|animation:/);
    expect(stripComments(rules)).not.toMatch(/@keyframes/);
  });

  it('paints --rn-decoration with a static decorator (C3)', () => {
    const before = ruleBody('.rn-col::before');
    expect(before).toMatch(/content:\s*"\\2060\\2007\\2060"/);
    expect(before).toMatch(/text-decoration:\s*var\(--rn-decoration,\s*none\)/);
    expect(before).toMatch(/pointer-events:\s*none/);
    expect(ruleBody('.rn-static')).toMatch(/text-decoration:\s*var\(--rn-decoration,\s*none\)/);
    expect(ruleBody('.rn-sign')).toMatch(/text-decoration:\s*var\(--rn-decoration,\s*none\)/);
  });

  it('keeps the inert --rn-fill (C1) and --rn-bleed (C2) hooks', () => {
    for (const sel of ['.rn-cell', '.rn-scale::after', '.rn-static', '.rn-sign']) {
      const body = ruleBody(sel);
      expect(body).toMatch(/background-image:\s*var\(--rn-fill,\s*none\)/);
      expect(body).toMatch(/-webkit-background-clip:\s*text/);
      expect(body).toMatch(/background-clip:\s*text/);
    }
    expect(ruleBody('.rn-col')).toMatch(/overflow-clip-margin:\s*var\(--rn-bleed,\s*0px\)/);
  });

  it('keeps an adopted SSR fallback hidden', () => {
    expect(decls(ruleBody('.rn-ssr[data-rn-ssr][hidden]'))).toEqual([['display', 'none !important']]);
  });

  it.skipIf(!existsSync(join(root, 'dist', 'style.css')))('ships the defaults and the rules in dist/style.css', () => {
    const dist = read('dist', 'style.css');
    expect(dist).not.toMatch(/@import/);
    expect(dist).toMatch(/:root\s*\{\s*--rn-duration:\s*0?\.5s/);
    for (const needle of ['.rn-rolling-number', '.rn-ssr[data-rn-ssr][hidden]', '@supports', 'prefers-reduced-motion', '--rn-fill', '--rn-bleed']) {
      expect(dist).toContain(needle);
    }
    expect(dist).toMatch(/\.rn-col::?before/);
    expect(dist).toMatch(/\.rn-col\[data-digit="?9"?\]\s*>\s*\.rn-scale/);
  });
});
