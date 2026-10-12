/**
 * Shared per-window requestAnimationFrame loop with read → write → flush →
 * settled → post phases (docs/design/v1.3.md §5.9, §3.3). Owned by WP1.
 *
 * - One rAF loop per Window; a Tickable stays scheduled until its `write()`
 *   returns true or it is cancelled.
 * - Re-scheduling an already scheduled Tickable is a no-op (no cancel, no new
 *   frame). Cancelling the last Tickable cancels the pending frame.
 * - Phases of a frame run over the Tickables scheduled when the frame began;
 *   a Tickable cancelled during the frame gets no further calls in it, one
 *   scheduled during the frame runs from the next frame.
 * - An exception in one Tickable is reported with `console.error` and drops
 *   that Tickable; the others keep running.
 *
 * `view.requestAnimationFrame` is read at request time (never cached), so a
 * test stub installed with `vi.stubGlobal` is honored: in vitest's happy-dom
 * environment `document.defaultView === window === globalThis`. When the rAF
 * implementation changes while a frame is pending (a stub swapped between
 * tests), the next `schedule` requests a new frame from the current one and
 * the stale frame is ignored.
 *
 * @internal
 * @module
 */
import type { Tickable } from '../internal/contracts';

type RafFn = (cb: FrameRequestCallback) => number;

interface Loop {
  readonly view: Window;
  /** Tickables to run on the next frame. */
  readonly items: Set<Tickable>;
  /** Identity of the pending frame (null: none). A frame callback whose token is stale does nothing. */
  token: object | null;
  /** Handle of the pending frame. */
  id: number;
  /** The function the pending frame was requested with (`null`: setTimeout fallback). */
  req: RafFn | null;
  /** A frame is running (requests are deferred to its end). */
  running: boolean;
}

const loops = new WeakMap<Window, Loop>();
/**
 * Cancel generation per Tickable: bumped by cancel() and by a failure, so a
 * Tickable cancelled mid-frame (even if re-scheduled) gets no more calls in
 * that frame.
 */
const generations = new WeakMap<Tickable, number>();

const genOf = (t: Tickable): number => generations.get(t) ?? 0;

function loopOf(view: Window): Loop {
  let loop = loops.get(view);
  if (!loop) {
    loop = { view, items: new Set(), token: null, id: 0, req: null, running: false };
    loops.set(view, loop);
  }
  return loop;
}

function currentRaf(view: Window): RafFn | null {
  const raf = (view as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  return typeof raf === 'function' ? (raf as RafFn) : null;
}

function nowOf(view: Window): number {
  const perf = (view as { performance?: Performance }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/** Requests a frame unless one is pending with the current rAF implementation. */
function request(loop: Loop): void {
  const view = loop.view;
  const raf = currentRaf(view);
  if (loop.token !== null && loop.req === raf) return;
  const token = {};
  loop.token = token;
  loop.req = raf;
  const cb = (now: number): void => runFrame(loop, token, now);
  try {
    if (raf) {
      loop.id = raf.call(view, cb);
    } else {
      // No rAF (the core treats such changes as instant; this only keeps a stray schedule alive).
      const tick = (): void => cb(nowOf(view));
      loop.id = (typeof view.setTimeout === 'function' ? view.setTimeout(tick, 16) : setTimeout(tick, 16)) as unknown as number;
    }
  } catch (err) {
    // Leave no dead pending frame behind: the next schedule() retries.
    loop.token = null;
    loop.req = null;
    throw err;
  }
}

function cancelPending(loop: Loop): void {
  if (loop.token === null) return;
  const view = loop.view;
  const id = loop.id;
  const viaRaf = loop.req !== null;
  loop.token = null;
  loop.req = null;
  loop.id = 0;
  try {
    if (viaRaf) {
      const caf = (view as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
      if (typeof caf === 'function') (caf as (id: number) => void).call(view, id);
    } else if (typeof view.clearTimeout === 'function') {
      view.clearTimeout(id);
    } else {
      clearTimeout(id);
    }
  } catch {
    // The stale frame is ignored anyway (token check).
  }
}

function fail(loop: Loop, t: Tickable, err: unknown): void {
  loop.items.delete(t);
  generations.set(t, genOf(t) + 1);
  console.error('[RollingNumber] An animation frame callback threw; that counter stops animating.', err);
}

function runFrame(loop: Loop, token: object, now: number): void {
  if (loop.token !== token) return;
  loop.token = null;
  loop.req = null;
  loop.id = 0;
  loop.running = true;
  try {
    const list = Array.from(loop.items);
    const gens = list.map(genOf);
    const alive = (i: number): boolean => genOf(list[i]) === gens[i];

    // 1. read
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!alive(i) || !t.read) continue;
      try {
        t.read(now);
      } catch (err) {
        fail(loop, t, err);
      }
    }
    // 2. write
    const settled: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!alive(i)) continue;
      try {
        if (t.write(now)) {
          loop.items.delete(t);
          settled.push(i);
        }
      } catch (err) {
        fail(loop, t, err);
      }
    }
    // 3. flush: one style read for the whole frame, only when something settled.
    if (settled.length > 0) {
      try {
        const view = loop.view;
        const root = view.document && view.document.documentElement;
        if (root && typeof view.getComputedStyle === 'function') void view.getComputedStyle(root).opacity;
      } catch {
        // A detached window has nothing to flush.
      }
    }
    // 4. settled
    for (const i of settled) {
      const t = list[i];
      if (!alive(i) || !t.settled) continue;
      try {
        t.settled();
      } catch (err) {
        fail(loop, t, err);
      }
    }
    // 5. post
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!alive(i) || !t.post) continue;
      try {
        t.post();
      } catch (err) {
        fail(loop, t, err);
      }
    }
  } finally {
    loop.running = false;
    if (loop.items.size > 0) request(loop);
  }
}

/** Schedules `t` on the window's loop (no-op when already scheduled). */
export function schedule(view: Window, t: Tickable): void {
  const loop = loopOf(view);
  if (loop.items.has(t)) {
    // Already scheduled: neither cancel nor request, except to replace a frame
    // pending on a rAF implementation that is no longer installed.
    if (!loop.running && loop.token !== null && loop.req !== currentRaf(view)) request(loop);
    return;
  }
  loop.items.add(t);
  if (!loop.running) request(loop);
}

/**
 * Removes `t`; cancels the pending frame when it was the last one. Called
 * during a frame (even from `t`'s own hooks), `t` gets no further calls in
 * that frame, `post()` included.
 */
export function cancel(view: Window, t: Tickable): void {
  const loop = loops.get(view);
  generations.set(t, genOf(t) + 1);
  if (!loop) return;
  loop.items.delete(t);
  if (loop.items.size === 0) cancelPending(loop);
}
