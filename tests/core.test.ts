import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { RN_DEFAULTS, RollingNumberCore, normalizeOptions, type RollingNumberOptions } from '../src/core';
import { digitsOf, displayOf, installRaf, loose, makeHost, stubReducedMotion, type RafController } from './helpers';

const MAX_SAFE = String(Number.MAX_SAFE_INTEGER);

let raf: RafController;
const cores: RollingNumberCore[] = [];

/** Creates a core and remembers it so afterEach can destroy it. */
function create(host: HTMLElement, options?: RollingNumberOptions): RollingNumberCore {
  const core = new RollingNumberCore(host, options);
  cores.push(core);
  return core;
}

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
});

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
});

describe('RN_DEFAULTS / normalizeOptions', () => {
  it('exposes the documented defaults as a frozen object', () => {
    expect(RN_DEFAULTS).toEqual({ value: 0, pad: 1, max: null, interpolate: true, duration: 400 });
    expect(Object.isFrozen(RN_DEFAULTS)).toBe(true);
  });

  it('returns the defaults for null, undefined and empty objects (new object every time)', () => {
    expect(normalizeOptions(undefined)).toEqual(RN_DEFAULTS);
    expect(normalizeOptions(null)).toEqual(RN_DEFAULTS);
    expect(normalizeOptions({})).toEqual(RN_DEFAULTS);
    expect(normalizeOptions({})).not.toBe(RN_DEFAULTS);
  });

  it.each([
    [NaN, 0],
    ['abc', 0],
    ['42', 42],
    [' 7 ', 7],
    ['', 0],
    [null, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [1e21, Number.MAX_SAFE_INTEGER],
    [-1e21, -Number.MAX_SAFE_INTEGER],
    [-1.5, -1.5],
    [12.34, 12.34]
  ])('value %s → %s', (input, expected) => {
    expect(normalizeOptions({ value: loose(input) }).value).toBe(expected);
  });

  it.each([
    [Infinity, 1],
    [-Infinity, 1],
    [NaN, 1],
    [0, 1],
    [-5, 1],
    [0.5, 1],
    ['3', 3],
    [2.9, 2],
    [64, 64],
    [65, 64],
    [1e6, 64],
    ['x', 1]
  ])('pad %s → %s', (input, expected) => {
    expect(normalizeOptions({ pad: loose(input) }).pad).toBe(expected);
  });

  it.each([
    [9.5, 9],
    [-1, null],
    ['', null],
    [null, null],
    [undefined, null],
    [Infinity, null],
    [NaN, null],
    ['99', 99],
    [0, 0],
    ['abc', null]
  ])('max %s → %s', (input, expected) => {
    expect(normalizeOptions({ max: loose(input) }).max).toBe(expected);
  });

  it.each([
    [-5, 0],
    [NaN, 400],
    [Infinity, 400],
    ['200', 200],
    [0, 0],
    [12.5, 12.5],
    ['x', 400]
  ])('duration %s → %s', (input, expected) => {
    expect(normalizeOptions({ duration: loose(input) }).duration).toBe(expected);
  });

  it.each([
    ['false', false],
    [false, false],
    [0, false],
    ['true', true],
    [true, true],
    [1, true],
    [undefined, true],
    [null, true]
  ])('interpolate %s → %s', (input, expected) => {
    expect(normalizeOptions({ interpolate: loose(input) }).interpolate).toBe(expected);
  });

  it('never throws on hostile input', () => {
    const hostile = { valueOf() { throw new Error('boom'); } };
    expect(() => normalizeOptions(loose({ value: hostile, pad: Symbol('x'), max: {}, duration: [] }))).not.toThrow();
    expect(normalizeOptions(loose({ value: hostile })).value).toBe(0);
  });
});

describe('RollingNumberCore: rendering', () => {
  it('renders one column per digit, role=img, aria-label and the root class', () => {
    const host = makeHost();
    create(host, { value: 42 });
    expect(digitsOf(host)).toBe('42');
    expect(host.querySelectorAll('.rn-col')).toHaveLength(2);
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('42');
    expect(host.classList.contains('rn-rolling-number')).toBe(true);
    expect(host.querySelector('.rn-sign')).toBeNull();
  });

  it('builds the documented column structure (sizer + 0..9 scale, aria-hidden)', () => {
    const host = makeHost();
    create(host, { value: 7 });
    const col = host.querySelector('.rn-col')!;
    expect(col.getAttribute('data-digit')).toBe('7');
    const sizer = col.querySelector('.rn-sizer')!;
    expect(sizer.textContent).toBe('7');
    expect(sizer.getAttribute('aria-hidden')).toBe('true');
    const scale = col.querySelector('.rn-scale')!;
    expect(scale.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(scale.querySelectorAll('.rn-cell')).map((c) => c.textContent)).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
    );
  });

  it('renders with the defaults when no options are given', () => {
    const host = makeHost();
    const core = create(host);
    expect(digitsOf(host)).toBe('0');
    expect(core.getValue()).toBe(0);
    expect(core.getElement()).toBe(host);
    expect(core.isAnimating()).toBe(false);
  });

  it('zero-pads to `pad` digits without truncating longer numbers', () => {
    const host = makeHost();
    const core = create(host, { value: 7, pad: 3 });
    expect(digitsOf(host)).toBe('007');
    core.setValue(12345, false);
    expect(digitsOf(host)).toBe('12345');
  });

  it('renders a negative sign before the digit columns', () => {
    const host = makeHost();
    create(host, { value: -15 });
    expect(displayOf(host)).toBe('-15');
    const sign = host.querySelector('.rn-sign')!;
    expect(sign.getAttribute('aria-hidden')).toBe('true');
    expect(sign.nextElementSibling?.classList.contains('rn-col')).toBe(true);
    expect(host.getAttribute('aria-label')).toBe('-15');
  });

  it('removes the sign when the value becomes positive', () => {
    const host = makeHost();
    const core = create(host, { value: -3 });
    core.setValue(3, false);
    expect(displayOf(host)).toBe('3');
    expect(host.querySelector('.rn-sign')).toBeNull();
  });

  it('rounds symmetrically around zero, consistently for digits and aria-label', () => {
    const host = makeHost();
    const core = create(host, { value: -1.5 });
    expect(displayOf(host)).toBe('-2');
    expect(host.getAttribute('aria-label')).toBe('-2');
    core.setValue(1.5, false);
    expect(displayOf(host)).toBe('2');
    expect(host.getAttribute('aria-label')).toBe('2');
    core.setValue(-0.4, false);
    expect(displayOf(host)).toBe('0');
    expect(host.getAttribute('aria-label')).toBe('0');
  });

  it('normalizes loose values: NaN, "abc", Infinity → 0; 1e21 → MAX_SAFE_INTEGER (no exponent)', () => {
    const host = makeHost();
    const core = create(host, { value: NaN });
    expect(digitsOf(host)).toBe('0');
    core.setValue(loose('abc'), false);
    expect(digitsOf(host)).toBe('0');
    core.setValue(Infinity, false);
    expect(digitsOf(host)).toBe('0');
    core.setValue(1e21, false);
    expect(digitsOf(host)).toBe(MAX_SAFE);
    expect(host.getAttribute('aria-label')).toBe(MAX_SAFE);
    core.setValue(loose('12'), false);
    expect(digitsOf(host)).toBe('12');
    expect(core.getValue()).toBe(12);
  });

  it('accepts loose constructor options without throwing', () => {
    const host = makeHost();
    expect(() =>
      create(host, loose({ value: '5', pad: Infinity, max: '', interpolate: 'false', duration: NaN }))
    ).not.toThrow();
    expect(digitsOf(host)).toBe('5');
    // A null options object is tolerated as well.
    expect(() => create(makeHost(), loose(null))).not.toThrow();
  });

  it('clamps pad: Infinity/0/NaN → 1, "3" → 3, huge → 64 columns', () => {
    const host = makeHost();
    const core = create(host, { value: 1, pad: Infinity });
    expect(digitsOf(host)).toBe('1');
    core.setPad(0);
    expect(digitsOf(host)).toBe('1');
    core.setPad(loose('3'));
    expect(digitsOf(host)).toBe('001');
    core.setPad(NaN);
    expect(digitsOf(host)).toBe('1');
    core.setPad(1e6);
    expect(host.querySelectorAll('.rn-col')).toHaveLength(64);
  });

  it('clamps the displayed magnitude to max (aria-label keeps the target value)', () => {
    const host = makeHost();
    const core = create(host, { value: 150, max: 99 });
    expect(digitsOf(host)).toBe('99');
    expect(host.getAttribute('aria-label')).toBe('150');
    core.setValue(-150, false);
    expect(displayOf(host)).toBe('-99');
    core.setMax(null);
    expect(displayOf(host)).toBe('-150');
  });

  it('normalizes max: 9.5 → 9, -1 / "" / null → no limit', () => {
    const host = makeHost();
    const core = create(host, { value: 50, max: 9.5 });
    expect(digitsOf(host)).toBe('9');
    core.setMax(-1);
    expect(digitsOf(host)).toBe('50');
    core.setMax(9);
    core.setMax(loose(''));
    expect(digitsOf(host)).toBe('50');
    core.setMax(9);
    core.setMax(loose(undefined));
    expect(digitsOf(host)).toBe('50');
    core.setMax(loose('20'));
    expect(digitsOf(host)).toBe('20');
  });

  it('removes extra columns from the end when the number gets shorter', () => {
    const host = makeHost();
    const core = create(host, { value: 1000 });
    const first = host.querySelector('.rn-col');
    core.setValue(5, false);
    expect(digitsOf(host)).toBe('5');
    expect(host.querySelector('.rn-col')).toBe(first);
  });

  it('setValue(v, false) updates synchronously without requesting frames', () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    core.setValue(250, false);
    expect(digitsOf(host)).toBe('250');
    expect(raf.requested()).toBe(0);
    expect(core.getValue()).toBe(250);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
  });

  it('update() treats undefined fields as unchanged and tolerates null', () => {
    const host = makeHost();
    const core = create(host, { value: 7, pad: 3, max: 500, interpolate: false });
    core.update({ value: undefined, pad: undefined, max: undefined });
    expect(digitsOf(host)).toBe('007');
    core.update({ pad: 2 });
    expect(digitsOf(host)).toBe('07');
    expect(() => core.update(loose(null))).not.toThrow();
    core.update({ value: 900 });
    expect(digitsOf(host)).toBe('500');
    core.update({ max: null });
    expect(digitsOf(host)).toBe('900');
  });

  it('update({ value, interpolate: false }) applies the new interpolate before the value', () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    core.update({ value: 50, interpolate: false });
    expect(digitsOf(host)).toBe('50');
    expect(raf.requested()).toBe(0);
  });

  it('render() re-adds the root class after a framework clobbers className', () => {
    const host = makeHost();
    const core = create(host, { value: 3 });
    host.className = 'framework-owned';
    core.render();
    expect(host.classList.contains('rn-rolling-number')).toBe(true);
    expect(host.classList.contains('framework-owned')).toBe(true);
  });

  it('only writes aria-label when the target value changes', () => {
    const host = makeHost();
    const core = create(host, { value: 12 });
    const spy = vi.spyOn(host, 'setAttribute');
    core.render();
    core.render();
    core.setPad(1);
    core.setMax(null);
    expect(spy).not.toHaveBeenCalled();

    core.setValue(500);
    raf.runAll(0, 50);
    const labelWrites = spy.mock.calls.filter(([name]) => name === 'aria-label');
    expect(labelWrites).toEqual([['aria-label', '500']]);
  });

  it('does not touch the DOM when render() has nothing to change', () => {
    const host = makeHost();
    const core = create(host, { value: 12 });
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    core.render();
    core.render();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });
});

describe('RollingNumberCore: interpolation', () => {
  it('animates through intermediate values and ends exactly on the target', () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: 400 });
    core.setValue(100);

    expect(core.isAnimating()).toBe(true);
    expect(host.getAttribute('aria-label')).toBe('100');
    expect(raf.pending()).toBe(1);

    raf.frame(1000); // first frame: start time
    expect(digitsOf(host)).toBe('0');
    raf.frame(1200); // halfway in time, easeOutCubic → 87.5
    const mid = Number(digitsOf(host));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(core.isAnimating()).toBe(true);

    raf.frame(1400);
    expect(digitsOf(host)).toBe('100');
    expect(core.isAnimating()).toBe(false);
    expect(raf.pending()).toBe(0);
  });

  it('values never go backwards during an upward interpolation', () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: 400 });
    core.setValue(1000);
    const seen: number[] = [];
    let t = 0;
    while (raf.pending()) {
      raf.frame(t);
      seen.push(Number(digitsOf(host)));
      t += 16;
    }
    expect(seen.at(-1)).toBe(1000);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('sets data-rn-state="animating" and rn-interpolating while running, removes both at the end', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(10);
    expect(host.getAttribute('data-rn-state')).toBe('animating');
    expect(host.classList.contains('rn-interpolating')).toBe(true);

    raf.frame(0);
    raf.frame(100);
    expect(host.getAttribute('data-rn-state')).toBe('animating');
    expect(host.classList.contains('rn-interpolating')).toBe(true);

    raf.frame(400);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(host.classList.contains('rn-interpolating')).toBe(false);
    expect(host.classList.contains('rn-rolling-number')).toBe(true);
  });

  it('renders the final digits before leaving the animating state', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(99);
    raf.frame(0);
    raf.frame(100);

    // happy-dom delivers mutation records asynchronously: read them synchronously
    // with takeRecords() and check their order.
    const observer = new MutationObserver(() => {});
    observer.observe(host, { attributes: true, attributeOldValue: true, subtree: true });

    raf.frame(400);
    const records = observer.takeRecords();
    observer.disconnect();
    const stateRemovedAt = records.findIndex((r) => r.target === host && r.attributeName === 'data-rn-state');
    const digitWrites = records.filter((r) => r.attributeName === 'data-digit');
    const lastDigitWriteAt = records.lastIndexOf(digitWrites[digitWrites.length - 1]);
    expect(stateRemovedAt).toBeGreaterThan(-1);
    // The last frame did write digits, all of them before the state was cleared...
    expect(lastDigitWriteAt).toBeGreaterThan(-1);
    expect(lastDigitWriteAt).toBeLessThan(stateRemovedAt);
    // ...and no digit changes after it, so the digits on screen when the state was
    // removed are the final ones.
    for (const r of digitWrites) {
      expect(r.oldValue).not.toBe('9');
      expect((r.target as Element).getAttribute('data-digit')).toBe('9');
    }
    expect(digitsOf(host)).toBe('99');
  });

  it('re-applies the animating markers when a framework clobbers className mid-animation', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(50);
    raf.frame(0);
    host.className = 'user';
    raf.frame(100);
    expect(host.classList.contains('rn-rolling-number')).toBe(true);
    expect(host.classList.contains('rn-interpolating')).toBe(true);
    expect(host.classList.contains('user')).toBe(true);
  });

  it('interrupting an animation restarts from the number on screen', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(100);
    raf.frame(0);
    raf.frame(200);
    const onScreen = Number(digitsOf(host));
    expect(onScreen).toBeGreaterThan(0);
    expect(onScreen).toBeLessThan(100);

    const cancelledBefore = raf.cancelled();
    core.setValue(0);
    expect(raf.cancelled()).toBe(cancelledBefore + 1);
    expect(raf.pending()).toBe(1);
    expect(host.getAttribute('aria-label')).toBe('0');

    raf.frame(1000); // start of the new animation: still showing the interrupted value
    expect(Number(digitsOf(host))).toBe(onScreen);
    raf.frame(1100);
    expect(Number(digitsOf(host))).toBeLessThanOrEqual(onScreen);
    raf.frame(1400);
    expect(digitsOf(host)).toBe('0');
    expect(core.isAnimating()).toBe(false);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
  });

  it('an immediate setValue during an animation cancels it and clears the state', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    core.setValue(7, false);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('7');
    expect(core.isAnimating()).toBe(false);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(host.classList.contains('rn-interpolating')).toBe(false);
  });

  it('clamps progress for frames with a timestamp earlier than the start', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(100);
    raf.frame(1000);
    raf.frame(900); // negative elapsed time
    expect(digitsOf(host)).toBe('0');
    raf.frame(1400);
    expect(digitsOf(host)).toBe('100');
    expect(core.isAnimating()).toBe(false);
  });

  it('honours duration (setDuration: NaN keeps the previous value, negative → 0)', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setDuration(1000);
    core.setDuration(NaN);
    core.setValue(100);
    raf.frame(0);
    raf.frame(500);
    expect(core.isAnimating()).toBe(true);
    raf.frame(1000);
    expect(core.isAnimating()).toBe(false);

    core.setDuration(-50); // → 0: no interpolation
    core.setValue(5);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('5');
  });

  it('constructor duration: negative → 0, no interpolation (as in v1.2.1)', () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: -1 });
    core.setValue(100);
    expect(raf.pending()).toBe(0);
    expect(core.isAnimating()).toBe(false);
    expect(digitsOf(host)).toBe('100');
  });

  it('constructor duration: NaN → 400', () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: NaN });
    core.setValue(100);
    raf.frame(0);
    raf.frame(399);
    expect(core.isAnimating()).toBe(true);
    raf.frame(400);
    expect(core.isAnimating()).toBe(false);
  });

  it('constructor and update() treat a negative duration the same way', () => {
    const a = makeHost();
    const created = create(a, { value: 0, duration: -5 });
    const b = makeHost();
    const updated = create(b, { value: 0 });
    updated.update({ duration: -5 });
    created.setValue(7);
    updated.setValue(7);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(a)).toBe('7');
    expect(digitsOf(b)).toBe('7');
  });

  it('setInterpolate(null) and update({ interpolate: null }) fall back to the default (true)', () => {
    const a = makeHost();
    const viaSetter = create(a, { value: 0, interpolate: false });
    viaSetter.setInterpolate(loose(null));
    viaSetter.setValue(10);
    expect(viaSetter.isAnimating()).toBe(true);

    const b = makeHost();
    const viaUpdate = create(b, { value: 0, interpolate: false });
    viaUpdate.update({ interpolate: loose(null) });
    viaUpdate.setValue(10);
    expect(viaUpdate.isAnimating()).toBe(true);

    const c = makeHost();
    const viaUndefinedSetter = create(c, { value: 0, interpolate: false });
    viaUndefinedSetter.setInterpolate(loose(undefined));
    viaUndefinedSetter.setValue(10);
    expect(viaUndefinedSetter.isAnimating()).toBe(true);
  });

  it('setInterpolate(false) and the string "false" disable interpolation', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setInterpolate(false);
    core.setValue(10);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('10');

    core.setInterpolate(true);
    core.setInterpolate(loose('false'));
    core.setValue(20);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('20');

    core.setInterpolate(true);
    core.setValue(30);
    expect(raf.pending()).toBe(1);
    // An explicit animate argument wins over the option.
    core.setValue(40, false);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('40');
  });

  it('skips the interpolation when the user prefers reduced motion', () => {
    stubReducedMotion(true);
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(100);
    expect(raf.requested()).toBe(0);
    expect(digitsOf(host)).toBe('100');
    expect(host.hasAttribute('data-rn-state')).toBe(false);
  });

  it('still animates when matchMedia is missing or throws', () => {
    vi.stubGlobal('matchMedia', undefined);
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(10);
    expect(raf.pending()).toBe(1);
    raf.runAll();

    vi.stubGlobal('matchMedia', () => {
      throw new Error('nope');
    });
    core.setValue(20);
    expect(raf.pending()).toBe(1);
    raf.runAll();
    expect(digitsOf(host)).toBe('20');
  });

  it('works with vitest fake timers driving requestAnimationFrame', () => {
    vi.unstubAllGlobals();
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const host = makeHost();
      const core = create(host, { value: 0 });
      core.setValue(100);
      vi.advanceTimersByTime(200);
      expect(core.isAnimating()).toBe(true);
      vi.advanceTimersByTime(400);
      expect(core.isAnimating()).toBe(false);
      expect(digitsOf(host)).toBe('100');
      expect(host.hasAttribute('data-rn-state')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not animate when requestAnimationFrame is unavailable', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(42);
    expect(digitsOf(host)).toBe('42');
    expect(core.isAnimating()).toBe(false);
  });
});

describe('RollingNumberCore: destroy', () => {
  it('keeps pre-existing children, role, aria-label and class', () => {
    const host = makeHost('p');
    host.className = 'user';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-label', 'Score');
    const label = document.createTextNode('Score: ');
    const bold = document.createElement('b');
    bold.textContent = 'pts';
    host.append(label, bold);

    const core = create(host, { value: -15 });
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('-15');
    expect(host.textContent!.startsWith('Score: pts')).toBe(true);

    core.destroy();
    expect(Array.from(host.childNodes)).toEqual([label, bold]);
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-label')).toBe('Score');
    expect(host.className).toBe('user');
  });

  it('removes role/aria-label it added, but keeps a root class that was already there', () => {
    const plain = makeHost();
    create(plain, { value: 1 }).destroy();
    expect(plain.hasAttribute('role')).toBe(false);
    expect(plain.hasAttribute('aria-label')).toBe(false);
    expect(plain.hasAttribute('class') ? plain.className : '').toBe('');
    expect(plain.childNodes).toHaveLength(0);

    const styled = makeHost();
    styled.className = 'rn-rolling-number big';
    create(styled, { value: 1 }).destroy();
    expect(styled.className).toBe('rn-rolling-number big');
  });

  it('never assigns innerHTML', () => {
    const host = makeHost();
    const core = create(host, { value: 123 });
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    const setter = vi.fn();
    Object.defineProperty(host, 'innerHTML', { configurable: true, get: descriptor.get, set: setter });
    core.setValue(-4, false);
    core.destroy();
    expect(setter).not.toHaveBeenCalled();
  });

  it('cancels a running animation and clears the animating state', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    core.destroy();
    expect(raf.pending()).toBe(0);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(host.classList.contains('rn-interpolating')).toBe(false);
    expect(host.querySelector('.rn-col')).toBeNull();
    expect(core.isAnimating()).toBe(false);
  });

  it('is idempotent and leaves the instance inert', () => {
    const host = makeHost();
    const core = create(host, { value: 5 });
    core.destroy();
    expect(() => core.destroy()).not.toThrow();
    core.setValue(9);
    core.render();
    core.setPad(4);
    expect(host.childNodes).toHaveLength(0);
    expect(host.hasAttribute('aria-label')).toBe(false);
    expect(raf.pending()).toBe(0);
  });
});

describe('RollingNumberCore: host handling', () => {
  it('a second core on the same host replaces the first one (no duplicated columns)', () => {
    const host = makeHost();
    host.setAttribute('role', 'status');
    const first = create(host, { value: 42 });
    const second = create(host, { value: 42 });
    expect(digitsOf(host)).toBe('42');
    expect(host.querySelectorAll('.rn-col')).toHaveLength(2);

    // The replaced instance is inert: it no longer writes to the shared host.
    first.setValue(7, false);
    first.render();
    expect(digitsOf(host)).toBe('42');
    expect(host.getAttribute('aria-label')).toBe('42');

    second.destroy();
    expect(host.childNodes).toHaveLength(0);
    expect(host.getAttribute('role')).toBe('status');
    expect(host.hasAttribute('aria-label')).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain object', {}],
    ['a fake element without setAttribute', { nodeType: 1 }],
    ['a text node', 'text'],
    ['the document', 'document'],
    ['a string', '#id']
  ])('throws a clear error for %s', (_label, input) => {
    const target = input === 'text' ? document.createTextNode('x') : input === 'document' ? document : input;
    expect(() => new RollingNumberCore(loose(target))).toThrow('[RollingNumber] Target container must be a valid HTMLElement.');
  });

  it('accepts elements from another window (realm-safe) and creates nodes in their document', () => {
    const other = new Window();
    try {
      const foreign = other.document.createElement('span');
      other.document.body.appendChild(foreign);
      const core = create(loose(foreign), { value: -12 });
      const created = foreign.querySelectorAll('.rn-col, .rn-sign');
      expect(created).toHaveLength(3);
      for (const node of Array.from(created)) expect(node.ownerDocument).toBe(other.document);
      core.destroy();
      expect(foreign.childNodes).toHaveLength(0);
    } finally {
      void other.happyDOM.close();
    }
  });

  it('works on common container hosts (div, button, td) without warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = makeHost('table').appendChild(document.createElement('tbody')).appendChild(document.createElement('tr'));
    for (const host of [makeHost('div'), makeHost('button'), row.appendChild(document.createElement('td'))]) {
      create(host, { value: 31 });
      expect(digitsOf(host)).toBe('31');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per unsupported host (<input>, <textarea>, SVG) but still does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = makeHost('input');
    create(input, { value: 42 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('<input>');
    create(input, { value: 43 }); // same host again: no second warning
    expect(warn).toHaveBeenCalledTimes(1);

    create(makeHost('textarea'), { value: 1 });
    expect(warn).toHaveBeenCalledTimes(2);

    const svgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(svgGroup);
    create(loose(svgGroup), { value: 1 });
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
