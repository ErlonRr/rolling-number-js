// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderStaticHTML, renderStaticText } from '../src/ssr';
import { OPTION_ATTRIBUTES } from '../src/options';
import type { RollingNumberOptions } from '../src/types';

describe('renderStaticText', () => {
  it('runs without DOM globals', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(renderStaticText()).toBe('0');
  });

  it('plain path: the 1.2 display text', () => {
    expect(renderStaticText({ value: 42 })).toBe('42');
    expect(renderStaticText({ value: -7.5 })).toBe('-8');
    expect(renderStaticText({ value: -0.4 })).toBe('0');
    expect(renderStaticText({ value: 5, pad: 3 })).toBe('005');
    expect(renderStaticText({ value: 150, max: 99 })).toBe('99');
    expect(renderStaticText({ value: NaN })).toBe('0');
    expect(renderStaticText({ value: 1e21 })).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('with affixes, overflow (clamped like getText()) and decimals; from is ignored', () => {
    expect(renderStaticText({ value: 1234, suffixText: ' pts' })).toBe('1234 pts');
    expect(renderStaticText({ value: 150, max: 99, overflowSuffix: '+', prefixText: '#' })).toBe('#99+');
    expect(renderStaticText({ value: -150, max: 99, overflowSuffix: '+' })).toBe('-99+');
    expect(renderStaticText({ value: 3.14159, decimals: 2 })).toBe('3.14');
    expect(renderStaticText({ value: 5, from: 100 })).toBe('5');
  });

  it('Intl formatting', () => {
    expect(renderStaticText({ value: 1234.5, locale: 'en-US', format: { style: 'currency', currency: 'USD' } })).toBe('$1,234.50');
    expect(renderStaticText({ value: 1234, locale: 'en-US', suffixText: ' pts' })).toBe('1,234 pts');
    expect(renderStaticText({ value: 0.25, locale: 'en-US', format: { style: 'percent' } })).toBe('25%');
    expect(renderStaticText({ value: -1234567, locale: 'fr-FR' })).toBe('-1 234 567');
  });
});

describe('renderStaticHTML', () => {
  it('default: the fallback child only', () => {
    expect(renderStaticHTML({ value: 42 })).toBe('<span class="rn-ssr" data-rn-ssr>42</span>');
    expect(renderStaticHTML()).toBe('<span class="rn-ssr" data-rn-ssr>0</span>');
    expect(renderStaticHTML({ value: 1 }, { attrs: { class: 'x', id: 'n' } })).toBe(
      '<span class="rn-ssr x" data-rn-ssr id="n">1</span>'
    );
  });

  it('any other tag: a host the core adopts (class, role, label, data-rn-ssr)', () => {
    expect(renderStaticHTML({ value: 150, max: 99, overflowSuffix: '+' }, { tag: 'span' })).toBe(
      '<span class="rn-rolling-number" role="img" aria-label="150" data-rn-ssr><span class="rn-ssr" data-rn-ssr>99+</span></span>'
    );
    expect(renderStaticHTML({ value: 1234, locale: 'en-US', label: 'Score: {value}' }, { tag: 'div', attrs: { class: 'big', 'data-x': '1' } })).toBe(
      '<div class="rn-rolling-number big" role="img" aria-label="Score: 1,234" data-rn-ssr data-x="1"><span class="rn-ssr" data-rn-ssr>1,234</span></div>'
    );
    expect(renderStaticHTML({ value: 3, label: ({ value }) => `${value} items` }, { tag: 'my-badge' })).toContain('aria-label="3 items"');
  });

  it('escapes every text and attribute value', () => {
    const evil = `"><script>alert('x')</script>&`;
    const html = renderStaticHTML({ value: 1, prefixText: evil, suffixText: '<b>' }, { tag: 'span', attrs: { title: evil } });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    const esc = '&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;';
    expect(html).toBe(
      `<span class="rn-rolling-number" role="img" aria-label="${esc}1&lt;b&gt;" data-rn-ssr title="${esc}">` +
        `<span class="rn-ssr" data-rn-ssr>${esc}1&lt;b&gt;</span></span>`
    );
    expect(renderStaticHTML({ value: 1, label: '<i>{value}</i>' }, { tag: 'span' })).toContain('aria-label="&lt;i&gt;1&lt;/i&gt;"');
    expect(renderStaticHTML({ value: 1, prefixText: '&amp;' })).toBe('<span class="rn-ssr" data-rn-ssr>&amp;amp;1</span>');
  });

  it("{ tag: 'rolling-number' }: option attributes named by OPTION_ATTRIBUTES", () => {
    expect(renderStaticHTML({ value: 5 }, { tag: 'rolling-number' })).toBe(
      '<rolling-number value="5"><span class="rn-ssr" data-rn-ssr>5</span></rolling-number>'
    );
    const options: RollingNumberOptions = {
      value: 1234.5,
      pad: 2,
      max: 9999,
      interpolate: false,
      duration: 800,
      easing: 'ease-out-expo',
      decimals: 2,
      locale: ['de-DE', 'en'],
      format: { style: 'currency', currency: 'EUR' },
      prefixText: '≈ ',
      suffixText: ' total',
      overflowSuffix: '+',
      mode: 'columns',
      from: 0,
      trigger: 'visible',
      label: 'Total {value}',
      live: 'polite',
      injectStyles: false
    };
    const html = renderStaticHTML(options, { tag: 'rolling-number' });
    const openTag = html.slice(0, html.indexOf('><span'));
    const attrs = [...openTag.matchAll(/ ([a-z-]+)="/g)].map((m) => m[1]);
    expect(attrs).toEqual([
      'value', 'pad', 'max', 'interpolate', 'duration', 'easing', 'decimals', 'locale', 'format',
      'prefix-text', 'suffix-text', 'overflow-suffix', 'mode', 'from', 'trigger', 'label', 'live', 'inject-styles'
    ]);
    expect(attrs).toEqual(Object.keys(options).map((k) => OPTION_ATTRIBUTES[k as keyof RollingNumberOptions]));
    expect(html).toContain(' interpolate="false"');
    expect(html).toContain(' inject-styles="false"');
    expect(html).toContain(' locale="de-DE,en"');
    expect(html).toContain(' format="{&quot;style&quot;:&quot;currency&quot;,&quot;currency&quot;:&quot;EUR&quot;}"');
    expect(html).toContain(' prefix-text="≈ "');
    expect(html).toMatch(/<span class="rn-ssr" data-rn-ssr>≈ 1\.234,50 € total<\/span><\/rolling-number>$/);
    // the element has no role/label: the core sets them on upgrade
    expect(html).not.toContain('role=');
  });

  it("{ tag: 'rolling-number' }: function options are skipped; attrs are added", () => {
    const html = renderStaticHTML(
      { value: 1, easing: (p) => p, label: () => 'x' },
      { tag: 'rolling-number', attrs: { class: 'n', value: '2' } }
    );
    expect(html).toBe('<rolling-number value="2" class="n"><span class="rn-ssr" data-rn-ssr>1</span></rolling-number>');
  });

  it('validates the tag and the attribute names (TypeError)', () => {
    for (const tag of ['SPAN', 'my tag', '1a', '<x>', 'a"b', '', 'span/']) {
      expect(() => renderStaticHTML({ value: 1 }, { tag }), tag).toThrow(TypeError);
    }
    for (const tag of ['input', 'img', 'textarea', 'script', 'br']) {
      expect(() => renderStaticHTML({ value: 1 }, { tag }), tag).toThrow(TypeError);
    }
    for (const name of ['a b', 'x"', 'on>', '', '=', 'a/b', "it's"]) {
      expect(() => renderStaticHTML({ value: 1 }, { tag: 'span', attrs: { [name]: '1' } }), name).toThrow(TypeError);
    }
    expect(renderStaticHTML({ value: 1 }, { tag: 'x-counter-2', attrs: { 'data-a.b:c_d': 'ok' } })).toContain(' data-a.b:c_d="ok"');
  });

  it('text-mode hosts (option, SVG text/tspan/textPath, or mode: text): the plain text, no role/label/data-rn-ssr/fallback', () => {
    expect(renderStaticHTML({ value: 42, mode: 'text' }, { tag: 'span' })).toBe('<span>42</span>');
    expect(renderStaticHTML({ value: 1234, locale: 'en-US' }, { tag: 'option', attrs: { value: '1234' } })).toBe(
      '<option value="1234">1,234</option>'
    );
    // the label is not used: text mode writes no aria-label
    expect(renderStaticHTML({ value: 150, max: 99, overflowSuffix: '+', label: 'x {value}' }, { tag: 'option' })).toBe('<option>99+</option>');
    expect(renderStaticHTML({ value: 5, suffixText: ' <pts>' }, { tag: 'text', attrs: { x: '0', y: '10' } })).toBe(
      '<text x="0" y="10">5 &lt;pts&gt;</text>'
    );
    expect(renderStaticHTML({ value: 5 }, { tag: 'tspan' })).toBe('<tspan>5</tspan>');
    expect(renderStaticHTML({ value: 5 }, { tag: 'textpath', attrs: { href: '#p' } })).toBe('<textpath href="#p">5</textpath>');
    // an explicit columns mode is honored on a text tag, as the core does
    expect(renderStaticHTML({ value: 5, mode: 'columns' }, { tag: 'option' })).toBe(
      '<option class="rn-rolling-number" role="img" aria-label="5" data-rn-ssr><span class="rn-ssr" data-rn-ssr>5</span></option>'
    );
    // <rolling-number mode="text">: option attributes, the plain text as its content
    expect(renderStaticHTML({ value: 5, mode: 'text' }, { tag: 'rolling-number' })).toBe('<rolling-number value="5" mode="text">5</rolling-number>');
    // no tag: the content of a text host (there is no fallback element to carry attrs)
    expect(renderStaticHTML({ value: 7, mode: 'text', prefixText: '<' })).toBe('&lt;7');
    expect(() => renderStaticHTML({ value: 7, mode: 'text' }, { attrs: { id: 'n' } })).toThrow(TypeError);
  });

  it('hosts that cannot carry the markup throw a TypeError, whatever the mode', () => {
    const tags = [
      'select', 'optgroup', 'svg', 'g', 'rect', 'path', 'circle', 'use', 'image', 'lineargradient', 'fegaussianblur', 'animate',
      'img', 'video', 'audio', 'canvas', 'iframe', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'math',
      'keygen', 'param', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'source', 'script', 'title', 'template'
    ];
    for (const tag of tags) {
      for (const mode of ['auto', 'columns', 'text'] as const) {
        expect(() => renderStaticHTML({ value: 1, mode }, { tag }), `${tag} ${mode}`).toThrow(TypeError);
      }
    }
    // form controls: the value is the caller's to render
    for (const tag of ['input', 'textarea']) {
      expect(() => renderStaticHTML({ value: 1 }, { tag }), tag).toThrow(/renderStaticText/);
    }
    // containers stay columns hosts: SVG foreignObject (HTML inside), a (HTML or SVG), table cells, custom elements
    for (const tag of ['foreignobject', 'a', 'td', 'li', 'button', 'x-badge', 'fe-badge']) {
      expect(renderStaticHTML({ value: 1 }, { tag }), tag).toBe(
        `<${tag} class="rn-rolling-number" role="img" aria-label="1" data-rn-ssr><span class="rn-ssr" data-rn-ssr>1</span></${tag}>`
      );
    }
  });

  it('attrs replace generated attributes case-insensitively (class is merged)', () => {
    expect(renderStaticHTML({ value: 1 }, { tag: 'span', attrs: { 'ARIA-LABEL': 'one', CLASS: 'c' } })).toBe(
      '<span class="rn-rolling-number c" role="img" aria-label="one" data-rn-ssr><span class="rn-ssr" data-rn-ssr>1</span></span>'
    );
  });
});
