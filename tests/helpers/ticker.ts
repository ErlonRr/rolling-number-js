import type { Tickable } from '../../src/internal/contracts';

/**
 * A minimal Window stand-in for the shared ticker (`src/engine/ticker.ts`):
 * its own rAF queue (frames run only when the test calls `frame`), a
 * `getComputedStyle` that records style flushes, and a `log` shared with
 * {@link recordingTickable}. Independent of the global window, so ticker
 * tests never interfere with counters on `window`.
 */
export interface FakeView {
  /** Pass to `schedule(view, t)` / `cancel(view, t)`. */
  readonly view: Window;
  /** Runs the queued frame callbacks with timestamp `time`. */
  frame(time: number): void;
  /** Runs frames every `step` ms from `start` until no frame is queued; returns the frame count. */
  runAll(start?: number, step?: number, maxFrames?: number): number;
  /** Number of queued frame callbacks. */
  pending(): number;
  /** Total requestAnimationFrame calls. */
  requested(): number;
  /** Total cancelAnimationFrame calls. */
  cancelled(): number;
  /** Number of `getComputedStyle(documentElement).opacity` reads (style flushes). */
  flushes(): number;
  /** Event log: `'flush'` entries plus whatever recording tickables push. */
  readonly log: string[];
}

export function createFakeView(): FakeView {
  let nextId = 0;
  let requested = 0;
  let cancelled = 0;
  let flushes = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const log: string[] = [];
  const documentElement = { nodeType: 1 };
  const view = {
    document: { documentElement },
    requestAnimationFrame(cb: FrameRequestCallback): number {
      requested++;
      queue.set(++nextId, cb);
      return nextId;
    },
    cancelAnimationFrame(id: number): void {
      cancelled++;
      queue.delete(id);
    },
    getComputedStyle(el: unknown) {
      return {
        get opacity(): string {
          if (el === documentElement) {
            flushes++;
            log.push('flush');
          }
          return '1';
        }
      };
    },
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout
  } as unknown as Window;

  const frame = (time: number): void => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const cb of callbacks) cb(time);
  };

  return {
    view,
    frame,
    runAll(start = 0, step = 16, maxFrames = 10_000) {
      let t = start;
      let frames = 0;
      while (queue.size > 0) {
        if (++frames > maxFrames) throw new Error('runAll: ticker never settled');
        frame(t);
        t += step;
      }
      return frames;
    },
    pending: () => queue.size,
    requested: () => requested,
    cancelled: () => cancelled,
    flushes: () => flushes,
    log
  };
}

/**
 * A Tickable that pushes `name.phase@time` entries to `log` and settles
 * (write returns true) on its `settleAfter`-th write. Hooks run inside the
 * phase, after logging.
 */
export function recordingTickable(
  name: string,
  log: string[],
  settleAfter = 1,
  hooks: Partial<Record<'read' | 'write' | 'settled' | 'post', (now: number) => void>> = {}
): Tickable & { writes: number } {
  let last = 0;
  const t = {
    writes: 0,
    read(now: number) {
      last = now;
      log.push(`${name}.read@${now}`);
      hooks.read?.(now);
    },
    write(now: number) {
      t.writes++;
      log.push(`${name}.write@${now}`);
      hooks.write?.(now);
      return t.writes >= settleAfter;
    },
    settled() {
      log.push(`${name}.settled`);
      hooks.settled?.(last);
    },
    post() {
      log.push(`${name}.post`);
      hooks.post?.(last);
    }
  };
  return t;
}
