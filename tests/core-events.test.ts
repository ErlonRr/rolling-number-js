import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RollingNumberCore } from '../src/core';
import type { RollingNumberEvent, RollingNumberSettled } from '../src/types';
import { installRaf, makeHost, stubReducedMotion, type RafController } from './helpers';

// Promise and event rules shared by the WP0 core and the WP6 core
// (docs/design/v1.3.md §2.3, §2.4, §3.2). Rolls are avoided on purpose: they
// become JS-driven in WP6 (S3); `{ motion: 'none' }` is the instant change.

let raf: RafController;
const cores: RollingNumberCore[] = [];

function create(host: HTMLElement, options = {}): RollingNumberCore {
  const core = new RollingNumberCore(host, options);
  cores.push(core);
  return core;
}

/** Records rn-start / rn-end on `host` as "type:value:animated". */
function record(host: Element): string[] {
  const log: string[] = [];
  for (const type of ['rn-start', 'rn-end'] as const) {
    host.addEventListener(type, (e) => {
      log.push(`${e.type}:${e.detail.value}:${e.detail.animated}`);
    });
  }
  return log;
}

/** Lets pending microtasks (instant events, promise reactions) run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  raf = installRaf();
  stubReducedMotion(false);
});

afterEach(() => {
  for (const core of cores.splice(0)) core.destroy();
  document.body.replaceChildren();
});

describe('events and promises', () => {
  it('the initial render dispatches nothing', async () => {
    const host = makeHost();
    const log = record(host);
    create(host, { value: 5 });
    await flush();
    expect(log).toEqual([]);
  });

  it('an instant change dispatches rn-start then rn-end in a microtask, then resolves', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    const settled: RollingNumberSettled[] = [];
    const p = core.setValue(42, { motion: 'none' }).then((s) => {
      settled.push(s);
      log.push('resolved');
    });
    expect(log).toEqual([]); // not synchronous
    expect(host.getAttribute('aria-label')).toBe('42');
    await p;
    expect(log).toEqual(['rn-start:42:false', 'rn-end:42:false', 'resolved']);
    expect(settled).toEqual([{ value: 42, completed: true }]);
    expect(raf.pending()).toBe(0);
  });

  it('an animated change dispatches rn-start on the first frame and rn-end after the last one', async () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: 400 });
    const log = record(host);
    let result: RollingNumberSettled | null = null;
    void core.setValue(100).then((s) => {
      result = s;
    });
    expect(log).toEqual([]);
    raf.frame(0);
    expect(log).toEqual(['rn-start:100:true']);
    raf.frame(200);
    expect(log).toEqual(['rn-start:100:true']);
    raf.frame(400);
    expect(log).toEqual(['rn-start:100:true', 'rn-end:100:true']);
    expect(core.isAnimating()).toBe(false);
    await flush();
    expect(result).toEqual({ value: 100, completed: true });
  });

  it('events bubble, are composed and carry from/value', () => {
    const host = makeHost();
    const core = create(host, { value: 10 });
    const seen: RollingNumberEvent[] = [];
    document.body.addEventListener('rn-start', (e) => seen.push(e));
    void core.setValue(20);
    raf.frame(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].composed).toBe(true);
    expect(seen[0].detail).toEqual({ value: 20, from: 10, animated: true });
  });

  it('a superseding target resolves the previous promise with completed: false; rn-start is not re-fired', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    const first = core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    const second = core.setValue(50);
    raf.runAll(116);
    expect(await first).toEqual({ value: 100, completed: false });
    expect(await second).toEqual({ value: 50, completed: true });
    expect(log).toEqual(['rn-start:100:true', 'rn-end:50:true']);
  });

  it('setting the target already in flight joins the motion (same outcome, no extra events)', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    const a = core.setValue(100);
    raf.frame(0);
    const b = core.setValue(100);
    raf.runAll(16);
    expect(await a).toEqual({ value: 100, completed: true });
    expect(await b).toEqual({ value: 100, completed: true });
    expect(log).toEqual(['rn-start:100:true', 'rn-end:100:true']);
  });

  it('setting the value already displayed resolves at once without events', async () => {
    const host = makeHost();
    const core = create(host, { value: 7 });
    const log = record(host);
    expect(await core.setValue(7)).toEqual({ value: 7, completed: true });
    await flush();
    expect(log).toEqual([]);
  });

  it('whenSettled resolves at once when idle, and with the motion otherwise', async () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    expect(await core.whenSettled()).toEqual({ value: 1, completed: true });
    void core.setValue(9);
    const waiting = core.whenSettled();
    raf.runAll();
    expect(await waiting).toEqual({ value: 9, completed: true });
  });

  it('finish() jumps to the target, dispatches rn-end and resolves; no-op when idle', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    core.finish();
    expect(log).toEqual([]);
    const p = core.setValue(300);
    raf.frame(0);
    raf.frame(50);
    core.finish();
    expect(core.isAnimating()).toBe(false);
    expect(core.getDisplayValue()).toBe(300);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(log).toEqual(['rn-start:300:true', 'rn-end:300:true']);
    expect(await p).toEqual({ value: 300, completed: true });
    expect(raf.pending()).toBe(0);
  });

  it('destroy() resolves pending promises with completed: false and dispatches nothing', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    const p = core.setValue(100);
    raf.frame(0);
    log.length = 0;
    core.destroy();
    expect(await p).toEqual({ value: 100, completed: false });
    expect(await core.setValue(5)).toEqual({ value: 5, completed: false });
    await flush();
    expect(log).toEqual([]);
    expect(raf.pending()).toBe(0);
  });

  it('reduced motion: both events fire with animated: false', async () => {
    stubReducedMotion(true);
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = record(host);
    expect(await core.setValue(12)).toEqual({ value: 12, completed: true });
    expect(log).toEqual(['rn-start:12:false', 'rn-end:12:false']);
    expect(raf.requested()).toBe(0);
  });

  it('calling setValue from an rn-end handler is safe', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    let chained: Promise<RollingNumberSettled> | null = null;
    host.addEventListener('rn-end', () => {
      if (!chained) chained = core.setValue(2, { motion: 'none' });
    }, { once: true });
    const first = core.setValue(1, { motion: 'none' });
    expect(await first).toEqual({ value: 1, completed: true });
    expect(chained).not.toBeNull();
    expect(await chained!).toEqual({ value: 2, completed: true });
    expect(core.getValue()).toBe(2);
  });
});

describe('1.3 accessors', () => {
  it('getText, getMode, getHost, getDisplayValue', () => {
    const host = makeHost();
    const core = create(host, { value: -7, pad: 3 });
    expect(core.getText()).toBe('-007');
    expect(core.getMode()).toBe('columns');
    expect(core.getHost()).toBe(host);
    expect(core.getDisplayValue()).toBe(-7);
    core.update({ max: 5, overflowSuffix: '+', prefixText: '≈', suffixText: ' pts' });
    expect(core.getText()).toBe('≈-005+ pts');
    expect(core.getDisplayValue()).toBe(-5);
  });

  it('update({ duration: null }) and setDuration(null) reset to unset (S2)', () => {
    const host = makeHost();
    const core = create(host, { value: 0, duration: 900 });
    core.update({ duration: null });
    void core.setValue(10);
    raf.frame(0);
    raf.frame(399);
    expect(core.isAnimating()).toBe(true);
    raf.frame(400);
    expect(core.isAnimating()).toBe(false);
    core.setDuration(1000);
    core.setDuration(null);
    void core.setValue(20);
    raf.frame(1000);
    raf.frame(1400);
    expect(core.isAnimating()).toBe(false);
  });
});
