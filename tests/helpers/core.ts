import { expect } from 'vitest';

/** Records `rn-start` / `rn-end` on `target` as "type:value:animated" (plus `from` when `withFrom`). */
export function recordEvents(target: EventTarget, withFrom = false): string[] {
  const log: string[] = [];
  for (const type of ['rn-start', 'rn-end'] as const) {
    target.addEventListener(type, (e) => {
      const d = (e as CustomEvent<{ value: number; from: number; animated: boolean }>).detail;
      log.push(`${e.type}:${d.value}:${d.animated}` + (withFrom ? `:from=${d.from}` : ''));
    });
  }
  return log;
}

/** Lets pending microtasks and 0 ms timeouts run (real timers). */
export const flushTasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Lets pending microtasks run (works under fake timers). */
export const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Owned nodes of a columns host (every child carrying `data-rn-key`), in DOM order. */
export function ownedNodes(host: Element): HTMLElement[] {
  return Array.from(host.children).filter((el): el is HTMLElement => el.hasAttribute('data-rn-key'));
}

/** What a columns host shows: sign/static text and each column's `data-digit`, in DOM order (e.g. "−1,234+"). */
export function shownText(host: Element): string {
  return ownedNodes(host)
    .map((el) => (el.classList.contains('rn-col') ? el.getAttribute('data-digit') : el.textContent))
    .join('');
}

/** Asserts the rest invariants: no inline styles, enter/leave or lead markers, transforms, or animating markers. */
export function expectAtRest(host: Element): void {
  expect(host.hasAttribute('data-rn-state')).toBe(false);
  expect(host.classList.contains('rn-interpolating')).toBe(false);
  expect(host.querySelector('[style], [data-rn-in], [data-rn-lead]')).toBeNull();
  for (const col of Array.from(host.querySelectorAll(':scope > .rn-col'))) {
    expect(col.querySelector('.rn-sizer')!.textContent).toBe(col.getAttribute('data-digit'));
  }
}

const TRANSFORM = /translateY\((-?[\d.]+)%\)/;

/** Position (cells, [0, 10)) of every column by key: the inline transform while moving, else `data-digit`. */
export function columnPositions(host: Element): Map<string, number> {
  const out = new Map<string, number>();
  for (const col of Array.from(host.querySelectorAll<HTMLElement>(':scope > .rn-col'))) {
    const scale = col.querySelector<HTMLElement>('.rn-scale')!;
    const m = TRANSFORM.exec(scale.style.getPropertyValue('transform'));
    out.set(col.getAttribute('data-rn-key')!, m ? -Number(m[1]) / 10 : Number(col.getAttribute('data-digit')));
  }
  return out;
}

/** Largest per-column step (cells, the short way around) between two position maps. */
export function maxStep(a: Map<string, number>, b: Map<string, number>): number {
  let max = 0;
  for (const [key, p1] of b) {
    const p0 = a.get(key);
    if (p0 === undefined) continue;
    const d = Math.abs(((((p1 - p0 + 5) % 10) + 10) % 10) - 5);
    if (d > max) max = d;
  }
  return max;
}
