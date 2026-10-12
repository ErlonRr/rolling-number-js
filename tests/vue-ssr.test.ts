// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, withDirectives, type Component, type DirectiveBinding, type VNode } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { RollingNumber, vRollingNumber, type RollingNumberBinding } from '../src/vue';

async function ssr(component: Component): Promise<string> {
  const app = createSSRApp(component);
  const warnings: string[] = [];
  app.config.warnHandler = (msg) => {
    warnings.push(msg);
  };
  const html = await renderToString(app);
  expect(warnings).toEqual([]);
  return html;
}

/** Calls the directive's getSSRProps as the server renderer does (`vnode` is null for compiled templates). */
function ssrProps(value: RollingNumberBinding, vnode: VNode | null = h('span')): Record<string, unknown> | undefined {
  const binding = { value, oldValue: undefined, arg: undefined, modifiers: {}, dir: vRollingNumber, instance: null };
  return vRollingNumber.getSSRProps!(binding as unknown as DirectiveBinding<RollingNumberBinding>, vnode as VNode);
}

describe('Vue SSR', () => {
  it('renders the component as an empty span with the merged class', async () => {
    const html = await ssr(
      defineComponent({ render: () => h(RollingNumber, { value: 5, pad: 3, class: 'badge' }) })
    );
    expect(html).toBe('<span class="rn-rolling-number badge"></span>');
  });

  it('renders the directive from a render function (getSSRProps)', async () => {
    const html = await ssr(
      defineComponent({ render: () => withDirectives(h('span', { class: 'n' }), [[vRollingNumber, 42]]) })
    );
    expect(html).toBe('<span class="n" role="img" aria-label="42" data-rn-ssr></span>');
  });

  it('renders a compiled template using the component and the directive', async () => {
    const html = await ssr(
      defineComponent({
        components: { RollingNumber },
        directives: { rollingNumber: vRollingNumber },
        data: () => ({ count: 3 }),
        template: '<div><RollingNumber :value="count" class="a" /><span v-rolling-number="{ value: count, pad: 2 }"></span></div>'
      })
    );
    expect(html).toBe('<div><span class="rn-rolling-number a"></span><span role="img" aria-label="3" data-rn-ssr></span></div>');
  });
});

describe('Vue SSR: staticFallback', () => {
  it('renders the formatted value as a static child', async () => {
    const html = await ssr(
      defineComponent({ render: () => h(RollingNumber, { value: 5, pad: 3, class: 'badge', staticFallback: true }) })
    );
    expect(html).toBe('<span class="rn-rolling-number badge"><span class="rn-ssr" data-rn-ssr>005</span></span>');
  });

  it('formats with the 1.3 options and clamps like the display', async () => {
    const html = await ssr(
      defineComponent({
        render: () => [
          h(RollingNumber, {
            value: 1234.5,
            locale: 'en-US',
            format: { style: 'currency', currency: 'USD' },
            staticFallback: true
          }),
          h(RollingNumber, { value: 150, max: 99, overflowSuffix: '+', prefixText: '<', staticFallback: true })
        ]
      })
    );
    expect(html).toContain('<span class="rn-ssr" data-rn-ssr>$1,234.50</span>');
    // Text is escaped by Vue.
    expect(html).toContain('<span class="rn-ssr" data-rn-ssr>&lt;99+</span>');
  });

  it('is a kebab-case boolean attribute in compiled templates', async () => {
    const html = await ssr(
      defineComponent({
        components: { RollingNumber },
        template: '<RollingNumber :value="7" static-fallback />'
      })
    );
    expect(html).toBe('<span class="rn-rolling-number"><span class="rn-ssr" data-rn-ssr>7</span></span>');
  });

  it('renders no fallback when staticFallback is absent or false', async () => {
    const html = await ssr(
      defineComponent({ render: () => [h(RollingNumber, { value: 1 }), h(RollingNumber, { value: 2, staticFallback: false })] })
    );
    expect(html).toBe('<!--[--><span class="rn-rolling-number"></span><span class="rn-rolling-number"></span><!--]-->');
  });

  it('does not leak rn-start / rn-end listeners or staticFallback as attributes', async () => {
    const html = await ssr(
      defineComponent({
        render: () => h(RollingNumber, { value: 1, staticFallback: true, onRnStart: () => {}, onRnEnd: () => {} })
      })
    );
    expect(html).toBe('<span class="rn-rolling-number"><span class="rn-ssr" data-rn-ssr>1</span></span>');
  });
});

describe('v-rolling-number getSSRProps', () => {
  it('columns host: role, the formatted label and data-rn-ssr', () => {
    expect(ssrProps(42)).toEqual({ role: 'img', 'aria-label': '42', 'data-rn-ssr': '' });
    expect(ssrProps('7')).toEqual({ role: 'img', 'aria-label': '7', 'data-rn-ssr': '' });
    expect(ssrProps({ value: 1234.5, locale: 'en-US', format: { style: 'currency', currency: 'USD' } })).toEqual({
      role: 'img',
      'aria-label': '$1,234.50',
      'data-rn-ssr': ''
    });
    expect(ssrProps({ value: 12, prefixText: '#', label: 'Score {value}' }, h('div'))).toMatchObject({
      'aria-label': 'Score #12'
    });
  });

  it('the label keeps the unclamped value and reports the overflow', () => {
    const seen: unknown[] = [];
    const props = ssrProps({
      value: 150,
      max: 99,
      overflowSuffix: '+',
      label: (info) => {
        seen.push(info);
        return `${info.text} (${info.overflow ? 'over' : 'ok'})`;
      }
    });
    expect(props).toMatchObject({ 'aria-label': '150 (over)' });
    expect(seen).toEqual([{ text: '150', value: 150, overflow: true }]);
    expect(ssrProps({ value: 99, max: 99, label: (i) => String(i.overflow) })).toMatchObject({ 'aria-label': 'false' });
    expect(ssrProps({ value: -150, max: 99 })).toMatchObject({ 'aria-label': '-150' });
  });

  it('returns {} when the binding sets a target', () => {
    expect(ssrProps({ value: 5, target: '.n' })).toEqual({});
    // An empty selector is no target.
    expect(ssrProps({ value: 5, target: '' })).toMatchObject({ role: 'img' });
    expect(ssrProps({ value: 5, target: null })).toMatchObject({ role: 'img' });
  });

  it('returns {} for text-mode and unsupported tags', () => {
    for (const tag of ['input', 'textarea', 'option', 'select', 'img', 'svg', 'g', 'text', 'tspan', 'textPath', 'INPUT']) {
      expect(ssrProps(5, h(tag)), tag).toEqual({});
    }
    for (const tag of ['span', 'div', 'td', 'button', 'a', 'my-badge', 'foreignObject']) {
      expect(ssrProps(5, h(tag)), tag).toMatchObject({ role: 'img' });
    }
  });

  it('honors an explicit mode', () => {
    expect(ssrProps({ value: 5, mode: 'text' }, h('span'))).toEqual({});
    expect(ssrProps({ value: 5, mode: 'columns' }, h('input'))).toMatchObject({ role: 'img', 'aria-label': '5' });
    expect(ssrProps({ value: 5, mode: 'auto' }, h('input'))).toEqual({});
    // Compiled templates pass no vnode: an explicit text mode still opts out.
    expect(ssrProps({ value: 5, mode: 'text' }, null)).toEqual({});
  });

  it('returns {} for a component vnode (its root element gets the props instead)', async () => {
    const Inner = defineComponent({ render: () => h('b', { class: 'inner' }) });
    expect(ssrProps(5, h(Inner))).toEqual({});
    const html = await ssr(defineComponent({ render: () => withDirectives(h(Inner), [[vRollingNumber, 5]]) }));
    expect(html).toBe('<b class="inner" role="img" aria-label="5" data-rn-ssr></b>');
  });

  it('renders nothing on form controls and SVG text from a render function', async () => {
    const html = await ssr(
      defineComponent({
        render: () => [
          withDirectives(h('input', { type: 'text' }), [[vRollingNumber, 5]]),
          withDirectives(h('textarea'), [[vRollingNumber, 5]]),
          h('svg', [withDirectives(h('text'), [[vRollingNumber, 5]])]),
          withDirectives(h('span', [h('b', { class: 'n' })]), [[vRollingNumber, { value: 5, target: '.n' }]])
        ]
      })
    );
    expect(html).not.toContain('role=');
    expect(html).not.toContain('data-rn-ssr');
  });

  it('compiled templates honor target and explicit mode', async () => {
    const html = await ssr(
      defineComponent({
        directives: { rollingNumber: vRollingNumber },
        template:
          '<div><input v-rolling-number="{ value: 4, mode: \'text\' }"><p v-rolling-number="{ value: 4, target: \'b\' }"><b></b></p></div>'
      })
    );
    expect(html).toBe('<div><input><p><b></b></p></div>');
  });
});
