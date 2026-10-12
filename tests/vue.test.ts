import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  withDirectives,
  type App,
  type Component,
  type DirectiveBinding,
  type SetupContext,
  type VNode
} from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
  RollingNumber,
  vRollingNumber,
  type RollingNumberBinding,
  type RollingNumberExposed,
  type RollingNumberProps
} from '../src/vue';
import { RollingNumberCore, getResolved } from '../src/core';
import { defineRollingNumber } from '../src/element';
import { OPTION_KEYS } from '../src/options';
import type { RollingNumberEvent, RollingNumberFormat } from '../src/types';
import { digitsOf, installRaf, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;
let app: App | null = null;
let container: HTMLDivElement;

function mountApp(setup: () => () => ReturnType<typeof h> | ReturnType<typeof h>[]): void {
  app = createApp(defineComponent({ setup }));
  app.config.warnHandler = (msg) => {
    throw new Error(`[Vue warn] ${msg}`);
  };
  app.mount(container);
}

/**
 * Whether the v1.3 core (WP6) is in place: it renders `<input>` in text mode,
 * which the WP0 stub never does. Tests of the §8.3 SSR adoption (the core
 * hides a `[data-rn-ssr]` child and takes over a `data-rn-ssr` host) need it.
 */
const HAS_WP6_CORE = (() => {
  const warn = console.warn;
  const input = document.body.appendChild(document.createElement('input'));
  console.warn = () => {};
  try {
    const core = new RollingNumberCore(input);
    const mode = core.getMode();
    core.destroy();
    return mode === 'text';
  } finally {
    console.warn = warn;
    input.remove();
  }
})();

/** Renders `root` on the server and puts the HTML in `container` (as a server response would). */
async function serverRender(root: Component): Promise<string> {
  const html = await renderToString(createSSRApp(root));
  container.innerHTML = html;
  return html;
}

/** Hydrates the server HTML in `container`; returns the Vue warnings and console errors (mismatches). */
function hydrateApp(root: Component): { warnings: string[]; errors: unknown[][] } {
  const warnings: string[] = [];
  const errors: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  app = createSSRApp(root);
  app.config.warnHandler = (msg) => {
    warnings.push(msg);
  };
  app.mount(container);
  return { warnings, errors };
}

/** A directive binding as Vue passes it to the hooks. */
function bindingOf(value: RollingNumberBinding): DirectiveBinding<RollingNumberBinding> {
  return { value, oldValue: undefined, arg: undefined, modifiers: {}, dir: vRollingNumber, instance: null } as unknown as DirectiveBinding<RollingNumberBinding>;
}

/** Calls a directive hook directly (for hosts Vue does not render). */
function callHook(hook: 'mounted' | 'updated' | 'unmounted', el: Element, value: RollingNumberBinding): void {
  const fn = vRollingNumber[hook] as unknown as (el: Element, binding: DirectiveBinding, vnode: VNode, prev: VNode | null) => void;
  fn(el, bindingOf(value), h('span'), null);
}

/** The exposed API of a template ref, typed for tests. */
type Exposed = RollingNumberExposed & { $props: Record<string, unknown> };

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  app?.unmount();
  app = null;
  container.remove();
});

function span(): HTMLSpanElement {
  return container.querySelector('span')!;
}

describe('<RollingNumber> (Vue)', () => {
  it('mounts, renders the props and merges a fallthrough class', async () => {
    const cls = ref('a');
    mountApp(() => () => h(RollingNumber, { value: 42, pad: 3, class: cls.value }));
    expect(digitsOf(span())).toBe('042');
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('a')).toBe(true);

    cls.value = 'b';
    await nextTick();
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('b')).toBe(true);
    expect(span().classList.contains('a')).toBe(false);
  });

  it('forwards only the changed props to core.update()', async () => {
    const value = ref(1);
    const pad = ref(1);
    const cls = ref('x');
    mountApp(() => () => h(RollingNumber, { value: value.value, pad: pad.value, interpolate: false, class: cls.value }));
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');

    cls.value = 'y';
    await nextTick();
    expect(update).not.toHaveBeenCalled();

    value.value = 25;
    await nextTick();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ value: 25 });
    expect(digitsOf(span())).toBe('25');

    pad.value = 4;
    await nextTick();
    expect(update).toHaveBeenLastCalledWith({ pad: 4 });
    expect(digitsOf(span())).toBe('0025');
  });

  it('animates by default and keeps the class/state during a class change', async () => {
    const value = ref(0);
    const cls = ref('a');
    mountApp(() => () => h(RollingNumber, { value: value.value, class: cls.value }));
    value.value = 100;
    await nextTick();
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    raf.frame(0);
    cls.value = 'b';
    await nextTick();
    raf.frame(100);
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    raf.runAll(200);
    expect(digitsOf(span())).toBe('100');
    expect(span().hasAttribute('data-rn-state')).toBe(false);
  });

  it('treats interpolate="false" (string) as false', async () => {
    const value = ref(1);
    mountApp(() => () => h(RollingNumber, { value: value.value, interpolate: 'false' }));
    value.value = 9;
    await nextTick();
    // R-settle (§11.1): a roll, not a count: the surviving column shows the
    // target synchronously (a count would still show 1 before its first frame).
    expect(digitsOf(span())).toBe('9');
    raf.runAll();
    expect(digitsOf(span())).toBe('9');
    expect(span().hasAttribute('data-rn-state')).toBe(false);
  });

  it('keeps the props readable from a template ref (as in v1.2.1)', async () => {
    const counter = ref<{ value: number; pad: number } | null>(null);
    const value = ref(42);
    mountApp(() => () => h(RollingNumber, { ref: counter, value: value.value, pad: 3 }));
    expect(counter.value?.value).toBe(42);
    expect(counter.value?.pad).toBe(3);
    value.value = 5;
    await nextTick();
    expect(counter.value?.value).toBe(5);
  });

  it('destroys the core on unmount (also mid-animation)', async () => {
    const show = ref(true);
    const value = ref(0);
    mountApp(() => () => h('div', null, show.value ? [h(RollingNumber, { value: value.value })] : []));
    const el = span();
    value.value = 50;
    await nextTick();
    expect(raf.pending()).toBe(1);
    show.value = false;
    await nextTick();
    expect(raf.pending()).toBe(0);
    expect(el.querySelector('.rn-col')).toBeNull();
  });
});

describe('v-rolling-number (Vue directive)', () => {
  function withRn(binding: RollingNumberBinding, props: Record<string, unknown> = {}) {
    return withDirectives(h('span', props), [[vRollingNumber, binding]]);
  }

  it('accepts a number binding', async () => {
    const value = ref(5);
    mountApp(() => () => withRn(value.value));
    expect(digitsOf(span())).toBe('5');
    expect(span().getAttribute('role')).toBe('img');
    value.value = 6;
    await nextTick();
    raf.runAll();
    expect(digitsOf(span())).toBe('6');
  });

  it('accepts an object binding with every option', async () => {
    const value = ref(7);
    mountApp(() => () => withRn({ value: value.value, pad: 3, max: 500, interpolate: false, duration: 100 }));
    expect(digitsOf(span())).toBe('007');
    value.value = 900;
    await nextTick();
    // R-settle (§11.1): a roll: the target digits are set synchronously, the DOM is final at rest.
    expect(digitsOf(span())).toBe('500');
    raf.runAll();
    expect(digitsOf(span())).toBe('500');
    expect(span().hasAttribute('data-rn-state')).toBe(false);
  });

  it('does not update or re-render when a parent re-render leaves the binding unchanged', async () => {
    const title = ref('a');
    const value = ref(12);
    mountApp(() => () => withRn({ value: value.value, pad: 2 }, { title: title.value }));
    const render = vi.spyOn(RollingNumberCore.prototype, 'render');
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');

    title.value = 'b';
    await nextTick();
    expect(span().title).toBe('b');
    expect(update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    value.value = 13;
    await nextTick();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ value: 13 });
  });

  it('restores the library class when only the host class changes (B07)', async () => {
    const cls = ref('a');
    mountApp(() => () => withRn(5, { class: cls.value }));
    expect(span().className).toBe('a rn-rolling-number');
    cls.value = 'b';
    await nextTick();
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('b')).toBe(true);
    expect(span().classList.contains('a')).toBe(false);
    expect(digitsOf(span())).toBe('5');
  });

  it('keeps the library class and the animating markers when the class changes mid-animation', async () => {
    const cls = ref('a');
    const value = ref(0);
    mountApp(() => () => withRn({ value: value.value }, { class: cls.value }));
    value.value = 100;
    await nextTick();
    raf.frame(0);
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    cls.value = 'b';
    await nextTick();
    expect(span().classList.contains('rn-rolling-number')).toBe(true);
    expect(span().classList.contains('rn-interpolating')).toBe(true);
    expect(span().getAttribute('data-rn-state')).toBe('animating');
    raf.runAll(500);
    expect(digitsOf(span())).toBe('100');
    expect(span().classList.contains('rn-interpolating')).toBe(false);
  });

  it('restores the host on unmount', async () => {
    const show = ref(true);
    mountApp(() => () => h('div', null, show.value ? [withRn(31, { class: 'user' })] : []));
    const el = span();
    expect(el.classList.contains('rn-rolling-number')).toBe(true);
    show.value = false;
    await nextTick();
    expect(el.childNodes).toHaveLength(0);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.className).toBe('user');
  });
});

describe('<RollingNumber> (Vue) v1.3 props and template ref', () => {
  /** Reads every exposed option getter. */
  function exposedOptions(c: RollingNumberExposed) {
    return {
      value: c.value, pad: c.pad, max: c.max, interpolate: c.interpolate, duration: c.duration, easing: c.easing,
      decimals: c.decimals, locale: c.locale, format: c.format, prefixText: c.prefixText, suffixText: c.suffixText,
      overflowSuffix: c.overflowSuffix, mode: c.mode, from: c.from, trigger: c.trigger, label: c.label, live: c.live,
      injectStyles: c.injectStyles
    };
  }

  it('exposes every prop, with the documented values when absent', () => {
    const counter = shallowRef<Exposed | null>(null);
    mountApp(() => () => h(RollingNumber, { ref: counter }));
    const c = counter.value!;
    expect(exposedOptions(c)).toStrictEqual({
      value: 0, pad: 1, max: null, interpolate: true, duration: 400, easing: undefined, decimals: undefined,
      locale: undefined, format: undefined, prefixText: '', suffixText: '', overflowSuffix: '', mode: 'auto',
      from: null, trigger: 'immediate', label: undefined, live: 'off', injectStyles: true
    });
  });

  it('exposes props bound to null like absent ones (the exposed types are not nullable)', () => {
    const counter = shallowRef<Exposed | null>(null);
    const nulls = Object.fromEntries(OPTION_KEYS.map((key) => [key, null]));
    mountApp(() => () => h(RollingNumber, { ref: counter, ...nulls }));
    expect(exposedOptions(counter.value!)).toStrictEqual({
      value: 0, pad: 1, max: null, interpolate: true, duration: 400, easing: undefined, decimals: undefined,
      locale: undefined, format: undefined, prefixText: '', suffixText: '', overflowSuffix: '', mode: 'auto',
      from: null, trigger: 'immediate', label: undefined, live: 'off', injectStyles: true
    });
  });

  it('exposes the bound props (new props included) and follows their changes', async () => {
    const counter = shallowRef<Exposed | null>(null);
    const label = (i: { text: string }) => `n=${i.text}`;
    const format: RollingNumberFormat = { style: 'percent' };
    const suffix = ref(' pts');
    mountApp(() => () =>
      h(RollingNumber, {
        ref: counter, value: 0.5, pad: 2, max: 99, interpolate: 'false', duration: 600, easing: 'linear', decimals: 1,
        locale: ['en-US'], format, prefixText: '~', suffixText: suffix.value, overflowSuffix: '+', mode: 'columns',
        from: 0, trigger: 'immediate', label, live: 'polite', injectStyles: false
      })
    );
    expect(exposedOptions(counter.value!)).toStrictEqual({
      value: 0.5, pad: 2, max: 99, interpolate: false, duration: 600, easing: 'linear', decimals: 1,
      locale: ['en-US'], format, prefixText: '~', suffixText: ' pts', overflowSuffix: '+', mode: 'columns',
      from: 0, trigger: 'immediate', label, live: 'polite', injectStyles: false
    });
    suffix.value = ' km';
    await nextTick();
    expect(counter.value!.suffixText).toBe(' km');
  });

  it('exposes the core, the element and the imperative methods', async () => {
    const counter = shallowRef<Exposed | null>(null);
    mountApp(() => () => h(RollingNumber, { ref: counter, value: 1 }));
    const c = counter.value!;
    expect(c.el).toBe(span());
    expect(c.core).toBeInstanceOf(RollingNumberCore);
    expect(c.core!.getHost()).toBe(span());

    await expect(c.setValue(7, { motion: 'none' })).resolves.toEqual({ value: 7, completed: true });
    expect(digitsOf(span())).toBe('7');
    expect(c.getDisplayValue()).toBe(7);
    await expect(c.whenSettled()).resolves.toEqual({ value: 7, completed: true });

    const done = c.setValue(100);
    const settled = c.whenSettled();
    raf.frame(0);
    raf.frame(200);
    const mid = c.getDisplayValue();
    expect(mid).toBeGreaterThan(7);
    expect(mid).toBeLessThan(100);
    c.finish();
    await expect(done).resolves.toEqual({ value: 100, completed: true });
    await expect(settled).resolves.toEqual({ value: 100, completed: true });
    expect(digitsOf(span())).toBe('100');
    expect(c.getDisplayValue()).toBe(100);
    expect(raf.pending()).toBe(0);

    // After unmount the methods are inert.
    app!.unmount();
    app = null;
    expect(c.core).toBeNull();
    await expect(c.setValue(5)).resolves.toEqual({ value: 5, completed: false });
    expect(() => c.finish()).not.toThrow();
  });

  it('works without expose (simulated Vue 3.0/3.1 setup context): no throw, props stay readable', async () => {
    const Inner = RollingNumber as unknown as { props: Record<string, object>; setup: (p: unknown, ctx: unknown) => () => VNode };
    const Legacy = defineComponent({
      props: Inner.props,
      setup(props, ctx: SetupContext) {
        // Vue 3.0/3.1 pass no `expose` in the setup context.
        return Inner.setup(props, { attrs: ctx.attrs, slots: ctx.slots, emit: ctx.emit });
      }
    });
    const counter = ref<Record<string, unknown> | null>(null);
    const value = ref(42);
    mountApp(() => () => h(Legacy, { ref: counter, value: value.value, pad: 3 }));
    expect(counter.value?.value).toBe(42);
    expect(counter.value?.pad).toBe(3);
    expect(counter.value?.setValue).toBeUndefined();
    expect(digitsOf(span())).toBe('042');
    value.value = 5;
    await nextTick();
    raf.runAll();
    expect(counter.value?.value).toBe(5);
    expect(digitsOf(span())).toBe('005');
  });

  it('boolean props are undefined when absent (not false); the core gets its defaults', () => {
    const counter = shallowRef<Exposed | null>(null);
    mountApp(() => () => h(RollingNumber, { ref: counter, value: 1 }));
    expect(counter.value!.$props.injectStyles).toBeUndefined();
    expect(counter.value!.$props.staticFallback).toBeUndefined();
    expect(counter.value!.injectStyles).toBe(true);
    expect(getResolved(counter.value!.core!).injectStyles).toBe(true);
  });

  it('absent duration/easing/decimals/locale/format/label reach the core as unset (null); removing a prop resets it', async () => {
    const counter = shallowRef<Exposed | null>(null);
    const duration = ref<number | undefined>(undefined);
    mountApp(() => () => h(RollingNumber, { ref: counter, value: 1, duration: duration.value }));
    const core = counter.value!.core!;
    const r = getResolved(core);
    expect([r.duration, r.easing, r.decimals, r.locale, r.format, r.label]).toEqual([null, null, null, null, null, null]);
    expect(counter.value!.duration).toBe(400);

    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    duration.value = 600;
    await nextTick();
    expect(update).toHaveBeenLastCalledWith({ duration: 600 });
    expect(getResolved(core).duration).toBe(600);
    expect(counter.value!.duration).toBe(600);

    duration.value = undefined;
    await nextTick();
    expect(update).toHaveBeenLastCalledWith({ duration: null });
    expect(getResolved(core).duration).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('forwards only changed keys: equal format literals and locale arrays are not changes', async () => {
    const tick = ref(0);
    const currency = ref('EUR');
    const fnA = (i: { text: string }) => `a ${i.text}`;
    const fnB = (i: { text: string }) => `b ${i.text}`;
    const label = ref(fnA);
    mountApp(() => () =>
      h(RollingNumber, {
        value: 5,
        class: `t${tick.value}`,
        title: `t${tick.value}`,
        locale: ['en-US', 'de'],
        format: { style: 'currency', currency: currency.value },
        label: label.value
      })
    );
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');

    tick.value++;
    await nextTick();
    expect(span().title).toBe('t1');
    expect(update).not.toHaveBeenCalled();

    currency.value = 'USD';
    await nextTick();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ format: { style: 'currency', currency: 'USD' } });

    label.value = fnB;
    await nextTick();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ label: fnB });
  });

  it('delivers rn-start / rn-end to @rn-start / @rn-end as native listeners', async () => {
    const value = ref(1);
    const starts: RollingNumberEvent[] = [];
    const ends: RollingNumberEvent[] = [];
    mountApp(() => () =>
      h(RollingNumber, { value: value.value, onRnStart: (e) => starts.push(e), onRnEnd: (e) => ends.push(e) })
    );
    expect(span().getAttributeNames().sort()).toEqual(['aria-label', 'class', 'role']);
    value.value = 3;
    await nextTick();
    raf.runAll();
    expect(starts.map((e) => e.type)).toEqual(['rn-start']);
    expect(ends.map((e) => e.type)).toEqual(['rn-end']);
    expect(ends[0].detail).toEqual({ value: 3, from: 1, animated: true });
    expect(ends[0].target).toBe(span());
  });

  it('staticFallback: one static child, created once and never patched', async () => {
    const value = ref(5);
    const cls = ref('a');
    mountApp(() => () => h(RollingNumber, { value: value.value, pad: 3, class: cls.value, staticFallback: true }));
    const fallback = span().firstElementChild!;
    expect(fallback.className).toBe('rn-ssr');
    expect(fallback.getAttribute('data-rn-ssr')).toBe('');
    expect(fallback.textContent).toBe('005');
    expect(span().querySelectorAll(':scope > .rn-ssr')).toHaveLength(1);
    expect(digitsOf(span())).toBe('005');

    // What a Vue patch could write: the vnode's attributes and text (the core owns `hidden`).
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(fallback, {
      attributes: true,
      attributeFilter: ['class', 'data-rn-ssr'],
      childList: true,
      characterData: true,
      subtree: true
    });
    cls.value = 'b';
    value.value = 7;
    await nextTick();
    raf.runAll();
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toEqual([]);
    expect(span().firstElementChild).toBe(fallback);
    // The fallback text is frozen at creation; the columns show the value.
    expect(fallback.textContent).toBe('005');
    expect(digitsOf(span())).toBe('007');
  });

  it('staticFallback is read at creation only', async () => {
    const on = ref(false);
    mountApp(() => () => h(RollingNumber, { value: 2, staticFallback: on.value }));
    on.value = true;
    await nextTick();
    expect(span().querySelector('.rn-ssr')).toBeNull();
  });

  // needs WP6: the core hides a `[data-rn-ssr]` child on mount (§8.3 adoption).
  it.skipIf(!HAS_WP6_CORE)('staticFallback is hidden by the core once mounted', () => {
    mountApp(() => () => h(RollingNumber, { value: 2, staticFallback: true }));
    const fallback = span().querySelector<HTMLElement>(':scope > .rn-ssr')!;
    expect(fallback.hidden).toBe(true);
  });

  it('staticFallback: SSR + hydration without mismatch warnings', async () => {
    const value = ref(1234);
    const Root = defineComponent({
      render: () => h(RollingNumber, { value: value.value, locale: 'en-US', staticFallback: true, class: 'x' })
    });
    const html = await serverRender(Root);
    expect(html).toBe('<span class="rn-rolling-number x"><span class="rn-ssr" data-rn-ssr>1,234</span></span>');
    const host = span();
    const fallback = host.firstElementChild;

    const { warnings, errors } = hydrateApp(Root);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(span()).toBe(host);
    expect(host.firstElementChild).toBe(fallback);
    expect(host.classList.contains('rn-rolling-number')).toBe(true);
    expect(host.classList.contains('x')).toBe(true);
    expect(host.getAttribute('role')).toBe('img');
    expect(host.querySelectorAll(':scope > .rn-col').length).toBeGreaterThan(0);

    value.value = 5;
    await nextTick();
    raf.runAll();
    expect(digitsOf(host)).toBe('5');
    expect(host.firstElementChild).toBe(fallback);
  });
});

describe('v-rolling-number (Vue directive) v1.3', () => {
  it('renders into a target selector inside the host and follows target changes', async () => {
    const target = ref('.a');
    const value = ref(5);
    mountApp(() => () =>
      withDirectives(h('label', { class: 'host' }, [h('b', { class: 'a' }), h('i', { class: 'b' })]), [
        [vRollingNumber, { value: value.value, target: target.value }]
      ])
    );
    const label = container.querySelector('label')!;
    const a = label.querySelector('b')!;
    const b = label.querySelector('i')!;
    expect(label.className).toBe('host');
    expect(label.hasAttribute('role')).toBe(false);
    expect(a.classList.contains('rn-rolling-number')).toBe(true);
    expect(a.getAttribute('role')).toBe('img');
    expect(digitsOf(a)).toBe('5');

    value.value = 6;
    await nextTick();
    raf.runAll();
    expect(digitsOf(a)).toBe('6');

    target.value = '.b';
    await nextTick();
    expect(a.className).toBe('a');
    expect(a.childNodes).toHaveLength(0);
    expect(a.hasAttribute('role')).toBe(false);
    expect(digitsOf(b)).toBe('6');
    expect(b.getAttribute('aria-label')).toBe('6');

    app!.unmount();
    app = null;
    expect(b.childNodes).toHaveLength(0);
    expect(b.className).toBe('b');
  });

  it('does not replay the `from` intro when the target changes', async () => {
    const target = ref('.a');
    mountApp(() => () =>
      withDirectives(h('label', [h('b', { class: 'a' }), h('i', { class: 'b' })]), [
        [vRollingNumber, { value: 5, from: 0, target: target.value }]
      ])
    );
    const a = container.querySelector('b')!;
    const b = container.querySelector('i')!;
    expect(a.getAttribute('data-rn-state')).toBe('animating'); // the first creation plays the intro
    raf.runAll();
    expect(digitsOf(a)).toBe('5');

    target.value = '.b';
    await nextTick();
    expect(digitsOf(b)).toBe('5');
    expect(b.hasAttribute('data-rn-state')).toBe(false);
    expect(raf.pending()).toBe(0);
  });

  it('restores the library class on a target whose class Vue patches', async () => {
    const cls = ref('x');
    mountApp(() => () =>
      withDirectives(h('div', [h('b', { class: cls.value })]), [[vRollingNumber, { value: 3, target: 'b' }]])
    );
    const b = container.querySelector('b')!;
    cls.value = 'y';
    await nextTick();
    expect(b.classList.contains('y')).toBe(true);
    expect(b.classList.contains('rn-rolling-number')).toBe(true);
    expect(digitsOf(b)).toBe('3');
  });

  it('accepts a target element; a selector that matches nothing falls back to the host', () => {
    const host = document.createElement('div');
    const inner = document.createElement('span');
    host.appendChild(inner);
    container.appendChild(host);

    callHook('mounted', host, { value: 3, target: inner });
    expect(digitsOf(inner)).toBe('3');
    expect(host.hasAttribute('role')).toBe(false);
    callHook('unmounted', host, 3);
    expect(inner.childNodes).toHaveLength(0);
    expect(inner.hasAttribute('role')).toBe(false);

    callHook('mounted', host, { value: 4, target: '.missing' });
    expect(digitsOf(host)).toBe('4');
    callHook('unmounted', host, 4);
    expect(host.querySelector('.rn-col')).toBeNull();
  });

  it('skips equal format literals and locale arrays between renders', async () => {
    const tick = ref(0);
    mountApp(() => () =>
      withDirectives(h('span', { title: `t${tick.value}` }), [
        [vRollingNumber, { value: 5, locale: ['en-US'], format: { style: 'decimal', useGrouping: false } }]
      ])
    );
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    tick.value++;
    await nextTick();
    expect(span().title).toBe('t1');
    expect(update).not.toHaveBeenCalled();
  });

  it('hydrates a server-rendered host (getSSRProps) without mismatch warnings', async () => {
    const value = ref(42);
    const Root = defineComponent({
      render: () => withDirectives(h('span', { class: 'n' }), [[vRollingNumber, value.value]])
    });
    const html = await serverRender(Root);
    expect(html).toBe('<span class="n" role="img" aria-label="42" data-rn-ssr></span>');
    const { warnings, errors } = hydrateApp(Root);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(digitsOf(span())).toBe('42');
    expect(span().getAttribute('role')).toBe('img');
    expect(span().getAttribute('aria-label')).toBe('42');
    value.value = 7;
    await nextTick();
    raf.runAll();
    expect(digitsOf(span())).toBe('7');
    expect(span().getAttribute('aria-label')).toBe('7');
  });

  // needs WP6: `data-rn-ssr` on the host makes role/aria-label core-owned (§8.3 adoption).
  it.skipIf(!HAS_WP6_CORE)('the client core takes over the server role/label: no data-rn-ssr after mount, destroy() removes them', async () => {
    const show = ref(true);
    const Root = defineComponent({
      render: () => h('div', show.value ? [withDirectives(h('span', { class: 'n' }), [[vRollingNumber, 42]])] : [])
    });
    await serverRender(Root);
    const { warnings, errors } = hydrateApp(Root);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    const el = span();
    expect(el.hasAttribute('data-rn-ssr')).toBe(false);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('42');
    show.value = false;
    await nextTick();
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.className).toBe('n');
  });

  // needs WP6: text mode. Compiled SSR templates cannot tell the tag to getSSRProps,
  // so a form control may arrive with the columns markers; the directive drops them.
  it.skipIf(!HAS_WP6_CORE)('drops server columns markers from a host that ends up in text mode', () => {
    const input = document.createElement('input');
    input.setAttribute('role', 'img');
    input.setAttribute('aria-label', '5');
    input.setAttribute('data-rn-ssr', '');
    container.appendChild(input);
    callHook('mounted', input, 5);
    expect(input.hasAttribute('role')).toBe(false);
    expect(input.hasAttribute('aria-label')).toBe(false);
    expect(input.hasAttribute('data-rn-ssr')).toBe(false);
    expect(input.value).toBe('5');
    callHook('unmounted', input, 5);
  });
});

describe('<rolling-number> custom element in Vue', () => {
  it('a re-render that changes `class` keeps the library class', async () => {
    defineRollingNumber();
    const cls = ref('a');
    mountApp(() => () => h('rolling-number', { class: cls.value, value: 5 }));
    const el = container.querySelector('rolling-number')!;
    expect(el.className).toBe('a rn-rolling-number');

    cls.value = 'b';
    await nextTick();
    expect(el.className).toBe('b rn-rolling-number');
    expect(digitsOf(el)).toBe('5');
  });
});
