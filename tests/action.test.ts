import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingNumberCore, getResolved } from '../src/core';
import { rollingNumber } from '../src/action';
import * as ActionEntry from '../src/action-entry';
import { RN_DEFAULTS_13 } from '../src/options';
import type { RollingNumberLabelInfo } from '../src/types';
import { digitsOf, installRaf, makeHost, stubReducedMotion, type RafController } from './helpers';

let raf: RafController;

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
});

afterEach(() => {
  document.body.replaceChildren();
});

/** R-settle: runs every queued frame, then waits for the core to settle (instant with the WP0 core). */
async function settle(core: RollingNumberCore | null): Promise<void> {
  raf.runAll();
  await core?.whenSettled();
}

describe('rollingNumber() action', () => {
  it('is exported by the root entry and by rolling-number/action', () => {
    expect(ActionEntry.rollingNumber).toBe(rollingNumber);
  });

  it('accepts a number param (the value)', () => {
    const host = makeHost();
    const action = rollingNumber(host, 42);
    expect(action.core).toBeInstanceOf(RollingNumberCore);
    expect(action.core!.getHost()).toBe(host);
    expect(digitsOf(host)).toBe('42');
    expect(host.getAttribute('aria-label')).toBe('42');
    expect(getResolved(action.core!)).toMatchObject({ ...RN_DEFAULTS_13, value: 42 });
  });

  it('accepts the full option set, and no param at all', () => {
    const host = makeHost();
    const action = rollingNumber(host, { value: 7, pad: 3, max: 99, interpolate: false, duration: 600, overflowSuffix: '+' });
    expect(digitsOf(host)).toBe('007');
    expect(getResolved(action.core!)).toMatchObject({ value: 7, pad: 3, max: 99, interpolate: false, duration: 600, overflowSuffix: '+' });

    const bare = makeHost();
    const empty = rollingNumber(bare);
    expect(digitsOf(bare)).toBe('0');
    expect(getResolved(empty.core!).duration).toBeNull();
  });

  it('update() replaces the whole option set: omitted fields reset to their defaults (Svelte semantics)', async () => {
    const host = makeHost();
    const action = rollingNumber(host, { value: 5, pad: 3, max: 99, duration: 900, easing: 'linear', prefixText: '$' });
    const core = action.core!;

    action.update({ value: 6 });
    expect(action.core).toBe(core);
    expect(core.getValue()).toBe(6);
    const r = getResolved(core);
    expect(r.pad).toBe(1);
    expect(r.max).toBeNull();
    expect(r.duration).toBeNull(); // unset, not 400
    expect(r.easing).toBeNull();
    expect(r.prefixText).toBe('');
    await settle(core);
    expect(digitsOf(host)).toBe('6');

    // A number param is the value; everything else is the default.
    action.update({ value: 6, pad: 2 });
    action.update(8);
    expect(core.getValue()).toBe(8);
    expect(getResolved(core).pad).toBe(1);
    await settle(core);
    expect(digitsOf(host)).toBe('8');

    // An undefined field counts as omitted, and update() with no param resets the value.
    action.update({ value: 8, pad: undefined });
    expect(getResolved(core).pad).toBe(1);
    action.update();
    expect(core.getValue()).toBe(0);
  });

  it('update() is a no-op when nothing changed (Object.is per field, shallow format, element-wise locale, functions by identity)', () => {
    const host = makeHost();
    const label = (info: RollingNumberLabelInfo) => `${info.text} pts`;
    const param = () => ({
      value: 5,
      pad: 2,
      format: { style: 'currency', currency: 'EUR' } as const,
      locale: ['de-DE', 'fr'],
      label
    });
    const action = rollingNumber(host, param());
    const update = vi.spyOn(RollingNumberCore.prototype, 'update');

    action.update(param()); // new but equal format object and locale array
    expect(update).not.toHaveBeenCalled();

    action.update({ ...param(), format: { style: 'currency', currency: 'USD' } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ format: { style: 'currency', currency: 'USD' } });

    action.update({ ...param(), locale: ['de-DE'], label: (info: RollingNumberLabelInfo) => info.text });
    expect(update).toHaveBeenCalledTimes(2);
    const changed = update.mock.calls[1][0];
    expect(Object.keys(changed).sort()).toEqual(['format', 'label', 'locale']);
    expect(changed.locale).toEqual(['de-DE']);

    action.update({ value: 5, pad: 2 });
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenLastCalledWith({ format: null, locale: null, label: null });
    expect(getResolved(action.core!)).toMatchObject({ format: null, locale: null, label: null, pad: 2 });

    action.update({ value: 5, pad: 2 });
    action.update({ value: 5, pad: 2, from: 3 }); // `from` is creation-only
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('renders into `target`: a selector or an element inside the node', () => {
    const node = makeHost('div');
    const inner = document.createElement('span');
    inner.className = 'n';
    const other = document.createElement('span');
    node.append(inner, other);

    const action = rollingNumber(node, { value: 3, target: '.n' });
    expect(action.core!.getHost()).toBe(inner);
    expect(inner.classList.contains('rn-rolling-number')).toBe(true);
    expect(node.classList.contains('rn-rolling-number')).toBe(false);
    expect(digitsOf(inner)).toBe('3');

    const byElement = rollingNumber(makeHost('div'), { value: 4, target: other });
    expect(byElement.core!.getHost()).toBe(other);
    expect(digitsOf(other)).toBe('4');
  });

  it('a changed target destroys the core and creates one on the new target (without replaying `from`)', () => {
    const node = makeHost('div');
    const a = document.createElement('span');
    const b = document.createElement('span');
    node.append(a, b);

    const action = rollingNumber(node, { value: 3, from: 0, target: a });
    const first = action.core!;
    expect(getResolved(first).from).toBe(0);

    action.update({ value: 3, from: 0, target: a });
    expect(action.core).toBe(first);

    action.update({ value: 9, pad: 2, from: 0, target: b });
    expect(action.core).not.toBe(first);
    expect(action.core!.getHost()).toBe(b);
    expect(action.core!.getValue()).toBe(9);
    expect(getResolved(action.core!)).toMatchObject({ pad: 2, from: null });
    expect(digitsOf(b)).toBe('09');
    // The previous target is restored.
    expect(a.childNodes).toHaveLength(0);
    expect(a.hasAttribute('role')).toBe(false);
    expect(a.classList.contains('rn-rolling-number')).toBe(false);

    // Back to the node itself (target removed).
    action.update({ value: 9 });
    expect(action.core!.getHost()).toBe(node);
    expect(b.childNodes).toHaveLength(0);
  });

  it('a selector that matches nothing falls back to the node with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = makeHost('div');
    const action = rollingNumber(node, { value: 1, target: '.missing' });
    expect(action.core!.getHost()).toBe(node);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('.missing');
  });

  it('destroy() restores the host, nulls the core and is idempotent; update() afterwards is a no-op', () => {
    const host = makeHost();
    host.className = 'badge';
    const action = rollingNumber(host, 12);
    action.destroy();
    expect(action.core).toBeNull();
    expect(host.childNodes).toHaveLength(0);
    expect(host.className).toBe('badge');
    expect(host.hasAttribute('role')).toBe(false);
    expect(() => {
      action.destroy();
      action.update(5);
    }).not.toThrow();
    expect(action.core).toBeNull();
    expect(host.childNodes).toHaveLength(0);
    expect(raf.pending()).toBe(0);
  });

  it('animates value changes through the core and resolves through core.whenSettled()', async () => {
    const host = makeHost();
    const action = rollingNumber(host, { value: 0, duration: 1000 });
    const ends: number[] = [];
    host.addEventListener('rn-end', (e) => ends.push(e.detail.value));
    action.update({ value: 100, duration: 1000 });
    expect(host.getAttribute('data-rn-state')).toBe('animating');
    await settle(action.core);
    expect(digitsOf(host)).toBe('100');
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(ends).toEqual([100]);
  });
});
