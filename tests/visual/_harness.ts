/**
 * Helpers for the Playwright visual suite (docs/design/v1.3.md §11 WP11).
 * Owned by WP5; the specs (tests/visual/*.spec.ts) are WP11's.
 *
 * Every motion in 1.3 is driven by requestAnimationFrame, so `page.clock`
 * drives every pixel: install the clock before navigating, freeze it, then
 * step 16 ms frames and read the inline state the core writes.
 *
 * @example
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { gotoFrozen, recordEvents, readColumns, stepFrames } from './_harness';
 *
 * test('99 → 100', async ({ page }) => {
 *   await gotoFrozen(page, '/');
 *   const host = page.locator('#counter');
 *   const events = await recordEvents(host);
 *   await host.evaluate((el) => (el as HTMLElement & { value: number }).value = 100);
 *   await stepFrames(page, 3);
 *   const cols = await readColumns(host);         // inline transforms mid-roll
 *   const end = await events.waitForEnd(page);    // steps until rn-end
 *   expect(end.value).toBe(100);
 * });
 * ```
 *
 * Note: with the clock paused, prefer `locator.evaluate` + `stepFrames` over
 * in-page waits based on timers or animation frames (they only run when the
 * clock is advanced). `expect.poll` and `expect(locator)` poll from Node.
 */
import type { Locator, Page } from '@playwright/test';
import type { RollingNumberEventDetail } from '../../src/types';

/** Duration of one animation frame under the fake clock (ms). */
export const FRAME_MS = 16;

/** Installs `page.clock` at `t0` (ms since the epoch). Call before `page.goto`. */
export async function installClock(page: Page, t0 = 0): Promise<void> {
  await page.clock.install({ time: t0 });
}

/**
 * Installs the clock, navigates, then freezes time `settleMs` later (load-time
 * timers and frames up to then have run). From then on nothing runs until
 * {@link stepFrames} or `page.clock.runFor`.
 */
export async function gotoFrozen(page: Page, url: string, options: { t0?: number; settleMs?: number } = {}): Promise<void> {
  const { t0 = 0, settleMs = 500 } = options;
  await installClock(page, t0);
  await page.goto(url);
  // Time flows naturally until paused: pause relative to the page's current fake time.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + settleMs);
}

/** Waits until `<tag>` is defined (microtask-based, works with a paused clock). */
export async function whenDefined(page: Page, tag = 'rolling-number'): Promise<void> {
  await page.evaluate((name) => customElements.whenDefined(name).then(() => undefined), tag);
}

/** Advances the paused clock by `frames` animation frames, one frame (`frameMs`) at a time. */
export async function stepFrames(page: Page, frames = 1, frameMs = FRAME_MS): Promise<void> {
  for (let i = 0; i < frames; i++) await page.clock.runFor(frameMs);
}

/** Steps `frames` frames and calls `sample` after each one; returns the samples in order. */
export async function sampleFrames<T>(page: Page, frames: number, sample: () => Promise<T>, frameMs = FRAME_MS): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < frames; i++) {
    await page.clock.runFor(frameMs);
    out.push(await sample());
  }
  return out;
}

/** Inline state of one `.rn-col` of a host, in DOM order. */
export interface ColumnSample {
  /** `data-rn-key` (`i0` = units, `f1` = tenths, …). */
  key: string | null;
  /** `data-digit`. */
  digit: string | null;
  /** Inline `transform` of the `.rn-scale` (empty at rest). */
  transform: string;
  /** Position in cells parsed from `translateY(-N%)` (`N / 10`), `null` at rest. */
  cells: number | null;
  /** Inline `--rn-in` (enter/leave presence), `null` when absent. */
  inn: number | null;
  /** `data-rn-lead` present (leading zero). */
  lead: boolean;
}

/** Reads every owned column of `host`: key, `data-digit`, inline `.rn-scale` transform, `--rn-in`, lead marker. */
export async function readColumns(host: Locator): Promise<ColumnSample[]> {
  return host.evaluate((el) =>
    Array.from(el.querySelectorAll(':scope > .rn-col'), (col) => {
      const scale = col.querySelector(':scope > .rn-scale') as HTMLElement | null;
      const transform = scale ? scale.style.transform : '';
      const match = /translateY\(\s*(-?[\d.]+)%\s*\)/.exec(transform);
      const inn = (col as HTMLElement).style.getPropertyValue('--rn-in').trim();
      return {
        key: col.getAttribute('data-rn-key'),
        digit: col.getAttribute('data-digit'),
        transform,
        cells: match ? -Number(match[1]) / 10 : null,
        inn: inn === '' ? null : Number(inn),
        lead: col.hasAttribute('data-rn-lead')
      };
    })
  );
}

/** Inline `transform` of each `.rn-scale` of `host`, in DOM order (empty strings at rest). */
export async function readTransforms(host: Locator): Promise<string[]> {
  return (await readColumns(host)).map((c) => c.transform);
}

/** `data-digit` of each column of `host`, in DOM order. */
export async function readDigits(host: Locator): Promise<string[]> {
  return (await readColumns(host)).map((c) => c.digit ?? '');
}

/**
 * Largest per-frame movement in cells between consecutive samples of
 * {@link readColumns}, matched by `data-rn-key`, wrapping at 10 cells
 * (the 9 → 0 wrap counts as one cell, not nine).
 */
export function maxStepCells(samples: ColumnSample[][]): number {
  let max = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = new Map(samples[i - 1].map((c) => [c.key, c.cells]));
    for (const col of samples[i]) {
      const a = prev.get(col.key);
      if (a == null || col.cells == null) continue;
      const d = ((((col.cells - a + 5) % 10) + 10) % 10) - 5;
      max = Math.max(max, Math.abs(d));
    }
  }
  return max;
}

/** One `rn-start` / `rn-end` recorded on a host. */
export interface RecordedEvent {
  type: 'rn-start' | 'rn-end';
  detail: RollingNumberEventDetail;
  /** `performance.now()` in the page (fake clock) at dispatch. */
  t: number;
}

/** Handle returned by {@link recordEvents}. */
export interface EventRecorder {
  /** Every event recorded so far. */
  all(): Promise<RecordedEvent[]>;
  /**
   * Resolves with the detail of the next `rn-end` not yet consumed by a
   * previous call (it may already have fired, e.g. instant changes dispatch in
   * a microtask). Steps the clock frame by frame while waiting; throws after
   * `maxFrames` frames.
   */
  waitForEnd(page: Page, options?: { maxFrames?: number }): Promise<RollingNumberEventDetail>;
}

/** Starts recording `rn-start` / `rn-end` on `host` (idempotent per element). Call it before the change. */
export async function recordEvents(host: Locator): Promise<EventRecorder> {
  await host.evaluate((el) => {
    const target = el as unknown as { __rnLog?: unknown[] };
    if (target.__rnLog) return;
    const log: unknown[] = (target.__rnLog = []);
    for (const type of ['rn-start', 'rn-end']) {
      el.addEventListener(type, (e) => {
        log.push({ type, detail: { ...(e as CustomEvent).detail }, t: performance.now() });
      });
    }
  });
  const all = () => host.evaluate((el) => ((el as unknown as { __rnLog?: RecordedEvent[] }).__rnLog ?? []).slice());
  let consumed = 0;
  return {
    all,
    async waitForEnd(page, { maxFrames = 600 } = {}) {
      for (let frame = 0; ; frame++) {
        const ends = (await all()).filter((e) => e.type === 'rn-end');
        if (ends.length > consumed) {
          consumed++;
          return ends[consumed - 1].detail;
        }
        if (frame >= maxFrames) throw new Error(`no rn-end after ${maxFrames} frames`);
        await page.clock.runFor(FRAME_MS);
      }
    }
  };
}

/**
 * Leftover motion state on `host` after settling: inline transforms,
 * enter/leave and lead markers on owned nodes, and `data-rn-state`. Empty
 * means the DOM is at rest (§14.1: "no leftover inline styles or markers").
 */
export async function leftovers(host: Locator): Promise<string[]> {
  return host.evaluate((el) => {
    const out: string[] = [];
    if (el.hasAttribute('data-rn-state')) out.push(`data-rn-state="${el.getAttribute('data-rn-state')}"`);
    for (const node of Array.from(el.querySelectorAll('.rn-scale[style], [data-rn-in], .rn-col[style], .rn-sign[style], .rn-static[style]'))) {
      out.push(`${node.className}: ${node.getAttribute('style') ?? ''}${node.hasAttribute('data-rn-in') ? ' [data-rn-in]' : ''}`);
    }
    return out;
  });
}
