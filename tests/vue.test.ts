import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, withDirectives, type App } from 'vue';
import { RollingNumber, vRollingNumber, type RollingNumberBinding } from '../src/vue';
import { RollingNumberCore } from '../src/core';
import { digitsOf, installRaf, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;
let app: App | null = null;
let container: HTMLDivElement;

function mountApp(setup: () => () => ReturnType<typeof h>): void {
  app = createApp(defineComponent({ setup }));
  app.config.warnHandler = (msg) => {
    throw new Error(`[Vue warn] ${msg}`);
  };
  app.mount(container);
}

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
    expect(raf.requested()).toBe(0);
    expect(digitsOf(span())).toBe('9');
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
    expect(digitsOf(span())).toBe('500');
    expect(raf.requested()).toBe(0);
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
