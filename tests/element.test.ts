import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingNumberCore } from '../src/core';
import { RollingNumberElement, defineRollingNumber } from '../src/index';
import { digitsOf, displayOf, installRaf, loose, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;
let tagCounter = 0;

/** A fresh, never-defined custom element name for each test that needs one. */
function uniqueTag(prefix = 'rn-test'): string {
  return `${prefix}-${++tagCounter}`;
}

function mount(html: string): RollingNumberElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild as RollingNumberElement;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('<rolling-number> registration', () => {
  it('is auto-registered by the root entry and typed through HTMLElementTagNameMap', () => {
    expect(customElements.get('rolling-number')).toBe(RollingNumberElement);
    const el = document.createElement('rolling-number');
    expect(el).toBeInstanceOf(RollingNumberElement);
  });

  it('defineRollingNumber() is idempotent', () => {
    expect(() => defineRollingNumber()).not.toThrow();
    expect(() => defineRollingNumber('rolling-number')).not.toThrow();
    expect(customElements.get('rolling-number')).toBe(RollingNumberElement);
  });

  it('registers additional tag names with their own subclass', () => {
    const tag = uniqueTag('my-counter');
    defineRollingNumber(tag);
    const ctor = customElements.get(tag)!;
    expect(ctor).toBeDefined();
    expect(ctor).not.toBe(RollingNumberElement);
    expect(ctor.prototype).toBeInstanceOf(RollingNumberElement);
    expect(() => defineRollingNumber(tag)).not.toThrow();

    const el = mount(`<${tag} value="12" pad="3"></${tag}>`);
    expect(el).toBeInstanceOf(RollingNumberElement);
    expect(digitsOf(el)).toBe('012');

    const third = uniqueTag('other-counter');
    defineRollingNumber(third);
    expect(customElements.get(third)).not.toBe(ctor);
  });

  it('still throws for an invalid tag name (as before)', () => {
    expect(() => defineRollingNumber('nohyphen')).toThrow();
  });
});

describe('<rolling-number> attributes', () => {
  it('renders the initial attributes', () => {
    const el = mount('<rolling-number value="42" pad="3"></rolling-number>');
    expect(digitsOf(el)).toBe('042');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('42');
    expect(el.classList.contains('rn-rolling-number')).toBe(true);
  });

  it('parses loose attribute strings through the core normalization', () => {
    const el = mount('<rolling-number value="abc" pad="x" max="" duration="nope"></rolling-number>');
    expect(digitsOf(el)).toBe('0');
    expect(el.pad).toBe(1);
    expect(el.max).toBeNull();
    expect(el.duration).toBe(400);
    expect(el.interpolate).toBe(true);
    expect(el.value).toBe(0);
  });

  it('applies max and negative values', () => {
    const el = mount('<rolling-number value="-150" max="99"></rolling-number>');
    expect(displayOf(el)).toBe('-99');
    expect(el.max).toBe(99);
    el.setAttribute('max', '');
    expect(displayOf(el)).toBe('-150');
  });

  it('interpolate="false" makes attribute changes immediate', () => {
    const el = mount('<rolling-number value="1" interpolate="false"></rolling-number>');
    expect(el.interpolate).toBe(false);
    el.setAttribute('value', '500');
    expect(digitsOf(el)).toBe('500');
    expect(raf.requested()).toBe(0);
  });

  it('animates attribute changes by default, honouring the duration attribute', () => {
    const el = mount('<rolling-number value="0" duration="1000"></rolling-number>');
    el.setAttribute('value', '100');
    expect(el.getAttribute('data-rn-state')).toBe('animating');
    raf.frame(0);
    raf.frame(500);
    expect(el.getAttribute('data-rn-state')).toBe('animating');
    raf.frame(1000);
    expect(digitsOf(el)).toBe('100');
    expect(el.hasAttribute('data-rn-state')).toBe(false);
  });

  it('a negative duration disables interpolation, on mount and on change alike', () => {
    const mounted = mount('<rolling-number value="0" duration="-1"></rolling-number>');
    expect(mounted.duration).toBe(0);
    mounted.setAttribute('value', '50');
    expect(raf.pending()).toBe(0);
    expect(digitsOf(mounted)).toBe('50');

    const changed = mount('<rolling-number value="0"></rolling-number>');
    changed.setAttribute('duration', '-2');
    expect(changed.duration).toBe(0);
    changed.setAttribute('value', '50');
    expect(raf.pending()).toBe(0);
    expect(digitsOf(changed)).toBe('50');
  });

  it('the duration getter reports the duration the core uses', () => {
    const el = mount('<rolling-number value="0" duration="1000"></rolling-number>');
    // A non-numeric attribute keeps the previous duration once connected.
    el.setAttribute('duration', 'nope');
    expect(el.duration).toBe(1000);
    el.setAttribute('value', '100');
    raf.frame(0);
    raf.frame(500);
    expect(el.getAttribute('data-rn-state')).toBe('animating');
    raf.frame(1000);
    expect(el.hasAttribute('data-rn-state')).toBe(false);
  });

  it('removing an attribute restores its default', () => {
    const el = mount('<rolling-number value="7" pad="3" interpolate="false"></rolling-number>');
    el.removeAttribute('pad');
    expect(digitsOf(el)).toBe('7');
    el.removeAttribute('value');
    expect(digitsOf(el)).toBe('0');
    el.removeAttribute('interpolate');
    expect(el.interpolate).toBe(true);
  });
});

describe('<rolling-number> properties', () => {
  it('setters reflect to attributes and drive the core exactly once per change', () => {
    const el = mount('<rolling-number interpolate="false"></rolling-number>');
    const setValue = vi.spyOn(RollingNumberCore.prototype, 'setValue');

    el.value = 5;
    expect(el.getAttribute('value')).toBe('5');
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(digitsOf(el)).toBe('5');
    expect(el.value).toBe(5);

    el.value = 5; // unchanged: no extra core call
    expect(setValue).toHaveBeenCalledTimes(1);

    el.pad = 3;
    el.max = 99;
    el.duration = 600;
    expect(el.getAttribute('pad')).toBe('3');
    expect(el.getAttribute('max')).toBe('99');
    expect(el.getAttribute('duration')).toBe('600');
    expect(el.pad).toBe(3);
    expect(el.max).toBe(99);
    expect(el.duration).toBe(600);
    expect(digitsOf(el)).toBe('005');
    expect(setValue).toHaveBeenCalledTimes(1);
  });

  it('interpolate reflects as interpolate="false" / no attribute', () => {
    const el = mount('<rolling-number></rolling-number>');
    el.interpolate = false;
    expect(el.getAttribute('interpolate')).toBe('false');
    expect(el.interpolate).toBe(false);
    el.interpolate = true;
    expect(el.hasAttribute('interpolate')).toBe(false);
    el.interpolate = loose('false');
    expect(el.getAttribute('interpolate')).toBe('false');
    el.interpolate = null;
    expect(el.hasAttribute('interpolate')).toBe(false);
    expect(el.interpolate).toBe(true);
  });

  it('null / undefined setters never throw and reset to the defaults', () => {
    const el = mount('<rolling-number value="9" pad="4" max="5" duration="10" interpolate="false"></rolling-number>');
    expect(() => {
      el.value = null;
      el.pad = undefined;
      el.max = null;
      el.duration = null;
      el.interpolate = undefined;
    }).not.toThrow();
    for (const attr of ['value', 'pad', 'max', 'duration', 'interpolate']) {
      expect(el.hasAttribute(attr)).toBe(false);
    }
    expect(el.value).toBe(0);
    expect(el.pad).toBe(1);
    expect(el.max).toBeNull();
    expect(el.duration).toBe(400);
    expect(el.interpolate).toBe(true);
    expect(digitsOf(el)).toBe('0');
  });

  it('loose property values (NaN, strings) are normalized, not thrown', () => {
    const el = mount('<rolling-number interpolate="false"></rolling-number>');
    expect(() => {
      el.value = NaN;
      el.pad = loose('3');
      el.max = loose('abc');
    }).not.toThrow();
    expect(digitsOf(el)).toBe('000');
    expect(el.max).toBeNull();
  });

  it('getters work before the element is connected', () => {
    const el = document.createElement('rolling-number');
    el.setAttribute('value', '12');
    el.setAttribute('pad', '2.7');
    expect(el.value).toBe(12);
    expect(el.pad).toBe(2);
    expect(el.max).toBeNull();
    expect(el.duration).toBe(400);
    expect(el.interpolate).toBe(true);
    expect(el.childNodes).toHaveLength(0);
  });
});

describe('<rolling-number> lifecycle', () => {
  it('re-applies properties set before the element was upgraded', () => {
    const tag = uniqueTag('rn-upgrade');
    const el = document.createElement(tag) as unknown as Record<string, unknown> & HTMLElement;
    el.value = 7;
    el.pad = 3;
    el.max = 500;
    el.interpolate = false;
    document.body.appendChild(el);
    expect(el.childNodes).toHaveLength(0); // not defined yet

    defineRollingNumber(tag);

    for (const prop of ['value', 'pad', 'max', 'interpolate']) {
      expect(Object.prototype.hasOwnProperty.call(el, prop)).toBe(false);
    }
    expect(el.getAttribute('value')).toBe('7');
    expect(el.getAttribute('pad')).toBe('3');
    expect(el.getAttribute('max')).toBe('500');
    expect(el.getAttribute('interpolate')).toBe('false');
    expect(digitsOf(el)).toBe('007');

    // The accessors are live now (no shadowing own property left behind).
    (el as unknown as RollingNumberElement).value = 9;
    expect(digitsOf(el)).toBe('009');
  });

  it('cleans up on disconnect and renders again on reconnect', () => {
    const el = mount('<rolling-number value="-25" class="user"></rolling-number>');
    el.setAttribute('value', '30'); // start an animation
    expect(raf.pending()).toBe(1);

    el.remove();
    expect(raf.pending()).toBe(0);
    expect(el.childNodes).toHaveLength(0);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.hasAttribute('data-rn-state')).toBe(false);
    expect(el.className).toBe('user');

    document.body.appendChild(el);
    expect(digitsOf(el)).toBe('30');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.querySelectorAll('.rn-col')).toHaveLength(2);
  });

  it('moving the element in the DOM does not duplicate columns', () => {
    const el = mount('<rolling-number value="123"></rolling-number>');
    const other = document.createElement('section');
    document.body.appendChild(other);
    other.appendChild(el);
    expect(el.querySelectorAll('.rn-col')).toHaveLength(3);
    expect(digitsOf(el)).toBe('123');
  });
});
