import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextRenderer, resolveMode } from '../src/renderers/text';
import type { DisplayState, FrameState, Formatter, Renderer, RestState } from '../src/internal/contracts';
import { makeHost } from './helpers';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Fake formatter: recognizable strings, `-0` made visible so a leak would show. */
function fakeFormatter(tag = ''): Formatter {
  const num = (a: number): string => (Object.is(a, -0) ? '-0' : String(a));
  return {
    key: `fake${tag}`,
    plain: true,
    f: 0,
    scale: 1,
    glyphs: null,
    quantize: (v) => Math.round(v),
    maxA: (max) => (max === null ? Infinity : Math.floor(max)),
    shapeOf: () => ({ intDigits: 1, negative: false, overflow: false, zero: false }),
    shapeOfDisplay: (_d: DisplayState) => ({ intDigits: 1, negative: false, overflow: false, zero: false }),
    layout: () => ({ key: '', tokens: [] }),
    motionLayout: () => ({ tokens: [] }),
    text: (a, overflow) => `${tag}<${num(a)}${overflow ? '+' : ''}>`,
    numericText: (a) => `${num(a)}.50`,
    labelText: (v) => String(v)
  };
}

function fs(A: number, ovf = 0): FrameState {
  return {
    q: 0.5, A, ovf, sigma: 0,
    pos: new Float64Array(0), inn: new Float64Array(0), lead: new Uint8Array(0), reel: new Uint8Array(0)
  };
}

function rs(fmt: Formatter, A: number, overflow = false): RestState {
  return {
    A, overflow, layout: { key: '', tokens: [] }, glyphs: null,
    text: fmt.text(A, overflow), numericText: fmt.numericText(A)
  };
}

function svg(name: string, parent: Element = document.body): Element {
  const el = document.createElementNS(SVG_NS, name);
  parent.appendChild(el);
  return el;
}

function input(type?: string): HTMLInputElement {
  const el = makeHost('input') as HTMLInputElement;
  if (type !== undefined) el.setAttribute('type', type);
  return el;
}

/** Counts writes to an accessor property (e.g. `value`, `data`, `text`) on one object. */
function countSets(obj: object, prop: string): { count: () => number } {
  let proto: object | null = obj;
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) proto = Object.getPrototypeOf(proto);
  if (!desc || !desc.set || !desc.get) throw new Error(`no accessor ${prop}`);
  const { get, set } = desc;
  let n = 0;
  Object.defineProperty(obj, prop, {
    configurable: true,
    get() { return get.call(this); },
    set(v) { n++; set.call(this, v); }
  });
  return { count: () => n };
}

const renderers: Renderer[] = [];
function create(host: Element, fmt: Formatter = fakeFormatter()): Renderer {
  const r = createTextRenderer(host, host.ownerDocument, fmt);
  renderers.push(r);
  return r;
}

afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.replaceChildren();
});

describe('resolveMode (§6 table)', () => {
  it("honors 'columns' and 'text' on any element", () => {
    for (const el of [input('text'), input('checkbox'), makeHost('img'), makeHost('div'), svg('g'), svg('text')]) {
      expect(resolveMode(el, 'columns')).toBe('columns');
      expect(resolveMode(el, 'text')).toBe('text');
    }
  });

  it('auto: text-like and unknown input types → text', () => {
    for (const type of [undefined, '', 'text', 'search', 'tel', 'url', 'email', 'number', 'NUMBER', ' Email ', 'bogus', 'datetime']) {
      expect(resolveMode(input(type), 'auto'), String(type)).toBe('text');
    }
  });

  it('auto: other input types → unsupported', () => {
    for (const type of ['hidden', 'checkbox', 'radio', 'range', 'color', 'password', 'date', 'month', 'week', 'time',
      'datetime-local', 'file', 'image', 'submit', 'reset', 'button', 'CHECKBOX']) {
      expect(resolveMode(input(type), 'auto'), type).toBe('unsupported');
    }
  });

  it('auto: textarea and option → text', () => {
    expect(resolveMode(makeHost('textarea'), 'auto')).toBe('text');
    expect(resolveMode(document.createElement('option'), 'auto')).toBe('text');
  });

  it('auto: replaced, void and select elements → unsupported', () => {
    for (const tag of ['select', 'img', 'video', 'audio', 'canvas', 'iframe', 'br', 'hr']) {
      expect(resolveMode(makeHost(tag), 'auto'), tag).toBe('unsupported');
    }
  });

  it('auto: every other HTML element → columns', () => {
    for (const tag of ['span', 'div', 'button', 'li', 'td', 'my-badge', 'label', 'output']) {
      expect(resolveMode(makeHost(tag), 'auto'), tag).toBe('columns');
    }
  });

  it('auto: SVG text/tspan/textPath → text, foreignObject → columns, every other SVG element → unsupported', () => {
    expect(resolveMode(svg('text'), 'auto')).toBe('text');
    expect(resolveMode(svg('tspan'), 'auto')).toBe('text');
    expect(resolveMode(svg('textPath'), 'auto')).toBe('text');
    expect(resolveMode(svg('foreignObject'), 'auto')).toBe('columns');
    for (const name of ['svg', 'g', 'rect', 'a', 'circle', 'path', 'title', 'use']) {
      expect(resolveMode(svg(name), 'auto'), name).toBe('unsupported');
    }
  });

  it('compares HTML names case-insensitively and SVG names by namespace', () => {
    expect(resolveMode(document.createElementNS(HTML_NS, 'INPUT'), 'auto')).toBe('text');
    expect(resolveMode(document.createElementNS(HTML_NS, 'TextArea'), 'auto')).toBe('text');
    expect(resolveMode(document.createElementNS(HTML_NS, 'IMG'), 'auto')).toBe('unsupported');
    // An HTML element named like an SVG one is plain HTML.
    expect(resolveMode(document.createElementNS(HTML_NS, 'text'), 'auto')).toBe('columns');
    expect(resolveMode(document.createElementNS(HTML_NS, 'g'), 'auto')).toBe('columns');
  });
});

describe('text renderer: writes per host type', () => {
  it('exposes the text-mode surface: kind, no-op begin/measure, displayed() and probe() null', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    expect(r.kind).toBe('text');
    r.mount(rs(fmt, 1), false);
    r.begin({ tokens: [] }, 'count', rs(fmt, 9));
    r.measure();
    expect(el.value).toBe('<1>');
    expect(r.displayed()).toBeNull();
    expect(r.probe()).toBeNull();
  });

  it('text inputs and textarea: el.value = fmt.text(round(A), ovf >= 0.5)', () => {
    for (const el of [input(), input('text'), input('search'), input('email'), makeHost('textarea') as HTMLTextAreaElement]) {
      const fmt = fakeFormatter();
      const r = create(el, fmt);
      r.mount(rs(fmt, 5), false);
      expect(el.value).toBe('<5>');
      r.frame(fs(7.4));
      expect(el.value).toBe('<7>');
      r.frame(fs(7.6, 0.49));
      expect(el.value).toBe('<8>');
      r.frame(fs(8, 0.5));
      expect(el.value).toBe('<8+>');
      r.rest(rs(fmt, 99, true));
      expect(el.value).toBe('<99+>');
    }
  });

  it('input[type=number]: ASCII numericText per frame and at rest', () => {
    const el = input('number');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, -1234), false);
    expect(el.value).toBe('-1234.50');
    r.frame(fs(12.4, 1));
    expect(el.value).toBe('12.50');
    r.rest(rs(fmt, 3, true));
    expect(el.value).toBe('3.50');
    expect(el.value).toMatch(/^[-0-9.]+$/);
  });

  it('honors a runtime type change of the input', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.frame(fs(4));
    expect(el.value).toBe('<4>');
    el.setAttribute('type', 'number');
    r.frame(fs(5));
    expect(el.value).toBe('5.50');
  });

  it('rounds symmetrically and never shows -0', () => {
    const el = input('text');
    const r = create(el);
    r.frame(fs(2.5));
    expect(el.value).toBe('<3>');
    r.frame(fs(-2.5));
    expect(el.value).toBe('<-3>');
    r.frame(fs(-0.4));
    expect(el.value).toBe('<0>');
  });

  it('option: writes .text (the visible label), never .value', () => {
    const select = makeHost('select');
    const withValue = document.createElement('option');
    withValue.setAttribute('value', 'x');
    withValue.textContent = 'placeholder';
    const bare = document.createElement('option');
    select.append(withValue, bare);
    const fmt = fakeFormatter();
    for (const opt of [withValue, bare]) {
      const sets = countSets(opt, 'value');
      const r = create(opt, fmt);
      r.mount(rs(fmt, 1), false);
      r.frame(fs(2, 1));
      expect(opt.text).toBe('<2+>');
      r.rest(rs(fmt, 3));
      expect(opt.text).toBe('<3>');
      expect(sets.count()).toBe(0);
    }
    expect(withValue.getAttribute('value')).toBe('x');
    expect(withValue.value).toBe('x');
    expect(bare.hasAttribute('value')).toBe(false);
  });

  it('SVG text: one owned Text node replaces a text-only content and restores it on destroy', () => {
    const text = svg('text');
    const a = document.createTextNode('0');
    const b = document.createTextNode(' pts');
    text.append(a, b);
    const fmt = fakeFormatter();
    const r = create(text, fmt);
    r.mount(rs(fmt, 5), false);
    expect(text.childNodes.length).toBe(1);
    expect(text.firstChild).not.toBe(a);
    expect(text.textContent).toBe('<5>');
    r.frame(fs(6));
    expect(text.textContent).toBe('<6>');
    expect(text.childNodes.length).toBe(1);
    r.destroy();
    expect(Array.from(text.childNodes)).toEqual([a, b]);
    expect(text.textContent).toBe('0 pts');
  });

  it('a host with element children gets the Text node appended; destroy removes only it', () => {
    const text = svg('text');
    const label = document.createElementNS(SVG_NS, 'tspan');
    label.textContent = 'Score: ';
    text.appendChild(label);
    const fmt = fakeFormatter();
    const r = create(text, fmt);
    r.mount(rs(fmt, 42), false);
    expect(text.textContent).toBe('Score: <42>');
    expect(text.firstChild).toBe(label);
    r.destroy();
    expect(Array.from(text.childNodes)).toEqual([label]);
  });

  it('mode text on any element (span, empty host, tspan, textPath)', () => {
    const span = makeHost('span');
    span.textContent = 'old';
    const empty = makeHost('div');
    const fmt = fakeFormatter();
    const r1 = create(span, fmt);
    const r2 = create(empty, fmt);
    r1.mount(rs(fmt, 1), false);
    r2.mount(rs(fmt, 2), false);
    expect(span.textContent).toBe('<1>');
    expect(empty.textContent).toBe('<2>');
    r1.destroy();
    r2.destroy();
    expect(span.textContent).toBe('old');
    expect(empty.childNodes.length).toBe(0);

    const host = svg('text');
    for (const name of ['tspan', 'textPath']) {
      const el = document.createElementNS(SVG_NS, name);
      host.appendChild(el);
      const r = create(el, fmt);
      r.mount(rs(fmt, 3), false);
      expect(el.textContent).toBe('<3>');
    }
  });

  it('does not restore the saved text when the owned node was replaced by someone else', () => {
    const span = makeHost('span');
    span.textContent = 'old';
    const r = create(span);
    r.frame(fs(1));
    span.textContent = 'framework content';
    r.destroy();
    expect(span.textContent).toBe('framework content');
  });

  it('re-appends its Text node when it was removed from outside', () => {
    const span = makeHost('span');
    const r = create(span);
    r.frame(fs(1));
    const own = span.firstChild;
    span.replaceChildren('framework');
    r.frame(fs(2));
    expect(span.textContent).toBe('framework<2>');
    expect(span.lastChild).toBe(own);
  });

  it('writes only when the string changes', () => {
    const el = input('text');
    const sets = countSets(el, 'value');
    const r = create(el);
    r.frame(fs(7.2));
    r.frame(fs(7.3));
    r.frame(fs(6.9));
    expect(sets.count()).toBe(1);
    r.frame(fs(8));
    expect(sets.count()).toBe(2);

    const span = makeHost('span');
    const r2 = create(span);
    r2.frame(fs(1));
    const node = span.firstChild as Text;
    const dataSets = countSets(node, 'data');
    r2.frame(fs(1.1));
    r2.frame(fs(0.9));
    expect(dataSets.count()).toBe(0);
    r2.frame(fs(2));
    expect(dataSets.count()).toBe(1);
  });

  it('rewrites a value that was changed from outside (e.g. form.reset())', () => {
    const form = makeHost('form');
    const el = document.createElement('input');
    form.appendChild(el);
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.rest(rs(fmt, 5));
    (form as HTMLFormElement).reset();
    el.value = '';
    r.rest(rs(fmt, 5));
    expect(el.value).toBe('<5>');
  });

  it('setFormatter switches the output', () => {
    const el = input('text');
    const r = create(el, fakeFormatter('a'));
    r.frame(fs(5));
    expect(el.value).toBe('a<5>');
    r.setFormatter(fakeFormatter('b'));
    r.frame(fs(5));
    expect(el.value).toBe('b<5>');
    r.frame(fs(6, 1));
    expect(el.value).toBe('b<6+>');
  });

  it('never dispatches input/change events and never writes defaultValue', () => {
    const el = input('text');
    el.setAttribute('value', 'initial');
    const area = makeHost('textarea') as HTMLTextAreaElement;
    area.textContent = 'initial';
    for (const host of [el, area]) {
      const onInput = vi.fn();
      const onChange = vi.fn();
      host.addEventListener('input', onInput);
      host.addEventListener('change', onChange);
      const fmt = fakeFormatter();
      const r = create(host, fmt);
      r.mount(rs(fmt, 1), false);
      r.frame(fs(2));
      r.rest(rs(fmt, 3));
      host.focus();
      r.rest(rs(fmt, 4));
      host.blur();
      expect(host.value).toBe('<4>');
      r.destroy();
      expect(onInput).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(host.defaultValue).toBe('initial');
    }
    expect(el.getAttribute('value')).toBe('initial');
    expect(area.textContent).toBe('initial');
  });

  it('never touches role, aria or class', () => {
    const hosts: Element[] = [input('text'), makeHost('textarea'), makeHost('span'), svg('text')];
    for (const host of hosts) {
      const before = host.getAttributeNames().sort();
      const fmt = fakeFormatter();
      const r = create(host, fmt);
      r.mount(rs(fmt, 1), false);
      r.frame(fs(2, 1));
      r.rest(rs(fmt, 3));
      r.destroy();
      expect(host.getAttributeNames().sort()).toEqual(before);
    }
  });

  it('mount ignores adopt (no SSR fallback handling in text mode)', () => {
    const span = makeHost('span');
    const fallback = document.createElement('span');
    fallback.setAttribute('data-rn-ssr', '');
    fallback.textContent = '5';
    span.appendChild(fallback);
    const fmt = fakeFormatter();
    const r = create(span, fmt);
    r.mount(rs(fmt, 5), true);
    expect(fallback.hasAttribute('hidden')).toBe(false);
    expect(span.lastChild?.nodeType).toBe(3);
    r.destroy();
    expect(Array.from(span.childNodes)).toEqual([fallback]);
  });
});

describe('text renderer: focus', () => {
  it('canAnimate() is false on a focused form control, true otherwise', () => {
    const el = input('text');
    const area = makeHost('textarea') as HTMLTextAreaElement;
    const r = create(el);
    const ra = create(area);
    expect(r.canAnimate()).toBe(true);
    el.focus();
    expect(r.canAnimate()).toBe(false);
    expect(ra.canAnimate()).toBe(true);
    area.focus();
    expect(r.canAnimate()).toBe(true);
    expect(ra.canAnimate()).toBe(false);
    area.blur();
    expect(ra.canAnimate()).toBe(true);
  });

  it('canAnimate() is true on a focused non-control host (text mode on a focusable span)', () => {
    const span = makeHost('span');
    span.tabIndex = 0;
    const r = create(span);
    span.focus();
    expect(document.activeElement).toBe(span);
    expect(r.canAnimate()).toBe(true);
  });

  it('canAnimate() sees focus inside a shadow root', () => {
    const outer = makeHost('div');
    const root = outer.attachShadow({ mode: 'open' });
    const el = document.createElement('input');
    root.appendChild(el);
    const r = create(el);
    expect(r.canAnimate()).toBe(true);
    el.focus();
    expect(root.activeElement).toBe(el);
    expect(r.canAnimate()).toBe(false);
    el.blur();
    expect(r.canAnimate()).toBe(true);
  });

  it('canAnimate() is true for a detached control', () => {
    const el = document.createElement('input');
    expect(create(el).canAnimate()).toBe(true);
  });

  it('frame() skips a focused control', () => {
    const el = input('text');
    const r = create(el);
    r.frame(fs(1));
    el.focus();
    r.frame(fs(2));
    expect(el.value).toBe('<1>');
  });

  it('rest() on a focused control writes nothing and writes the final text on blur', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 9));
    expect(el.value).toBe('<1>');
    el.blur();
    expect(el.value).toBe('<9>');
  });

  it('a user edit wins over the deferred write', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 9));
    el.value = 'typed by the user';
    el.blur();
    expect(el.value).toBe('typed by the user');
  });

  it('a deferred mount on a focused control writes on blur only if the value is unchanged', () => {
    const a = input('text');
    a.value = 'before';
    a.focus();
    const fmt = fakeFormatter();
    const ra = create(a, fmt);
    ra.mount(rs(fmt, 3), false);
    expect(a.value).toBe('before');
    a.blur();
    expect(a.value).toBe('<3>');

    const b = input('text');
    b.focus();
    const rb = create(b, fmt);
    rb.mount(rs(fmt, 3), false);
    b.value = 'edited';
    b.blur();
    expect(b.value).toBe('edited');
  });

  it('re-arming keeps one blur listener and the latest final text', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const add = vi.spyOn(el, 'addEventListener');
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 8));
    r.rest(rs(fmt, 9));
    r.rest(rs(fmt, 10));
    expect(add.mock.calls.filter(([type]) => type === 'blur')).toHaveLength(1);
    el.blur();
    expect(el.value).toBe('<10>');
  });

  it('the blur write is one-shot', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 2));
    el.blur();
    expect(el.value).toBe('<2>');
    el.focus();
    el.value = 'edited later';
    el.blur();
    expect(el.value).toBe('edited later');
  });

  it('an unfocused write cancels a pending blur write', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 8));
    // Focus moved away without a blur reaching the listener.
    const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.body);
    r.rest(rs(fmt, 9));
    expect(el.value).toBe('<9>');
    active.mockRestore();
    el.dispatchEvent(new FocusEvent('blur'));
    expect(el.value).toBe('<9>');
  });

  it('destroy() removes the blur listener and keeps the last value', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const remove = vi.spyOn(el, 'removeEventListener');
    const r = create(el, fmt);
    r.mount(rs(fmt, 1), false);
    el.focus();
    r.rest(rs(fmt, 9));
    r.destroy();
    expect(remove.mock.calls.some(([type]) => type === 'blur')).toBe(true);
    el.blur();
    expect(el.value).toBe('<1>');
  });
});

describe('text renderer: destroy', () => {
  it('form controls keep the last value; destroy is idempotent and makes the renderer inert', () => {
    const el = input('text');
    const fmt = fakeFormatter();
    const r = create(el, fmt);
    r.mount(rs(fmt, 4), false);
    r.destroy();
    expect(el.value).toBe('<4>');
    expect(() => r.destroy()).not.toThrow();
    r.frame(fs(5));
    r.rest(rs(fmt, 6));
    r.mount(rs(fmt, 7), false);
    expect(el.value).toBe('<4>');

    const span = makeHost('span');
    span.textContent = 'x';
    const rs2 = create(span, fmt);
    rs2.mount(rs(fmt, 1), false);
    rs2.destroy();
    rs2.destroy();
    rs2.frame(fs(3));
    expect(span.textContent).toBe('x');
    expect(span.childNodes.length).toBe(1);
  });
});
