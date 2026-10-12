import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingNumberCore, getResolved } from '../src/core';
import { RollingNumberElement, defineRollingNumber } from '../src/index';
import { OPTION_ATTRIBUTES, RN_DEFAULTS_13 } from '../src/options';
import type { OptionKey } from '../src/internal/contracts';
import type { RollingNumberEvent, RollingNumberFormat } from '../src/types';
import { digitsOf, displayOf, installRaf, loose, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;
let tagCounter = 0;

/** The element's live core (private field, read for white-box assertions). */
function coreOf(el: Element): RollingNumberCore {
  const core = (el as unknown as { core: RollingNumberCore | null }).core;
  if (!core) throw new Error('element has no core (not connected)');
  return core;
}

/**
 * R-settle (docs/design/v1.3.md §11.1): runs every queued frame, then waits
 * for the element to settle. Rolls are instant with the WP0 core and
 * JS-driven with the WP6 core; the DOM is final after this in both cases.
 */
async function settle(el: RollingNumberElement): Promise<void> {
  raf.runAll();
  await el.whenSettled();
}

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

  // §11.1 R-settle: with interpolate="false" a change rolls (S3); the units
  // column shows its target digit synchronously, the DOM is exact at settle.
  it('interpolate="false" makes attribute changes immediate', async () => {
    const el = mount('<rolling-number value="1" interpolate="false"></rolling-number>');
    expect(el.interpolate).toBe(false);
    el.setAttribute('value', '500');
    const cols = el.querySelectorAll(':scope > .rn-col');
    expect(cols[cols.length - 1].getAttribute('data-digit')).toBe('0');
    await settle(el);
    expect(digitsOf(el)).toBe('500');
    expect(el.hasAttribute('data-rn-state')).toBe(false);
    expect(el.classList.contains('rn-interpolating')).toBe(false);
  });

  // §11.1 R-settle sibling: { motion: 'none' } keeps the original synchronous assertions.
  it('setValue(v, { motion: "none" }) applies the change synchronously without frames', () => {
    const el = mount('<rolling-number value="1" interpolate="false"></rolling-number>');
    const before = raf.requested();
    void el.setValue(500, { motion: 'none' });
    expect(digitsOf(el)).toBe('500');
    expect(raf.requested()).toBe(before);
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

  // §11.1 R-settle: duration 0 means "no counting"; the change rolls (S3).
  it('a negative duration disables interpolation, on mount and on change alike', async () => {
    const mounted = mount('<rolling-number value="0" duration="-1"></rolling-number>');
    expect(mounted.duration).toBe(0);
    mounted.setAttribute('value', '50');
    await settle(mounted);
    expect(digitsOf(mounted)).toBe('50');
    expect(mounted.hasAttribute('data-rn-state')).toBe(false);

    const changed = mount('<rolling-number value="0"></rolling-number>');
    changed.setAttribute('duration', '-2');
    expect(changed.duration).toBe(0);
    changed.setAttribute('value', '50');
    await settle(changed);
    expect(digitsOf(changed)).toBe('50');
    expect(changed.hasAttribute('data-rn-state')).toBe(false);
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
    raf.runAll(); // §11.1 R-settle (at risk): the change rolls with the WP6 core
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
    raf.runAll(); // §11.1 R-settle (at risk): the change rolls with the WP6 core
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
    raf.runAll(); // §11.1 R-settle (at risk): the value change rolls with the WP6 core
    expect(digitsOf(el)).toBe('0');
  });

  it('loose property values (NaN, strings) are normalized, not thrown', () => {
    const el = mount('<rolling-number interpolate="false"></rolling-number>');
    expect(() => {
      el.value = NaN;
      el.pad = loose('3');
      el.max = loose('abc');
    }).not.toThrow();
    raf.runAll(); // §11.1 R-settle (at risk)
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

// ── v1.3 (docs/design/v1.3.md §2.5) ───────────────────────────────────

interface OptionCase {
  key: OptionKey;
  /** Property value assigned. */
  set: unknown;
  /** Attribute text it reflects to. */
  attr: string;
  /** Normalized value read back from the getter and handed to the core. */
  read: unknown;
  /** Getter value once the property is reset to null (connected). */
  unset: unknown;
  /** Normalized core value, when it differs from `read`. */
  core?: unknown;
}

const OPTION_CASES: OptionCase[] = [
  { key: 'easing', set: 'ease-out-expo', attr: 'ease-out-expo', read: 'ease-out-expo', unset: null },
  { key: 'decimals', set: 2, attr: '2', read: 2, unset: 0 },
  { key: 'locale', set: ['de-DE', 'fr'], attr: 'de-DE,fr', read: 'de-DE,fr', unset: null, core: ['de-DE', 'fr'] },
  { key: 'format', set: { style: 'percent' }, attr: '{"style":"percent"}', read: { style: 'percent' }, unset: null },
  { key: 'prefixText', set: '≈ ', attr: '≈ ', read: '≈ ', unset: '' },
  { key: 'suffixText', set: ' pts', attr: ' pts', read: ' pts', unset: '' },
  { key: 'overflowSuffix', set: '+', attr: '+', read: '+', unset: '' },
  { key: 'mode', set: 'columns', attr: 'columns', read: 'columns', unset: 'auto' },
  { key: 'trigger', set: 'visible', attr: 'visible', read: 'visible', unset: 'immediate' },
  { key: 'label', set: '{value} points', attr: '{value} points', read: '{value} points', unset: null },
  { key: 'live', set: 'polite', attr: 'polite', read: 'polite', unset: 'off' },
  { key: 'injectStyles', set: false, attr: 'false', read: false, unset: true },
  { key: 'duration', set: 900, attr: '900', read: 900, unset: 400, core: 900 }
];

describe('<rolling-number> 1.3 attributes and properties', () => {
  it('observes every option attribute (OPTION_ATTRIBUTES) plus no-interpolate and class', () => {
    expect([...RollingNumberElement.observedAttributes].sort()).toEqual(
      [...Object.values(OPTION_ATTRIBUTES), 'no-interpolate', 'class'].sort()
    );
  });

  for (const c of OPTION_CASES) {
    const name = OPTION_ATTRIBUTES[c.key];
    it(`${c.key} ↔ ${name}: the setter reflects, the attribute drives the core`, () => {
      const el = mount('<rolling-number value="3"></rolling-number>');
      const props = el as unknown as Record<string, unknown>;
      const core = coreOf(el);

      props[c.key] = c.set;
      expect(el.getAttribute(name)).toBe(c.attr);
      expect(props[c.key]).toEqual(c.read);
      expect(getResolved(core)[c.key]).toEqual(c.core ?? c.read);

      props[c.key] = null;
      expect(el.hasAttribute(name)).toBe(false);
      expect(props[c.key]).toEqual(c.unset);
      expect(getResolved(core)[c.key]).toEqual(RN_DEFAULTS_13[c.key]);

      el.setAttribute(name, c.attr);
      expect(props[c.key]).toEqual(c.read);
      expect(getResolved(core)[c.key]).toEqual(c.core ?? c.read);
      el.removeAttribute(name);
      expect(getResolved(core)[c.key]).toEqual(RN_DEFAULTS_13[c.key]);
    });
  }

  it('from ↔ from: reflected, read back, handed to the core at creation', () => {
    const el = document.createElement('rolling-number');
    el.from = 5;
    expect(el.getAttribute('from')).toBe('5');
    expect(el.from).toBe(5);
    el.from = null;
    expect(el.hasAttribute('from')).toBe(false);
    expect(el.from).toBeNull();
    el.setAttribute('from', '12');
    el.setAttribute('value', '20');
    document.body.appendChild(el);
    expect(getResolved(coreOf(el)).from).toBe(12);
  });

  it('reads every option from the markup at creation', () => {
    const el = mount(
      '<rolling-number value="42" pad="3" max="99" duration="700" easing="linear" decimals="1" ' +
        'locale="de-DE fr" format=\'{"useGrouping":false}\' prefix-text="~" suffix-text="!" overflow-suffix="+" ' +
        'mode="columns" trigger="immediate" label="{value} pts" live="assertive" inject-styles="false" no-interpolate>' +
        '</rolling-number>'
    );
    const r = getResolved(coreOf(el));
    expect(r).toMatchObject({
      value: 42,
      pad: 3,
      max: 99,
      interpolate: false,
      duration: 700,
      easing: 'linear',
      decimals: 1,
      locale: ['de-DE', 'fr'],
      format: { useGrouping: false },
      prefixText: '~',
      suffixText: '!',
      overflowSuffix: '+',
      mode: 'columns',
      trigger: 'immediate',
      label: '{value} pts',
      live: 'assertive',
      injectStyles: false
    });
    expect(el.locale).toBe('de-DE,fr');
    expect(el.max).toBe(99);
  });

  it('absent 1.3 attributes reach the core unset (null / defaults), never 400', () => {
    const el = mount('<rolling-number value="1"></rolling-number>');
    const r = getResolved(coreOf(el));
    for (const key of ['duration', 'easing', 'decimals', 'locale', 'format', 'from', 'label'] as const) {
      expect(r[key]).toBeNull();
    }
    expect(r).toMatchObject({ prefixText: '', suffixText: '', overflowSuffix: '', mode: 'auto', trigger: 'immediate', live: 'off', injectStyles: true });
    expect(el.duration).toBe(400);
  });

  it('absent or removed duration/easing are passed as null (unset); the duration getter still reads 400', () => {
    const el = mount('<rolling-number value="1" duration="900" easing="linear"></rolling-number>');
    const core = coreOf(el);
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    expect(el.duration).toBe(900);

    el.removeAttribute('duration');
    expect(update).toHaveBeenLastCalledWith({ duration: null });
    expect(getResolved(core).duration).toBeNull();
    expect(el.duration).toBe(400);

    el.duration = 300;
    el.duration = undefined;
    expect(update).toHaveBeenLastCalledWith({ duration: null });
    expect(getResolved(core).duration).toBeNull();

    el.easing = null;
    expect(update).toHaveBeenLastCalledWith({ easing: null });
    expect(getResolved(core).easing).toBeNull();
    expect(el.easing).toBeNull();
  });

  it('the duration and decimals getters read the resolved core state', () => {
    const el = mount('<rolling-number value="1234.5" decimals="1" duration="-5"></rolling-number>');
    const core = coreOf(el);
    expect(el.duration).toBe(0);
    expect(el.duration).toBe(getResolved(core).duration ?? 400);
    expect(el.decimals).toBe(1);
    expect(el.decimals).toBe(getResolved(core).f);

    // Unset decimals with a currency format: the resolved digits (2 with the Intl formatter).
    el.format = { style: 'currency', currency: 'EUR' };
    el.decimals = null;
    expect(el.decimals).toBe(getResolved(core).f);

    // A non-numeric duration keeps the previous one once connected.
    el.duration = 250;
    el.setAttribute('duration', 'nope');
    expect(el.duration).toBe(250);
    expect(getResolved(core).duration).toBe(250);
  });

  it('getters before connection read the attributes (duration: 400 when unset, decimals: null when unset)', () => {
    const el = document.createElement('rolling-number');
    expect(el.duration).toBe(400);
    expect(el.decimals).toBeNull();
    expect(el.easing).toBeNull();
    expect(el.format).toBeNull();
    expect(el.locale).toBeNull();
    expect(el.mode).toBe('auto');
    expect(el.trigger).toBe('immediate');
    expect(el.live).toBe('off');
    expect(el.injectStyles).toBe(true);
    expect(el.prefixText).toBe('');
    el.setAttribute('duration', '250');
    el.setAttribute('decimals', '3.9');
    el.setAttribute('live', '');
    el.setAttribute('mode', 'bogus');
    expect(el.duration).toBe(250);
    expect(el.decimals).toBe(3);
    expect(el.live).toBe('polite');
    expect(el.mode).toBe('auto');
    expect(el.childNodes).toHaveLength(0);
  });

  it('max is floored to the fraction digits in use', () => {
    const el = mount('<rolling-number value="5" max="99.75"></rolling-number>');
    expect(el.max).toBe(99);
    el.decimals = 2;
    expect(el.max).toBe(99.75);
  });

  it('no-interpolate: present → interpolate false; the value "false" counts as absent', () => {
    const el = mount('<rolling-number value="1" no-interpolate></rolling-number>');
    const core = coreOf(el);
    expect(el.interpolate).toBe(false);
    expect(getResolved(core).interpolate).toBe(false);

    el.setAttribute('no-interpolate', 'false');
    expect(el.interpolate).toBe(true);
    expect(getResolved(core).interpolate).toBe(true);

    el.setAttribute('no-interpolate', '');
    expect(getResolved(core).interpolate).toBe(false);
    el.removeAttribute('no-interpolate');
    expect(el.interpolate).toBe(true);
    expect(getResolved(core).interpolate).toBe(true);

    // interpolate="false" still wins over no-interpolate="false".
    el.setAttribute('no-interpolate', 'false');
    el.setAttribute('interpolate', 'false');
    expect(getResolved(core).interpolate).toBe(false);

    // Setting the property to true clears both attributes.
    el.setAttribute('no-interpolate', 'true');
    el.interpolate = true;
    expect(el.hasAttribute('interpolate')).toBe(false);
    expect(el.hasAttribute('no-interpolate')).toBe(false);
    expect(getResolved(core).interpolate).toBe(true);

    const reactFalse = mount('<rolling-number no-interpolate="false"></rolling-number>');
    expect(reactFalse.interpolate).toBe(true);
    expect(getResolved(coreOf(reactFalse)).interpolate).toBe(true);
  });

  it('inject-styles: only "false" opts out; the property reflects false as "false"', () => {
    const el = mount('<rolling-number inject-styles=""></rolling-number>');
    const core = coreOf(el);
    expect(el.injectStyles).toBe(true);
    expect(getResolved(core).injectStyles).toBe(true);
    el.setAttribute('inject-styles', 'false');
    expect(el.injectStyles).toBe(false);
    expect(getResolved(core).injectStyles).toBe(false);
    el.injectStyles = true;
    expect(el.hasAttribute('inject-styles')).toBe(false);
    expect(getResolved(core).injectStyles).toBe(true);
    el.injectStyles = loose('false');
    expect(el.getAttribute('inject-styles')).toBe('false');
  });

  it('live: an empty attribute means polite; the property maps true to polite', () => {
    const el = mount('<rolling-number live></rolling-number>');
    expect(el.live).toBe('polite');
    expect(getResolved(coreOf(el)).live).toBe('polite');
    el.live = loose(false);
    expect(el.hasAttribute('live')).toBe(false);
    el.live = loose(true);
    expect(el.getAttribute('live')).toBe('polite');
    el.live = 'assertive';
    expect(getResolved(coreOf(el)).live).toBe('assertive');
  });

  it('format: the attribute is JSON and the property reflects JSON.stringify', () => {
    const el = mount(`<rolling-number value="0.25" format='{"style":"percent"}'></rolling-number>`);
    const core = coreOf(el);
    expect(el.format).toEqual({ style: 'percent' });
    expect(el.format).toBe(el.format); // parsed once per attribute text
    expect(getResolved(core).format).toEqual({ style: 'percent' });

    const eur: RollingNumberFormat = { style: 'currency', currency: 'EUR', currencyDisplay: 'code' };
    el.format = eur;
    expect(JSON.parse(el.getAttribute('format')!)).toEqual(eur);
    expect(getResolved(core).format).toEqual(eur);

    el.format = loose('{"style":"unit","unit":"meter"}');
    expect(getResolved(core).format).toEqual({ style: 'unit', unit: 'meter' });

    const cyclic: Record<string, unknown> = { style: 'decimal' };
    cyclic.self = cyclic;
    expect(() => {
      el.format = loose(cyclic);
    }).not.toThrow();
    expect(el.hasAttribute('format')).toBe(false);
    expect(getResolved(core).format).toBeNull();
  });

  it('format: invalid JSON (React 19 "[object Object]" before upgrade) is ignored with a single warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = mount('<rolling-number value="5" format="[object Object]"></rolling-number>');
    const core = coreOf(el);
    expect(el.format).toBeNull();
    expect(getResolved(core).format).toBeNull();
    expect(digitsOf(el)).toBe('5');

    el.setAttribute('format', '{"style":"percent"}');
    expect(getResolved(core).format).toEqual({ style: 'percent' });
    el.setAttribute('format', '{not json');
    expect(el.format).toBeNull();
    expect(getResolved(core).format).toBeNull();
    el.setAttribute('format', '[1, 2]');
    expect(el.format).toBeNull();

    const formatWarnings = warn.mock.calls.filter(([msg]) => /format/i.test(String(msg)));
    expect(formatWarnings).toHaveLength(1);
  });

  it('a function easing / label is kept in a private slot and forwarded, not reflected', () => {
    const el = mount('<rolling-number value="3" easing="linear" label="{value} pts"></rolling-number>');
    const core = coreOf(el);
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    const ease = (p: number) => p * p;
    const label = ({ text }: { text: string }) => `${text} points`;

    el.easing = ease;
    el.label = label;
    expect(el.hasAttribute('easing')).toBe(false);
    expect(el.hasAttribute('label')).toBe(false);
    expect(el.easing).toBe(ease);
    expect(el.label).toBe(label);
    expect(getResolved(core).easing).toBe(ease);
    expect(getResolved(core).label).toBe(label);

    // Assigning the same function again does nothing.
    const calls = update.mock.calls.length;
    el.easing = ease;
    expect(update.mock.calls.length).toBe(calls);

    // A function replaces another one without any attribute.
    const ease2 = (p: number) => p;
    el.easing = ease2;
    expect(getResolved(core).easing).toBe(ease2);

    // A string attribute set later replaces the function.
    el.setAttribute('easing', 'ease-in');
    expect(el.easing).toBe('ease-in');
    expect(getResolved(core).easing).toBe('ease-in');

    // null drops the function (no attribute change involved).
    el.label = null;
    expect(el.label).toBeNull();
    expect(getResolved(core).label).toBeNull();

    // A string property replaces the function and is reflected.
    el.easing = ease;
    el.easing = 'ease-out';
    expect(el.getAttribute('easing')).toBe('ease-out');
    expect(getResolved(core).easing).toBe('ease-out');
  });

  it('function options set before connection (or before upgrade) reach the core and survive reconnection', () => {
    const label = () => 'custom';
    const el = document.createElement('rolling-number');
    el.label = label;
    document.body.appendChild(el);
    expect(getResolved(coreOf(el)).label).toBe(label);
    el.remove();
    document.body.appendChild(el);
    expect(getResolved(coreOf(el)).label).toBe(label);

    const tag = uniqueTag('rn-upgrade-13');
    const early = document.createElement(tag) as unknown as Record<string, unknown> & HTMLElement;
    const ease = (p: number) => p;
    early.easing = ease;
    early.format = { style: 'percent' };
    early.prefixText = '$';
    early.injectStyles = false;
    document.body.appendChild(early);
    defineRollingNumber(tag);
    for (const prop of ['easing', 'format', 'prefixText', 'injectStyles']) {
      expect(Object.prototype.hasOwnProperty.call(early, prop)).toBe(false);
    }
    expect(early.getAttribute('format')).toBe('{"style":"percent"}');
    expect(early.getAttribute('prefix-text')).toBe('$');
    expect(early.getAttribute('inject-styles')).toBe('false');
    const r = getResolved(coreOf(early));
    expect(r.easing).toBe(ease);
    expect(r.format).toEqual({ style: 'percent' });
    expect(r.prefixText).toBe('$');
    expect(r.injectStyles).toBe(false);
  });
});

describe('<rolling-number> methods', () => {
  it('setValue(v, o) stashes o for the value attribute change and returns the core promise', async () => {
    const el = mount('<rolling-number value="1"></rolling-number>');
    const setValue = vi.spyOn(RollingNumberCore.prototype, 'setValue');
    const promise = el.setValue(42, { motion: 'none' });
    expect(el.getAttribute('value')).toBe('42');
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue.mock.calls[0][1]).toEqual({ motion: 'none' });
    expect(promise).toBe(setValue.mock.results[0].value);
    expect(digitsOf(el)).toBe('42');
    await expect(promise).resolves.toEqual({ value: 42, completed: true });
  });

  it('setValue() with the current value string calls the core directly and leaves no stash behind', async () => {
    const el = mount('<rolling-number value="7"></rolling-number>');
    const setValue = vi.spyOn(RollingNumberCore.prototype, 'setValue');
    const promise = el.setValue(7, { motion: 'roll' });
    expect(promise).toBeInstanceOf(Promise);
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenLastCalledWith(7, { motion: 'roll' });
    await expect(promise).resolves.toEqual({ value: 7, completed: true });

    // The next, unrelated attribute change does not reuse the options.
    el.setAttribute('value', '8');
    expect(setValue).toHaveBeenCalledTimes(2);
    expect(setValue.mock.calls[1]).toEqual(['8']);
    await settle(el);
    expect(digitsOf(el)).toBe('8');
  });

  it('setValue() resolves completed: false when superseded, true when settled', async () => {
    const el = mount('<rolling-number value="0"></rolling-number>');
    const first = el.setValue(100);
    const second = el.setValue(200);
    raf.runAll();
    await expect(first).resolves.toEqual({ value: 100, completed: false });
    await expect(second).resolves.toEqual({ value: 200, completed: true });
    expect(digitsOf(el)).toBe('200');
    expect(el.value).toBe(200);
  });

  it('a disconnected element resolves completed: false (and still reflects the value)', async () => {
    const el = document.createElement('rolling-number');
    await expect(el.setValue(5)).resolves.toEqual({ value: 5, completed: false });
    expect(el.getAttribute('value')).toBe('5');
    await expect(el.whenSettled()).resolves.toEqual({ value: 5, completed: false });
    expect(el.getDisplayValue()).toBe(5);
    expect(() => el.finish()).not.toThrow();

    const mounted = mount('<rolling-number value="1"></rolling-number>');
    mounted.remove();
    await expect(mounted.setValue(loose('3.0'))).resolves.toEqual({ value: 3, completed: false });
    document.body.appendChild(mounted);
    expect(digitsOf(mounted)).toBe('3');
  });

  it('whenSettled(), finish() and getDisplayValue() delegate to the core', async () => {
    const el = mount('<rolling-number value="0" duration="1000"></rolling-number>');
    await expect(el.whenSettled()).resolves.toEqual({ value: 0, completed: true });
    el.setAttribute('value', '100');
    raf.frame(0);
    raf.frame(500);
    const mid = el.getDisplayValue();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(mid).toBe(coreOf(el).getDisplayValue());

    const settled = el.whenSettled();
    el.finish();
    await expect(settled).resolves.toEqual({ value: 100, completed: true });
    expect(digitsOf(el)).toBe('100');
    expect(el.hasAttribute('data-rn-state')).toBe(false);
    expect(el.getDisplayValue()).toBe(100);
    expect(raf.pending()).toBe(0);
  });
});

describe('<rolling-number> events and reconnection', () => {
  it('dispatches rn-start / rn-end on the element; they bubble out of it', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    const seen: Array<[string, EventTarget | null, number, boolean]> = [];
    const record = (e: Event) => {
      const ev = e as RollingNumberEvent;
      seen.push([ev.type, ev.target, ev.detail.value, ev.bubbles && ev.composed]);
    };
    wrapper.addEventListener('rn-start', record);
    wrapper.addEventListener('rn-end', record);

    const el = document.createElement('rolling-number');
    el.value = 1;
    wrapper.appendChild(el);
    await Promise.resolve();
    expect(seen).toEqual([]); // the initial render dispatches nothing

    const animated = el.setValue(20);
    raf.runAll();
    await animated;
    expect(seen).toEqual([
      ['rn-start', el, 20, true],
      ['rn-end', el, 20, true]
    ]);

    await el.setValue(5, { motion: 'none' }); // instant: dispatched in a microtask
    expect(seen.slice(2)).toEqual([
      ['rn-start', el, 5, true],
      ['rn-end', el, 5, true]
    ]);
  });

  it('uses `from` on the first connection only: reconnecting never replays the intro', async () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    let starts = 0;
    wrapper.addEventListener('rn-start', () => starts++);

    const el = document.createElement('rolling-number');
    el.from = 0;
    el.value = 50;
    wrapper.appendChild(el);
    expect(getResolved(coreOf(el)).from).toBe(0);
    await settle(el);
    expect(digitsOf(el)).toBe('50');
    const startsAfterIntro = starts;

    el.remove();
    wrapper.appendChild(el);
    expect(el.from).toBe(0); // the attribute is kept…
    expect(getResolved(coreOf(el)).from).toBeNull(); // …but not used again
    expect(digitsOf(el)).toBe('50');
    await settle(el);
    expect(starts).toBe(startsAfterIntro);
    expect(raf.pending()).toBe(0);

    // A move in the DOM is a reconnection too.
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(el);
    expect(getResolved(coreOf(el)).from).toBeNull();
    expect(digitsOf(el)).toBe('50');
  });
});

describe('<rolling-number> class attribute written by a framework', () => {
  it('a replaced class attribute (React 18 `class`, Vue `:class`) keeps rn-rolling-number', () => {
    const el = mount('<rolling-number value="5" class="a"></rolling-number>');
    expect(el.className).toBe('a rn-rolling-number');

    el.setAttribute('class', 'b'); // React 18: setAttribute('class', …)
    expect(el.className).toBe('b rn-rolling-number');
    el.className = 'c'; // Vue: el.className = …
    expect(el.className).toBe('c rn-rolling-number');
    el.removeAttribute('class');
    expect(el.className).toBe('rn-rolling-number');
    expect(digitsOf(el)).toBe('5');
  });

  it('re-renders once per clobbered class (no loop), and not at all when the class is kept', () => {
    const el = mount('<rolling-number value="5"></rolling-number>');
    const render = vi.spyOn(coreOf(el), 'render');
    el.className = 'b';
    expect(render).toHaveBeenCalledTimes(1);
    el.classList.add('c'); // the library class is still there
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps the animating markers when the class is replaced mid-motion', () => {
    const el = mount('<rolling-number value="5"></rolling-number>');
    el.value = 80;
    raf.frame(0);
    expect(el.getAttribute('data-rn-state')).toBe('animating');
    el.className = 'b';
    expect(el.className).toBe('b rn-rolling-number rn-interpolating');
    raf.runAll(16);
    expect(el.className).toBe('b rn-rolling-number');
    expect(digitsOf(el)).toBe('80');
  });

  it('a class change while disconnected does not add the library class', () => {
    const el = mount('<rolling-number value="5" class="a"></rolling-number>');
    el.remove();
    expect(el.className).toBe('a');
    el.className = 'b';
    expect(el.className).toBe('b');
    document.body.appendChild(el);
    expect(el.className).toBe('b rn-rolling-number');
  });

  it('text mode never adds the library class', () => {
    const el = mount('<rolling-number value="5" mode="text"></rolling-number>');
    el.className = 'b';
    expect(el.className).toBe('b');
    expect(el.textContent).toBe('5');
  });
});
