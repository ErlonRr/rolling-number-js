import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingNumberCore } from '../src/core';
import type { RollingNumberEvent, RollingNumberSettled, RollingNumberUpdate } from '../src/types';
import { digitsOf, installRaf, makeHost, stubReducedMotion, type RafController } from './helpers';
import { recordEvents } from './helpers/core';
import { installIntersectionObserver, removeIntersectionObserver, type IoController } from './helpers/io';

// Promise and event rules shared by the WP0 core and the WP6 core
// (docs/design/v1.3.md §2.3, §2.4, §3.2). Rolls are avoided on purpose: they
// become JS-driven in WP6 (S3); `{ motion: 'none' }` is the instant change.

let raf: RafController;
const cores: RollingNumberCore[] = [];

function create(host: HTMLElement, options: RollingNumberUpdate = {}): RollingNumberCore {
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

// ── WP6: state machine, join rules, watchdog, trigger and intro (§8, §11 WP6) ──

describe('state machine (§8.1)', () => {
  it('idle → moving → idle: rn-end sees the final DOM without markers, promises resolve after it', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const order: string[] = [];
    let atEnd: unknown = null;
    host.addEventListener('rn-end', () => {
      order.push('rn-end');
      atEnd = {
        state: host.hasAttribute('data-rn-state'),
        cls: host.classList.contains('rn-interpolating'),
        digits: digitsOf(host),
        animating: core.isAnimating()
      };
    });
    const p = core.setValue(42).then((s) => {
      order.push('resolved');
      return s;
    });
    expect(core.isAnimating()).toBe(true);
    expect(host.getAttribute('data-rn-state')).toBe('animating');
    raf.runAll();
    expect(atEnd).toEqual({ state: false, cls: false, digits: '42', animating: false });
    expect(await p).toEqual({ value: 42, completed: true });
    expect(order).toEqual(['rn-end', 'resolved']);
  });

  it('isAnimating() is true while rolling (S3)', () => {
    const host = makeHost();
    const core = create(host, { value: 1 });
    void core.setValue(9, false);
    expect(core.isAnimating()).toBe(true);
    raf.frame(0);
    raf.frame(250);
    expect(core.isAnimating()).toBe(true);
    raf.frame(500);
    expect(core.isAnimating()).toBe(false);
  });

  it('rn-start carries the display value when the session started; retargets keep it until rn-end', () => {
    const host = makeHost();
    const core = create(host, { value: 10 });
    const log = recordEvents(host, true);
    void core.setValue(20);
    raf.frame(0);
    raf.frame(100);
    void core.setValue(-5);
    raf.runAll(116);
    expect(log).toEqual(['rn-start:20:true:from=10', 'rn-end:-5:true:from=10']);
  });

  it('two instant changes in the same task coalesce into one rn-start / rn-end pair', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host, true);
    const a = core.setValue(1, { motion: 'none' });
    const b = core.setValue(2, { motion: 'none' });
    expect(await a).toEqual({ value: 1, completed: false });
    expect(await b).toEqual({ value: 2, completed: true });
    expect(log).toEqual(['rn-start:2:false:from=0', 'rn-end:2:false:from=0']);
  });

  it('an instant change followed by an animated one in the same task: one session, rn-start on the first frame', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host, true);
    void core.setValue(5, { motion: 'none' });
    void core.setValue(50);
    await flush();
    expect(log).toEqual([]);
    raf.runAll();
    expect(log).toEqual(['rn-start:50:true:from=0', 'rn-end:50:true:from=0']);
  });

  it('calling setValue from an rn-start handler retargets safely', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    let chained: Promise<RollingNumberSettled> | null = null;
    host.addEventListener('rn-start', () => {
      chained = core.setValue(7);
    }, { once: true });
    const first = core.setValue(100);
    raf.runAll();
    expect(await first).toEqual({ value: 100, completed: false });
    expect(await chained!).toEqual({ value: 7, completed: true });
    expect(log).toEqual(['rn-start:100:true', 'rn-end:7:true']);
    expect(core.getDisplayValue()).toBe(7);
  });

  it('calling setValue from an rn-end handler starts a new session', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    host.addEventListener('rn-end', () => {
      if (core.getValue() === 3) void core.setValue(4);
    });
    void core.setValue(3);
    raf.runAll();
    expect(log).toEqual(['rn-start:3:true', 'rn-end:3:true', 'rn-start:4:true', 'rn-end:4:true']);
    expect(core.isAnimating()).toBe(false);
  });

  it('update() never dispatches synchronously: a layout change mid-motion finishes it, rn-end follows in a microtask', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    const p = core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    log.length = 0;
    core.update({ pad: 4 });
    expect(log).toEqual([]);
    expect(core.isAnimating()).toBe(false);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('0100');
    expect(await p).toEqual({ value: 100, completed: true });
    expect(log).toEqual(['rn-end:100:true']);
  });

  it('timing options apply to the next motion; label applies immediately', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    void core.setValue(100);
    raf.frame(0);
    core.update({ duration: 2000, easing: 'linear', interpolate: false, label: 'n={value}' });
    expect(core.isAnimating()).toBe(true);
    expect(host.getAttribute('aria-label')).toBe('n=100');
    raf.frame(400);
    expect(core.isAnimating()).toBe(false);
  });
});

describe('join rules (§8.2 step 2)', () => {
  it('the same target with true or the same kind joins: no extra events, same outcome', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    const a = core.setValue(100);
    raf.frame(0);
    const b = core.setValue(100, true);
    const c = core.setValue(100, {});
    expect(raf.pending()).toBe(1);
    raf.runAll(16);
    expect(await Promise.all([a, b, c])).toEqual([
      { value: 100, completed: true }, { value: 100, completed: true }, { value: 100, completed: true }
    ]);
    expect(log).toEqual(['rn-start:100:true', 'rn-end:100:true']);
  });

  it.each([
    ['{ motion: "none" }', { motion: 'none' as const }],
    ['{ duration: 0 }', { duration: 0 }]
  ])('an explicit instant request %s finishes: final DOM now, rn-end in a microtask, completed: true', async (_label, call) => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    const a = core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    const b = core.setValue(100, call);
    expect(core.isAnimating()).toBe(false);
    expect(raf.pending()).toBe(0);
    expect(digitsOf(host)).toBe('100');
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(log).toEqual(['rn-start:100:true']);
    expect(await b).toEqual({ value: 100, completed: true });
    expect(await a).toEqual({ value: 100, completed: true });
    expect(log).toEqual(['rn-start:100:true', 'rn-end:100:true']);
  });

  it('false while counting to the same target re-plans as a roll from the display (no new rn-start)', async () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    const log = recordEvents(host);
    const a = core.setValue(55);
    raf.frame(0);
    raf.frame(100);
    const b = core.setValue(55, false);
    // Roll path: surviving columns show the target digits synchronously.
    expect(host.querySelector('[data-rn-key="i0"]')!.getAttribute('data-digit')).toBe('5');
    expect(host.querySelector('[data-rn-key="i1"]')!.getAttribute('data-digit')).toBe('5');
    expect(core.isAnimating()).toBe(true);
    raf.frame(200); // first frame of the roll
    raf.frame(699);
    expect(core.isAnimating()).toBe(true); // a roll lasts 500 ms
    raf.frame(700);
    expect(core.isAnimating()).toBe(false);
    expect(await a).toEqual({ value: 55, completed: true });
    expect(await b).toEqual({ value: 55, completed: true });
    expect(log).toEqual(['rn-start:55:true', 'rn-end:55:true']);
  });

  it('an explicit duration/easing re-plans with them (an explicit easing carries no velocity)', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    void core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    const shown = core.getDisplayValue();
    void core.setValue(100, { duration: 1000, easing: 'linear' });
    raf.frame(200); // first frame of the new plan
    raf.frame(700);
    expect(core.getDisplayValue()).toBeCloseTo(shown + (100 - shown) / 2, 6);
    raf.frame(1199);
    expect(core.isAnimating()).toBe(true);
    raf.frame(1200);
    expect(core.isAnimating()).toBe(false);
    expect(digitsOf(host)).toBe('100');
  });

  it('an explicit duration on a count → count re-plan keeps the velocity (§5.6 may shorten it)', () => {
    const host = makeHost();
    const core = create(host, { value: 0 });
    void core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    void core.setValue(100, { duration: 1000 });
    raf.frame(200);
    raf.frame(216);
    expect(core.getDisplayValue()).toBeGreaterThan(57.8); // still moving forward on the next frame
    raf.frame(599);
    expect(core.isAnimating()).toBe(true);
    raf.frame(600); // D' = max(0.4 · 1000, 3 · ΔA / v) = 400
    expect(core.isAnimating()).toBe(false);
  });
});

describe('watchdog (§8.2 step 7)', () => {
  it('finishes a motion whose frames never come after D + 1 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const host = makeHost();
      const core = create(host, { value: 0 });
      const log = recordEvents(host);
      const p = core.setValue(100);
      vi.advanceTimersByTime(1399);
      expect(core.isAnimating()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(core.isAnimating()).toBe(false);
      expect(raf.pending()).toBe(0);
      expect(digitsOf(host)).toBe('100');
      expect(log).toEqual(['rn-start:100:false', 'rn-end:100:false']);
      expect(await p).toEqual({ value: 100, completed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is re-armed with the CSS duration in the first frame and cleared on settle', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const host = makeHost();
      host.style.setProperty('--rn-duration', '5s');
      const core = create(host, { value: 0 });
      void core.setValue(9, false);
      raf.frame(0);
      vi.advanceTimersByTime(2000);
      expect(core.isAnimating()).toBe(true);
      raf.frame(5000);
      expect(core.isAnimating()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('trigger: "visible" and the from intro (§8.3)', () => {
  let io: IoController;
  beforeEach(() => {
    io = installIntersectionObserver();
  });

  it('waits before the first IO callback: label now, display frozen, no frames, pending promise', async () => {
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    const log = recordEvents(host);
    let settled: RollingNumberSettled | null = null;
    void core.setValue(50).then((s) => (settled = s));
    expect(host.getAttribute('aria-label')).toBe('50');
    expect(digitsOf(host)).toBe('0');
    expect(raf.pending()).toBe(0);
    expect(core.isAnimating()).toBe(false);
    await flush();
    expect(settled).toBeNull();
    expect(log).toEqual([]);

    io.intersect(host, 0.1); // below the 25% threshold
    expect(raf.pending()).toBe(0);
    io.intersect(host, 1);
    expect(core.isAnimating()).toBe(true);
    raf.runAll();
    await flush();
    expect(settled).toEqual({ value: 50, completed: true });
    expect(log).toEqual(['rn-start:50:true', 'rn-end:50:true']);
    expect(digitsOf(host)).toBe('50');
  });

  it('animates from the display to the latest target once visible', async () => {
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    const log = recordEvents(host, true);
    const a = core.setValue(10);
    const b = core.setValue(20);
    io.intersect(host, 1);
    raf.runAll();
    expect(await a).toEqual({ value: 10, completed: false });
    expect(await b).toEqual({ value: 20, completed: true });
    expect(log).toEqual(['rn-start:20:true:from=0', 'rn-end:20:true:from=0']);
  });

  it('a change while off-screen mid-motion freezes the display until visible again', () => {
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    io.intersect(host, 1);
    void core.setValue(100);
    raf.frame(0);
    raf.frame(100);
    const frozen = core.getDisplayValue();
    io.intersect(host, 0);
    void core.setValue(200);
    expect(core.isAnimating()).toBe(false);
    expect(raf.pending()).toBe(0);
    expect(host.hasAttribute('data-rn-state')).toBe(false);
    expect(core.getDisplayValue()).toBe(frozen);
    io.intersect(host, 1);
    raf.runAll(200);
    expect(digitsOf(host)).toBe('200');
  });

  it('whenSettled() and finish() while waiting; update({ trigger: "immediate" }) starts a waiting change', async () => {
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    void core.setValue(5);
    const waiting = core.whenSettled();
    core.finish();
    expect(digitsOf(host)).toBe('5');
    expect(await waiting).toEqual({ value: 5, completed: true });

    void core.setValue(6);
    expect(core.isAnimating()).toBe(false);
    core.update({ trigger: 'immediate' });
    expect(core.isAnimating()).toBe(true);
    expect(io.observed(host)).toBe(false);
    raf.runAll();
    expect(digitsOf(host)).toBe('6');
  });

  it('destroy() while waiting resolves completed: false and stops observing', async () => {
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    expect(io.observed(host)).toBe(true);
    const p = core.setValue(5);
    core.destroy();
    expect(await p).toEqual({ value: 5, completed: false });
    expect(io.observed(host)).toBe(false);
  });

  it('without IntersectionObserver the host counts as visible', () => {
    removeIntersectionObserver();
    const host = makeHost();
    const core = create(host, { value: 0, trigger: 'visible' });
    void core.setValue(3);
    expect(core.isAnimating()).toBe(true);
  });

  it('from: the first paint shows `from` without events, then counts to `value`', () => {
    const host = makeHost();
    const log = recordEvents(host, true);
    const core = create(host, { value: 100, from: 0 });
    expect(core.getDisplayValue()).toBe(0);
    expect(host.getAttribute('aria-label')).toBe('100');
    expect(core.isAnimating()).toBe(true);
    expect(log).toEqual([]);
    raf.runAll();
    expect(digitsOf(host)).toBe('100');
    expect(log).toEqual(['rn-start:100:true:from=0', 'rn-end:100:true:from=0']);
  });

  it('from: no intro under reduced motion or when from equals value', async () => {
    const a = makeHost();
    const log = recordEvents(a);
    create(a, { value: 5, from: 5 });
    stubReducedMotion(true);
    const b = makeHost();
    recordEvents(b);
    b.addEventListener('rn-start', () => log.push('b'));
    create(b, { value: 5, from: 0 });
    expect(digitsOf(b)).toBe('5');
    await flush();
    expect(log).toEqual([]);
    expect(raf.pending()).toBe(0);
  });

  it('from with trigger "visible": the intro waits for visibility', () => {
    const host = makeHost();
    const core = create(host, { value: 100, from: 0, trigger: 'visible' });
    expect(core.getDisplayValue()).toBe(0);
    expect(raf.pending()).toBe(0);
    io.intersect(host, 1);
    raf.runAll();
    expect(digitsOf(host)).toBe('100');
  });

  it('from with an adopted [data-rn-ssr] fallback: no intro (server content never regresses)', async () => {
    const host = makeHost();
    const fallback = document.createElement('span');
    fallback.className = 'rn-ssr';
    fallback.setAttribute('data-rn-ssr', '');
    fallback.textContent = '100';
    host.appendChild(fallback);
    const log = recordEvents(host);
    const core = create(host, { value: 100, from: 0 });
    expect(digitsOf(host)).toBe('100');
    expect(fallback.hasAttribute('hidden')).toBe(true);
    expect(raf.pending()).toBe(0);
    await flush();
    expect(log).toEqual([]);
    core.destroy();
    expect(fallback.hasAttribute('hidden')).toBe(false);
    expect(Array.from(host.childNodes)).toEqual([fallback]);
  });

  it('from with an adopted fallback and trigger "visible" before visibility: the intro runs on visibility', () => {
    const host = makeHost();
    const fallback = document.createElement('span');
    fallback.setAttribute('data-rn-ssr', '');
    host.appendChild(fallback);
    const core = create(host, { value: 100, from: 0, trigger: 'visible' });
    expect(core.getDisplayValue()).toBe(0);
    io.intersect(host, 1);
    expect(core.isAnimating()).toBe(true);
    raf.runAll();
    expect(digitsOf(host)).toBe('100');
  });
});
