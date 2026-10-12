import { vi } from 'vitest';
import type { RollingNumberCore } from '../src/core';

/**
 * Manual requestAnimationFrame stub: frames only run when the test calls
 * `frame(time)`, with the timestamp it chooses. Restored by `unstubGlobals`.
 */
export interface RafController {
  /** Runs every callback queued so far with the given timestamp. */
  frame(time: number): void;
  /** Number of callbacks currently queued. */
  pending(): number;
  /** Runs frames every `step` ms (starting at `start`) until the queue is empty. */
  runAll(start?: number, step?: number, maxFrames?: number): number;
  /** Total requestAnimationFrame calls. */
  requested(): number;
  /** Total cancelAnimationFrame calls. */
  cancelled(): number;
}

export function installRaf(): RafController {
  let nextId = 0;
  let requested = 0;
  let cancelled = 0;
  const queue = new Map<number, FrameRequestCallback>();

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    requested++;
    nextId++;
    queue.set(nextId, cb);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    cancelled++;
    queue.delete(id);
  });

  const frame = (time: number): void => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const cb of callbacks) cb(time);
  };

  return {
    frame,
    pending: () => queue.size,
    runAll(start = 0, step = 16, maxFrames = 10_000) {
      let t = start;
      let frames = 0;
      while (queue.size > 0) {
        if (++frames > maxFrames) throw new Error('runAll: animation never settled');
        frame(t);
        t += step;
      }
      return frames;
    },
    requested: () => requested,
    cancelled: () => cancelled
  };
}

/** Stubs `matchMedia` so that `(prefers-reduced-motion: reduce)` matches (or not). */
export function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false
  }));
}

/** Digits currently rendered in `host` (from the `data-digit` of each owned column). */
export function digitsOf(host: Element): string {
  return Array.from(host.querySelectorAll(':scope > .rn-col'))
    .map((col) => col.getAttribute('data-digit'))
    .join('');
}

/** Rendered text as a reader sees it: sign + digits (e.g. "-042"). */
export function displayOf(host: Element): string {
  return (host.querySelector(':scope > .rn-sign') ? '-' : '') + digitsOf(host);
}

/** Creates a host element attached to the document. */
export function makeHost(tag = 'span', parent: Element = document.body): HTMLElement {
  const el = document.createElement(tag);
  parent.appendChild(el);
  return el;
}

/** Loosely typed cast for tests that deliberately pass invalid input. */
export function loose<T>(value: unknown): T {
  return value as T;
}

/** Narrow helper so tests can read private state only through the public API. */
export function state(core: RollingNumberCore) {
  return { value: core.getValue(), animating: core.isAnimating(), el: core.getElement() };
}
