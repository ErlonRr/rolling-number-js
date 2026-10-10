// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, withDirectives, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { RollingNumber, vRollingNumber } from '../src/vue';

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
    expect(html).toBe('<span class="n"></span>');
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
    expect(html).toBe('<div><span class="rn-rolling-number a"></span><span></span></div>');
  });
});
