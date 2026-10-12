import { describe, expect, it, vi } from 'vitest';
import type { Tickable } from '../../src/internal/contracts';
import { cancel, schedule } from '../../src/engine/ticker';
import { installRaf } from '../helpers';
import { createFakeView, recordingTickable } from '../helpers/ticker';

describe('ticker (j): phases', () => {
  it('runs read → write → flush → settled → post, over every scheduled Tickable', () => {
    const fv = createFakeView();
    const a = recordingTickable('A', fv.log);
    const b = recordingTickable('B', fv.log);
    schedule(fv.view, a);
    schedule(fv.view, b);
    expect(fv.requested()).toBe(1);
    fv.frame(16);
    expect(fv.log).toEqual([
      'A.read@16', 'B.read@16', 'A.write@16', 'B.write@16', 'flush', 'A.settled', 'B.settled', 'A.post', 'B.post'
    ]);
    expect(fv.flushes()).toBe(1);
    expect(fv.pending()).toBe(0);
  });

  it('flushes once, only in frames where some write returned true; settled() only for those', () => {
    const fv = createFakeView();
    const a = recordingTickable('A', fv.log, 3);
    const b = recordingTickable('B', fv.log, 1);
    schedule(fv.view, a);
    schedule(fv.view, b);
    fv.frame(0);
    expect(fv.log).toEqual(['A.read@0', 'B.read@0', 'A.write@0', 'B.write@0', 'flush', 'B.settled', 'A.post', 'B.post']);
    fv.log.length = 0;
    fv.frame(16);
    expect(fv.log).toEqual(['A.read@16', 'A.write@16', 'A.post']);
    fv.log.length = 0;
    fv.frame(32);
    expect(fv.log).toEqual(['A.read@32', 'A.write@32', 'flush', 'A.settled', 'A.post']);
    expect(fv.flushes()).toBe(2);
  });

  it('a Tickable stays scheduled until write() returns true', () => {
    const fv = createFakeView();
    const a = recordingTickable('A', fv.log, 4);
    schedule(fv.view, a);
    expect(fv.runAll(0, 16)).toBe(4);
    expect(a.writes).toBe(4);
    expect(fv.requested()).toBe(4);
    expect(fv.pending()).toBe(0);
    expect(fv.cancelled()).toBe(0);
  });

  it('passes the frame timestamp to read and write; Tickables without optional phases are fine', () => {
    const fv = createFakeView();
    const seen: number[] = [];
    const bare: Tickable = { write: (now) => (seen.push(now), seen.length === 2) };
    schedule(fv.view, bare);
    fv.frame(100);
    fv.frame(116.5);
    expect(seen).toEqual([100, 116.5]);
    expect(fv.pending()).toBe(0);
  });
});

describe('ticker (j): schedule and cancel', () => {
  it('re-scheduling an already scheduled Tickable neither cancels nor requests a frame', () => {
    const fv = createFakeView();
    const a = recordingTickable('A', fv.log, 3);
    schedule(fv.view, a);
    schedule(fv.view, a);
    expect(fv.requested()).toBe(1);
    fv.frame(0);
    expect(fv.requested()).toBe(2); // the loop requested its next frame
    schedule(fv.view, a); // retarget between frames
    expect(fv.requested()).toBe(2);
    expect(fv.cancelled()).toBe(0);
    expect(fv.pending()).toBe(1);
    fv.frame(16);
    expect(a.writes).toBe(2);
  });

  it('cancel() of the last Tickable cancels the pending frame', () => {
    const fv = createFakeView();
    const a = recordingTickable('A', fv.log, 5);
    const b = recordingTickable('B', fv.log, 5);
    schedule(fv.view, a);
    schedule(fv.view, b);
    cancel(fv.view, a);
    expect(fv.cancelled()).toBe(0);
    expect(fv.pending()).toBe(1);
    fv.frame(0);
    expect(a.writes).toBe(0);
    expect(b.writes).toBe(1);
    cancel(fv.view, b);
    expect(fv.cancelled()).toBe(1);
    expect(fv.pending()).toBe(0);
    // cancelling again, an unknown Tickable, or on an unknown view is a no-op
    cancel(fv.view, b);
    cancel(fv.view, recordingTickable('X', fv.log));
    cancel(createFakeView().view, b);
    expect(fv.cancelled()).toBe(1);
  });

  it('a Tickable cancelled during a frame gets no further calls in it', () => {
    const fv = createFakeView();
    const b = recordingTickable('B', fv.log, 1);
    const a = recordingTickable('A', fv.log, 2, { write: () => cancel(fv.view, b) });
    schedule(fv.view, a);
    schedule(fv.view, b);
    fv.frame(0);
    expect(fv.log).toEqual(['A.read@0', 'B.read@0', 'A.write@0', 'A.post']);
    expect(fv.pending()).toBe(1);
    fv.runAll(16);
    expect(b.writes).toBe(0);
  });

  it('cancelling itself in read skips its write and post; cancelling a settled one skips its post', () => {
    const fv = createFakeView();
    const self: Tickable = {
      read: () => cancel(fv.view, self),
      write: () => {
        fv.log.push('self.write');
        return true;
      },
      post: () => fv.log.push('self.post')
    };
    const a = recordingTickable('A', fv.log, 1);
    const c = recordingTickable('C', fv.log, 1, { settled: () => cancel(fv.view, a) });
    schedule(fv.view, self);
    schedule(fv.view, a);
    schedule(fv.view, c);
    fv.frame(0);
    expect(fv.log).toEqual(['A.read@0', 'C.read@0', 'A.write@0', 'C.write@0', 'flush', 'A.settled', 'C.settled', 'C.post']);
    expect(fv.pending()).toBe(0);
  });

  it('a Tickable scheduled during a frame runs from the next frame', () => {
    const fv = createFakeView();
    const c = recordingTickable('C', fv.log, 1);
    const a = recordingTickable('A', fv.log, 1, { post: () => schedule(fv.view, c) });
    schedule(fv.view, a);
    fv.frame(0);
    expect(fv.log).not.toContain('C.write@0');
    expect(fv.pending()).toBe(1);
    fv.frame(16);
    expect(fv.log).toContain('C.write@16');
    expect(fv.pending()).toBe(0);
  });

  it('a Tickable that settled can be re-scheduled in the same frame (its post still runs)', () => {
    const fv = createFakeView();
    let rescheduled = false;
    const a = recordingTickable('A', fv.log, 1);
    const b = recordingTickable('B', fv.log, 1, {
      write: () => {
        if (!rescheduled) {
          rescheduled = true;
          schedule(fv.view, a); // e.g. setValue from a handler: a new motion for A
        }
      }
    });
    schedule(fv.view, a);
    schedule(fv.view, b);
    fv.frame(0);
    expect(fv.log).toEqual(['A.read@0', 'B.read@0', 'A.write@0', 'B.write@0', 'flush', 'A.settled', 'B.settled', 'A.post', 'B.post']);
    expect(fv.pending()).toBe(1);
    fv.frame(16);
    expect(a.writes).toBe(2);
    expect(fv.pending()).toBe(0);
  });

  it('a Tickable re-scheduled in its own post runs again next frame', () => {
    const fv = createFakeView();
    let again = true;
    const a: Tickable & { writes: number } = recordingTickable('A', fv.log, 1, {
      post: () => {
        if (again) {
          again = false;
          schedule(fv.view, a);
        }
      }
    });
    schedule(fv.view, a);
    fv.runAll(0);
    expect(a.writes).toBe(2);
    expect(fv.pending()).toBe(0);
  });

  it('keeps one loop per Window', () => {
    const v1 = createFakeView();
    const v2 = createFakeView();
    const a = recordingTickable('A', v1.log, 1);
    const b = recordingTickable('B', v2.log, 1);
    schedule(v1.view, a);
    schedule(v2.view, b);
    expect(v1.requested()).toBe(1);
    expect(v2.requested()).toBe(1);
    v1.frame(0);
    expect(a.writes).toBe(1);
    expect(b.writes).toBe(0);
    v2.frame(0);
    expect(b.writes).toBe(1);
  });
});

describe('ticker (j): exceptions', () => {
  it.each(['read', 'write', 'settled', 'post'] as const)('a throwing %s drops that Tickable only', (phase) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fv = createFakeView();
    const boom = new Error(`boom in ${phase}`);
    const bad = recordingTickable('BAD', fv.log, phase === 'write' ? 1 : 2, {
      [phase]: () => {
        throw boom;
      }
    });
    const good = recordingTickable('GOOD', fv.log, 2);
    schedule(fv.view, bad);
    schedule(fv.view, good);
    fv.runAll(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toContain(boom);
    expect(good.writes).toBe(2);
    expect(fv.log).toContain('GOOD.settled');
    expect(fv.log.filter((e) => e === 'GOOD.post')).toHaveLength(2);
    // the failing Tickable got no more calls after its failure
    const failedAt = fv.log.findIndex((e) => e.startsWith(`BAD.${phase}`));
    expect(fv.log.slice(failedAt + 1).some((e) => e.startsWith('BAD.'))).toBe(false);
    expect(fv.pending()).toBe(0);
  });
});

describe('ticker (j): global window and test stubs', () => {
  it('uses window.requestAnimationFrame stubbed by installRaf() (happy-dom: defaultView === window)', () => {
    const raf = installRaf();
    const view = document.defaultView as Window;
    expect(view).toBe(window);
    const log: string[] = [];
    const a = recordingTickable('A', log, 2);
    schedule(view, a);
    expect(raf.pending()).toBe(1);
    expect(raf.requested()).toBe(1);
    raf.frame(0);
    expect(a.writes).toBe(1);
    expect(raf.pending()).toBe(1);
    raf.frame(16);
    expect(a.writes).toBe(2);
    expect(raf.pending()).toBe(0);

    const b = recordingTickable('B', log, 10);
    schedule(view, b);
    raf.frame(32);
    cancel(view, b); // destroy/finish
    expect(raf.pending()).toBe(0);
    expect(raf.cancelled()).toBe(1);
  });

  it('a frame pending on a replaced rAF stub is re-requested from the current one', () => {
    const raf1 = installRaf();
    const log: string[] = [];
    const a = recordingTickable('A', log, 1);
    schedule(window, a);
    expect(raf1.pending()).toBe(1);
    const raf2 = installRaf(); // e.g. a previous test left a motion pending
    const b = recordingTickable('B', log, 1);
    schedule(window, b);
    expect(raf2.pending()).toBe(1);
    raf2.frame(0);
    expect(a.writes).toBe(1);
    expect(b.writes).toBe(1);
    raf1.frame(16); // the stale frame does nothing
    expect(a.writes).toBe(1);
    expect(raf2.pending()).toBe(0);
  });

  it('zone.js: frames are requested and cancelled in Zone.root (outside Angular change detection)', () => {
    let depth = 0;
    vi.stubGlobal('Zone', {
      root: {
        run<T>(fn: () => T): T {
          depth++;
          try {
            return fn();
          } finally {
            depth--;
          }
        }
      }
    });
    const fv = createFakeView();
    const view = fv.view as unknown as {
      requestAnimationFrame(cb: FrameRequestCallback): number;
      cancelAnimationFrame(id: number): void;
    };
    const calls: string[] = [];
    const raf = view.requestAnimationFrame;
    const caf = view.cancelAnimationFrame;
    view.requestAnimationFrame = (cb) => (calls.push(`raf:${depth > 0}`), raf.call(view, cb));
    view.cancelAnimationFrame = (id) => (calls.push(`caf:${depth > 0}`), caf.call(view, id));
    const a = recordingTickable('A', fv.log, 3);
    schedule(fv.view, a);
    fv.frame(0); // the loop requests its next frame
    cancel(fv.view, a);
    expect(calls).toEqual(['raf:true', 'raf:true', 'caf:true']);
    expect(a.writes).toBe(1);
  });

  it('zone.js stand-ins without a usable Zone.root.run are ignored', () => {
    for (const zone of [{}, { root: null }, { root: { run: 1 } }]) {
      vi.stubGlobal('Zone', zone);
      const fv = createFakeView();
      const a = recordingTickable('A', fv.log, 2);
      schedule(fv.view, a);
      expect(fv.runAll(0)).toBe(2);
    }
  });

  it('falls back to setTimeout when the view has no requestAnimationFrame', () => {
    const timers: Array<() => void> = [];
    const view = {
      document: { documentElement: {} },
      getComputedStyle: () => ({ opacity: '1' }),
      performance: { now: () => 42 },
      setTimeout: (fn: () => void) => timers.push(fn),
      clearTimeout: () => {}
    } as unknown as Window;
    const seen: number[] = [];
    schedule(view, { write: (now) => (seen.push(now), true) });
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(seen).toEqual([42]);
  });
});
