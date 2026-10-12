import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingNumberCore, getResolved } from '../src/core';
import type { RollingNumberSetValueOptions, RollingNumberUpdate } from '../src/types';
import { digitsOf, installRaf, loose, makeHost, stubReducedMotion, type RafController } from './helpers';
import {
  columnPositions, expectAtRest, flushMicrotasks, flushTasks, maxStep, ownedNodes, recordEvents, shownText
} from './helpers/core';

// WP6 integration (docs/design/v1.3.md §11 WP6): the core driving the real
// engine, renderers, formatter and ticker with a manual requestAnimationFrame.

let raf: RafController;
const cores: RollingNumberCore[] = [];

function create(host: Element, options: RollingNumberUpdate = {}): RollingNumberCore {
  const core = new RollingNumberCore(host as HTMLElement, options);
  cores.push(core);
  return core;
}

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
});

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.replaceChildren();
});

/**
 * Runs frames every 16 ms from `t` until the motion settles (`steps` limits
 * the frames), returning the largest per-column step and the time reached.
 */
function drive(host: Element, t = 0, steps = Infinity): { max: number; t: number } {
  let max = 0;
  let prev = columnPositions(host);
  for (let i = 0; i < steps && raf.pending() > 0; i++, t += 16) {
    raf.frame(t);
    const next = columnPositions(host);
    max = Math.max(max, maxStep(prev, next));
    prev = next;
  }
  return { max, t };
}

describe('§14.1 frame scenarios (fake rAF, 16 ms frames)', () => {
  type Step = [value: number, animate?: boolean | RollingNumberSetValueOptions, afterMs?: number];
  // `maxStep`: the §14.1 prototype measurement (Chromium, page.clock), where the table gives one.
  const scenarios: Array<[name: string, options: RollingNumberUpdate, steps: Step[], final: string, maxStep?: number]> = [
    ['19→20', { value: 19 }, [[20]], '20', 0.115],
    ['99→100', { value: 99 }, [[100]], '100', 0.115],
    ['0→1000', { value: 0 }, [[1000]], '1000', 1.15],
    ['5→−5', { value: 5 }, [[-5]], '−5', 1.15],
    ['−50→50', { value: -50 }, [[50]], '50', 1.15],
    ['−1000→1000', { value: -1000 }, [[1000]], '1000', 1.15],
    ['1.25→3.50 (decimals 2)', { value: 1.25, decimals: 2 }, [[3.5]], '3.50', 1.73],
    ['0→9,876,543', { value: 0 }, [[9876543]], '9876543', 2.08],
    ['1000→995', { value: 1000 }, [[995]], '995', 0.58],
    ['95→150, max 99', { value: 95, max: 99, overflowSuffix: '+' }, [[150]], '99+', 0.46],
    ['150→20, max 99', { value: 150, max: 99, overflowSuffix: '+' }, [[20]], '20', 2.19],
    ['0→1000 @2000 ms', { value: 0, duration: 2000 }, [[1000]], '1000', 0.48],
    ['retarget 100→300 at 160 ms', { value: 0 }, [[100, undefined, 160], [300]], '300'],
    ['retarget to −40 mid-count', { value: 0 }, [[1000, undefined, 200], [-40]], '−40'],
    ['retarget +1000 mid-count', { value: 500 }, [[0, undefined, 100], [1500]], '1500'],
    ['8 rapid +1 clicks, 48 ms apart', { value: 0 }, [1, 2, 3, 4, 5, 6, 7].map((v): Step => [v, undefined, 48]).concat([[8]]), '8'],
    ['roll 17→22', { value: 17 }, [[22, false]], '22'],
    ['roll 99→100', { value: 99 }, [[100, false]], '100'],
    ['roll 100→99', { value: 100 }, [[99, false]], '99'],
    ['roll 5→−5', { value: 5 }, [[-5, false]], '−5'],
    ['roll retarget 10→90→20', { value: 10 }, [[90, false, 160], [20, false]], '20'],
    ['count → roll → count mix', { value: 0 }, [[500, true, 160], [80, false, 160], [1234, true]], '1234']
  ];

  it.each(scenarios)('%s', (_name, options, steps, final, expectedMax) => {
    const host = makeHost();
    const core = create(host, options);
    let t = 0;
    let max = 0;
    for (const [value, animate, afterMs] of steps) {
      void core.setValue(value, animate);
      const run = drive(host, t, afterMs === undefined ? Infinity : Math.round(afterMs / 16) + 1);
      max = Math.max(max, run.max);
      t = run.t;
    }
    expect(core.isAnimating()).toBe(false);
    expect(shownText(host)).toBe(final);
    expectAtRest(host);
    expect(max).toBeLessThanOrEqual(2.5); // §11 WP1 (e): default timings stay under 2.5 cells per frame
    if (expectedMax !== undefined) expect(Math.abs(max - expectedMax)).toBeLessThan(0.01);
  });

  it('setValue(22, roll) from 17: positions are pinned before the first frame (crit-B H4)', () => {
    const host = makeHost();
    const core = create(host, { value: 17 });
    void core.setValue(22, false);
    // data-digit is the target synchronously; the inline transforms still show 1 and 7.
    expect(digitsOf(host)).toBe('22');
    expect(columnPositions(host)).toEqual(new Map([['i1', 1], ['i0', 7]]));
    raf.frame(0);
    expect(columnPositions(host)).toEqual(new Map([['i1', 1], ['i0', 7]]));
    raf.runAll(16);
    expect(core.isAnimating()).toBe(false);
    expectAtRest(host);
  });

  it('99→100 keeps the i0/i1 nodes; i2 enters collapsed on the left (B18)', () => {
    const host = makeHost();
    const core = create(host, { value: 99 });
    const i0 = host.querySelector('[data-rn-key="i0"]');
    const i1 = host.querySelector('[data-rn-key="i1"]');
    void core.setValue(100);
    const i2 = host.querySelector('[data-rn-key="i2"]')!;
    expect(i2.hasAttribute('data-rn-in')).toBe(true);
    expect(ownedNodes(host).map((n) => n.getAttribute('data-rn-key'))).toEqual(['i2', 'i1', 'i0']);
    raf.runAll();
    expect(host.querySelector('[data-rn-key="i0"]')).toBe(i0);
    expect(host.querySelector('[data-rn-key="i1"]')).toBe(i1);
    expect(shownText(host)).toBe('100');
  });

  it('Intl layout: separators, currency and an overflow suffix settle exactly', () => {
    const host = makeHost();
    const core = create(host, { value: 999.5, locale: 'en-US', format: { style: 'currency', currency: 'USD' } });
    expect(shownText(host)).toBe('$999.50');
    void core.setValue(1234.5);
    drive(host);
    expect(shownText(host)).toBe('$1,234.50');
    expect(host.getAttribute('aria-label')).toBe('$1,234.50');
    core.update({ max: 1000, overflowSuffix: '+' });
    expect(shownText(host)).toBe('$1,000.00+');
    expect(core.getText()).toBe('$1,000.00+');
    expect(host.getAttribute('aria-label')).toBe('$1,234.50');
    expect(core.getDisplayValue()).toBe(1000);
  });
});

describe('1.2 default output (byte-identical after settle)', () => {
  /** The 1.2 markup of the owned block: optional sign, then one column per digit. */
  function markup12(value: number, pad = 1, max: number | null = null): string {
    const a = Math.sign(value) * Math.round(Math.abs(value));
    const m = max === null ? Math.abs(a) : Math.min(Math.abs(a), Math.floor(max));
    const cells = Array.from({ length: 10 }, (_, i) => `<span class="rn-cell">${i}</span>`).join('');
    const cols = String(m)
      .padStart(pad, '0')
      .split('')
      .map((d) => `<span class="rn-col" data-digit="${d}"><span class="rn-sizer" aria-hidden="true">${d}</span><span class="rn-scale" aria-hidden="true">${cells}</span></span>`)
      .join('');
    return (a < 0 && m !== 0 ? '<span class="rn-sign" aria-hidden="true">−</span>' : '') + cols;
  }
  const without13 = (host: Element): string => host.innerHTML.replace(/ data-rn-key="[^"]*"/g, '');

  it('label, data-digit and DOM equal 1.2 after counts, rolls, retargets and option changes', () => {
    const host = makeHost();
    const core = create(host, { value: 7, pad: 3 });
    const check = (value: number, pad: number, max: number | null = null): void => {
      expect(without13(host)).toBe(markup12(value, pad, max));
      expect(host.getAttribute('aria-label')).toBe(String(Math.sign(value) * Math.round(Math.abs(value)) || 0));
      expect(host.getAttribute('role')).toBe('img');
      expect(host.className).toBe('rn-rolling-number');
      expectAtRest(host);
    };
    check(7, 3);
    void core.setValue(1234);
    raf.runAll();
    check(1234, 3);
    void core.setValue(-56, false);
    raf.runAll();
    check(-56, 3);
    void core.setValue(1e6);
    raf.runAll(0, 16);
    void core.setValue(2.5);
    raf.runAll(5000, 16);
    check(2.5, 3);
    core.update({ max: 99 });
    void core.setValue(-150);
    raf.frame(10_000);
    raf.frame(10_100);
    void core.setValue(150, false);
    raf.runAll(10_116);
    expect(without13(host)).toBe(markup12(150, 3, 99));
    expect(host.getAttribute('aria-label')).toBe('150');
    core.update({ max: null, pad: 1 });
    check(150, 1);
  });

  it('every owned column carries data-rn-key (i{j} from the right)', () => {
    const host = makeHost();
    create(host, { value: -305 });
    expect(ownedNodes(host).map((n) => n.getAttribute('data-rn-key'))).toEqual(['sign', 'i2', 'i1', 'i0']);
  });
});

describe('timing from CSS (§5.8, S4, S5)', () => {
  it('read-phase instant: a roll with --rn-duration: 0s lands in the first frame with animated: false events', async () => {
    const host = makeHost();
    host.style.setProperty('--rn-duration', '0s');
    const core = create(host, { value: 1 });
    const log = recordEvents(host);
    const p = core.setValue(25, false);
    expect(core.isAnimating()).toBe(true);
    expect(log).toEqual([]);
    raf.frame(0);
    expect(log).toEqual(['rn-start:25:false', 'rn-end:25:false']);
    expect(core.isAnimating()).toBe(false);
    expect(raf.pending()).toBe(0);
    expect(shownText(host)).toBe('25');
    expectAtRest(host);
    expect(await p).toEqual({ value: 25, completed: true });
  });

  it('read-phase instant through a getComputedStyle stub of the sizer probe', () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo);
      if (!(el as Element).classList.contains('rn-sizer')) return cs;
      return { ...cs, animationDuration: '0s', animationTimingFunction: 'cubic-bezier(0.2, 1, 0.3, 1)' } as CSSStyleDeclaration;
    });
    const log = recordEvents(host);
    void core.setValue(3, false);
    raf.frame(0);
    expect(log).toEqual(['rn-start:3:false', 'rn-end:3:false']);
    expect(core.isAnimating()).toBe(false);
  });

  it('--rn-duration: 0s only disables rolls: counting keeps 400 ms (S4)', () => {
    const host = makeHost();
    host.style.setProperty('--rn-duration', '0s');
    const core = create(host, { value: 0 });
    void core.setValue(10);
    raf.frame(0);
    raf.frame(399);
    expect(core.isAnimating()).toBe(true);
    raf.frame(400);
    expect(core.isAnimating()).toBe(false);
  });

  it('absent duration: a non-default --rn-duration drives the roll D (S5) and the count D (S4)', () => {
    const host = makeHost();
    host.style.setProperty('--rn-duration', '1.2s');
    const core = create(host, { value: 0 });
    void core.setValue(5, false);
    raf.frame(0);
    raf.frame(1199);
    expect(core.isAnimating()).toBe(true);
    raf.frame(1200);
    expect(core.isAnimating()).toBe(false);
    void core.setValue(50);
    raf.frame(2000);
    raf.frame(3199);
    expect(core.isAnimating()).toBe(true);
    raf.frame(3200);
    expect(core.isAnimating()).toBe(false);
  });

  it('an explicit duration wins over the CSS variable, also for rolls (S5)', () => {
    const host = makeHost();
    host.style.setProperty('--rn-duration', '1.2s');
    const core = create(host, { value: 0, duration: 300, interpolate: false });
    void core.setValue(5);
    raf.frame(0);
    raf.frame(300);
    expect(core.isAnimating()).toBe(false);
  });

  it('a non-default --rn-easing drives counting', () => {
    const host = makeHost();
    host.style.setProperty('--rn-easing', 'linear');
    const core = create(host, { value: 0 });
    void core.setValue(100);
    raf.frame(0);
    raf.frame(200);
    expect(core.getDisplayValue()).toBeCloseTo(50, 9);
    raf.runAll(216);
  });
});

describe('text mode end to end (§6)', () => {
  it('input: counts through the values in el.value, markers limited to data-rn-state', async () => {
    const input = makeHost('input') as HTMLInputElement;
    const core = create(input, { value: 0 });
    expect(core.getMode()).toBe('text');
    expect(input.value).toBe('0');
    const log = recordEvents(input);
    const p = core.setValue(100);
    expect(input.getAttribute('data-rn-state')).toBe('animating');
    raf.frame(0);
    raf.frame(200);
    const mid = Number(input.value);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    raf.runAll(216);
    expect(input.value).toBe('100');
    expect(await p).toEqual({ value: 100, completed: true });
    expect(log).toEqual(['rn-start:100:true', 'rn-end:100:true']);
    for (const name of ['role', 'aria-label', 'class', 'data-rn-state']) expect(input.hasAttribute(name)).toBe(false);
    core.destroy();
    expect(input.value).toBe('100'); // form controls keep the last value
  });

  it('input[type=number] gets ASCII numeric text; textarea gets the formatted text', () => {
    const num = makeHost('input') as HTMLInputElement;
    num.type = 'number';
    create(num, { value: -1234.5, decimals: 2, prefixText: '≈' });
    expect(num.value).toBe('-1234.50');
    const area = makeHost('textarea') as HTMLTextAreaElement;
    const core = create(area, { value: 5, prefixText: '≈', suffixText: ' pts', max: 3, overflowSuffix: '+' });
    expect(area.value).toBe('≈3+ pts');
    expect(core.getText()).toBe('≈3+ pts');
  });

  it('SVG <text>: the text is replaced while attached and restored on destroy', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = 'label';
    svg.appendChild(text);
    document.body.appendChild(svg);
    const core = create(text, { value: 42 });
    expect(core.getMode()).toBe('text');
    expect(text.textContent).toBe('42');
    void core.setValue(7, false); // roll = count with roll timing in text mode
    raf.runAll();
    expect(text.textContent).toBe('7');
    core.destroy();
    expect(text.textContent).toBe('label');
  });

  it('a focused control: the change is instant (microtask events, animated: false), written on blur', async () => {
    const input = makeHost('input') as HTMLInputElement;
    const core = create(input, { value: 1 });
    const log = recordEvents(input);
    input.focus();
    const p = core.setValue(9);
    expect(raf.pending()).toBe(0);
    expect(core.isAnimating()).toBe(false);
    expect(input.value).toBe('1');
    expect(log).toEqual([]);
    expect(await p).toEqual({ value: 9, completed: true });
    expect(log).toEqual(['rn-start:9:false', 'rn-end:9:false']);
    input.blur();
    expect(input.value).toBe('9');
  });

  it('mode: "columns" on an input keeps the 1.2 warning and renders columns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = makeHost('input');
    const core = create(input, { value: 12, mode: 'columns' });
    expect(core.getMode()).toBe('columns');
    expect(digitsOf(input)).toBe('12');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('<input>');
  });

  it('update({ mode }) re-creates the renderer and restores the host markers', () => {
    const host = makeHost();
    host.setAttribute('role', 'status');
    const core = create(host, { value: 12 });
    void core.setValue(40);
    raf.frame(0);
    core.update({ mode: 'text' });
    expect(core.getMode()).toBe('text');
    expect(core.isAnimating()).toBe(false);
    expect(host.textContent).toBe('40');
    expect(host.querySelector('.rn-col')).toBeNull();
    expect(host.getAttribute('role')).toBe('status');
    expect(host.hasAttribute('aria-label')).toBe(false);
    expect(host.classList.contains('rn-rolling-number')).toBe(false);
    core.update({ mode: 'columns' });
    expect(core.getMode()).toBe('columns');
    expect(digitsOf(host)).toBe('40');
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('40');
    core.destroy();
    expect(host.getAttribute('role')).toBe('status');
    expect(host.childNodes).toHaveLength(0);
  });
});

describe('host handling', () => {
  it('an unsupported host: warning, no writes, the API still works (instant, events in a microtask)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const img = makeHost('img');
    const core = create(img, { value: 1 });
    const log = recordEvents(img);
    expect(img.attributes).toHaveLength(0);
    expect(await core.setValue(2)).toEqual({ value: 2, completed: true });
    expect(log).toEqual(['rn-start:2:false', 'rn-end:2:false']);
    expect(img.attributes).toHaveLength(0);
    expect(img.childNodes).toHaveLength(0);
    expect(core.getText()).toBe('2');
    expect(raf.requested()).toBe(0);
  });

  it('a host rendered by renderStaticHTML / getSSRProps: role and label are core-owned, data-rn-ssr is removed', () => {
    const host = makeHost();
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', '5');
    host.setAttribute('data-rn-ssr', '');
    const core = create(host, { value: 5 });
    expect(host.hasAttribute('data-rn-ssr')).toBe(false);
    expect(host.getAttribute('aria-label')).toBe('5');
    core.destroy();
    expect(host.hasAttribute('role')).toBe(false);
    expect(host.hasAttribute('aria-label')).toBe(false);
  });

  it('an adopted fallback child is hidden on mount, kept before the columns, and restored on destroy', () => {
    const host = makeHost();
    const fallback = document.createElement('span');
    fallback.setAttribute('data-rn-ssr', '');
    fallback.textContent = '1,234';
    host.appendChild(fallback);
    const core = create(host, { value: 1234 });
    expect(fallback.hasAttribute('hidden')).toBe(true);
    expect(host.firstChild).toBe(fallback);
    expect(digitsOf(host)).toBe('1234');
    core.destroy();
    expect(fallback.hasAttribute('hidden')).toBe(false);
  });

  it('live: announces the label of each settled value (debounced in a11y.ts)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const host = makeHost();
      const core = create(host, { value: 0, live: 'polite', label: 'Score {value}' });
      const region = document.querySelector('[data-rn-live]')!;
      expect(region.getAttribute('aria-live')).toBe('polite');
      void core.setValue(5, { motion: 'none' });
      await flushMicrotasks();
      vi.advanceTimersByTime(301);
      expect(region.textContent).toBe('Score 5');
      core.update({ live: 'off' });
      expect(document.querySelector('[data-rn-live]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('render() re-adds the markers mid-motion and re-paints a rest DOM a framework disturbed', () => {
    const host = makeHost();
    const core = create(host, { value: 12 });
    host.querySelector('[data-rn-key="i0"]')!.remove();
    core.render();
    expect(digitsOf(host)).toBe('12');
    void core.setValue(50);
    raf.frame(0);
    host.className = 'framework';
    host.removeAttribute('data-rn-state');
    core.render();
    expect(host.className).toBe('framework rn-rolling-number rn-interpolating');
    expect(host.getAttribute('data-rn-state')).toBe('animating');
  });

  it('getResolved() reflects setValue/update/setters at once; f is the formatter precision', () => {
    const host = makeHost();
    const core = create(host, { value: 1, from: 0 });
    expect(getResolved(core)).toMatchObject({ value: 1, from: 0, duration: null, easing: null, f: 0 });
    void core.setValue(7);
    core.setDuration(800);
    core.setInterpolate(false);
    core.update({ locale: 'de-DE en', format: { style: 'currency', currency: 'EUR' }, label: 'x', from: 3, injectStyles: false });
    const r = getResolved(core);
    expect(r).toMatchObject({ value: 7, duration: 800, interpolate: false, label: 'x', from: 3, injectStyles: false, prefixText: '', decimals: null, f: 2 });
    expect(r.locale).toEqual(['de-DE', 'en']);
    expect(Object.isFrozen(r)).toBe(true);
    core.update({ duration: null, locale: null, format: null });
    expect(getResolved(core)).toMatchObject({ duration: null, locale: null, format: null, f: 0 });
  });

  it('setters and update() share one path: update() without value never calls setValue', () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    const setValue = vi.spyOn(RollingNumberCore.prototype, 'setValue');
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');
    core.update({ pad: 2, max: 5 });
    core.setPad(3);
    core.setMax(null);
    core.setInterpolate(false);
    core.setDuration(100);
    expect(setValue).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    create(makeHost(), { value: 5, from: 0 });
    expect(setValue).not.toHaveBeenCalled();
  });

  it('a second core on the same host destroys the first (pending promises resolve completed: false)', async () => {
    const host = makeHost();
    const first = create(host, { value: 0 });
    const p = first.setValue(10);
    create(host, { value: 3 });
    expect(await p).toEqual({ value: 10, completed: false });
    expect(digitsOf(host)).toBe('3');
    expect(raf.pending()).toBe(0);
    await flushTasks();
  });

  it('loose 1.3 options never throw and normalize to their defaults', () => {
    const host = makeHost();
    const core = create(host, loose({ value: '5', from: 'x', trigger: 7, live: 'loud', mode: 'bogus', label: 3 }));
    expect(getResolved(core)).toMatchObject({ value: 5, from: null, trigger: 'immediate', live: 'off', mode: 'auto', label: null });
    expect(digitsOf(host)).toBe('5');
  });
});
