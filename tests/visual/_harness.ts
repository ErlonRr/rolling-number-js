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
// WP11 additions (see the end of the file).
import { inflateSync } from 'zlib';
import type {
  RollingNumberConfig,
  RollingNumberSetValueOptions,
  RollingNumberSettled,
  RollingNumberUpdate
} from '../../src/types';

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

// ── WP11 additions: stage pages, motion sampling, image comparison ─────────

/**
 * The part of `RollingNumberCore` the specs drive in the page. Declared
 * structurally: importing `src/core` here would pull its CSS imports into the
 * type check of the suite.
 */
export interface StageCore {
  setValue(value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<RollingNumberSettled>;
  update(options: RollingNumberUpdate): void;
  whenSettled(): Promise<RollingNumberSettled>;
  finish(): void;
  getDisplayValue(): number;
  getText(): string;
  getMode(): 'columns' | 'text';
  isAnimating(): boolean;
  destroy(): void;
}

/** What `tests/visual/fixtures/stage.js` exposes as `window.RN` (the built root entry, `/dist/rolling-number.js`). */
export interface StageModule {
  RollingNumberCore: new (host: Element, options?: RollingNumberUpdate) => StageCore;
  configureRollingNumber(config: RollingNumberConfig): void;
  injectRollingNumberStyles(root: Document | ShadowRoot): void;
  renderStaticText(options?: RollingNumberUpdate): string;
  renderStaticHTML(options?: RollingNumberUpdate, init?: { tag?: string; attrs?: Record<string, string> }): string;
}

/** Options of {@link StageApi.counter}. */
export interface StageInit {
  /** Tag of the host (default `span`); SVG tags are created in the SVG namespace inside an `<svg>`. */
  tag?: string;
  /** Inline style of the host (or of its `<svg>` wrapper for SVG hosts). */
  style?: string;
  /** Class of the host. */
  className?: string;
  /** Selector of the parent (default `#stage`). */
  parent?: string;
  /** Attributes set on the host before the core is created (e.g. an input `type`). */
  attrs?: Record<string, string>;
}

/** Helpers of the stage page (`window.stage`). */
export interface StageApi {
  /** Creates host `#id` with a core (stored as `host.rnCore`); returns the id. */
  counter(id: string, options?: RollingNumberUpdate, init?: StageInit): string;
}

declare global {
  interface Window {
    RN: StageModule;
    stage: StageApi;
    rnReady?: boolean;
  }
  interface Element {
    /** Core attached by `stage.counter()`. */
    rnCore?: StageCore;
  }
}

/** Fixture pages served by `pnpm preview` next to the demo (see vite.config.demo.ts). */
export const STAGE = '/fixtures/stage.html';

/**
 * {@link gotoFrozen} for a fixture page that sets `html[data-ready]` once the
 * built package is loaded (the stage, the CSP and the IIFE pages): navigates
 * with the clock installed, waits for readiness, then freezes time.
 */
export async function openStage(page: Page, url: string = STAGE, options: { t0?: number; settleMs?: number } = {}): Promise<void> {
  await gotoFrozen(page, url, options);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
}

/** Creates a counter on the stage page and returns its host locator. */
export async function addCounter(page: Page, id: string, options: RollingNumberUpdate = {}, init: StageInit = {}): Promise<Locator> {
  await page.evaluate(([i, o, s]) => window.stage.counter(i, o, s), [id, options, init] as const);
  return page.locator('#' + id);
}

/** Calls `setValue` on the core of `host` (the promise is not awaited). */
export async function setValue(host: Locator, value: number, animate?: boolean | RollingNumberSetValueOptions): Promise<void> {
  await host.evaluate((el, [v, a]) => void el.rnCore!.setValue(v, a), [value, animate] as const);
}

/** A non-digit owned node (`.rn-sign`, `.rn-static`) in one sample. */
export interface TokenSample {
  key: string | null;
  /** `sign`, or the `data-rn-part` of a `.rn-static`. */
  part: string;
  text: string;
  /** Inline `--rn-in`, `null` when absent. */
  inn: number | null;
  /** Rendered width (px). */
  width: number;
}

/** Column state plus its rendered width. */
export interface FrameColumn extends ColumnSample {
  width: number;
}

/** State of a host after one frame. */
export interface FrameSample {
  /** `getDisplayValue()` of the host's core (NaN without a core). */
  display: number;
  /** `data-rn-state`. */
  state: string | null;
  cols: FrameColumn[];
  tokens: TokenSample[];
  /** Visible text at rest: sign + `data-digit`s + static tokens, in DOM order. */
  text: string;
}

/** Reads one {@link FrameSample} of `host`. */
export async function sampleHost(host: Locator): Promise<FrameSample> {
  return host.evaluate((el) => {
    const cols: FrameColumn[] = [];
    const tokens: TokenSample[] = [];
    let text = '';
    for (const node of Array.from(el.children) as HTMLElement[]) {
      if (node.classList.contains('rn-col')) {
        const scale = node.querySelector(':scope > .rn-scale') as HTMLElement | null;
        const transform = scale ? scale.style.transform : '';
        const match = /translateY\(\s*(-?[\d.]+)%\s*\)/.exec(transform);
        const inn = node.style.getPropertyValue('--rn-in').trim();
        const digit = node.getAttribute('data-digit');
        cols.push({
          key: node.getAttribute('data-rn-key'),
          digit,
          transform,
          cells: match ? -Number(match[1]) / 10 : null,
          inn: inn === '' ? null : Number(inn),
          lead: node.hasAttribute('data-rn-lead'),
          width: node.getBoundingClientRect().width
        });
        text += digit ?? '';
      } else if (node.classList.contains('rn-sign') || node.classList.contains('rn-static')) {
        const inn = node.style.getPropertyValue('--rn-in').trim();
        tokens.push({
          key: node.getAttribute('data-rn-key'),
          part: node.classList.contains('rn-sign') ? 'sign' : node.getAttribute('data-rn-part') || '',
          text: node.textContent || '',
          inn: inn === '' ? null : Number(inn),
          width: node.getBoundingClientRect().width
        });
        text += node.textContent || '';
      }
    }
    // A stage host carries its core; a <rolling-number> element has getDisplayValue() itself.
    const core = el.rnCore ?? (el as Element & Partial<Pick<StageCore, 'getDisplayValue'>>);
    const display = typeof core.getDisplayValue === 'function' ? core.getDisplayValue() : NaN;
    return { display, state: el.getAttribute('data-rn-state'), cols, tokens, text };
  });
}

/**
 * Samples `host` now (frame 0: the synchronous state right after the change),
 * then after every 16 ms frame until `data-rn-state` is gone. The last sample
 * is the settled DOM. Throws after `maxFrames` frames.
 */
export async function runMotion(
  page: Page,
  host: Locator,
  options: { maxFrames?: number; onFrame?: (frame: number, sample: FrameSample) => unknown } = {}
): Promise<FrameSample[]> {
  const { maxFrames = 400, onFrame } = options;
  const out = [await sampleHost(host)];
  await onFrame?.(0, out[0]);
  for (let i = 1; i <= maxFrames; i++) {
    await page.clock.runFor(FRAME_MS);
    const s = await sampleHost(host);
    out.push(s);
    await onFrame?.(i, s);
    if (s.state === null) return out;
  }
  throw new Error(`still animating after ${maxFrames} frames`);
}

/** Summary of a motion recorded by {@link runMotion}. */
export interface MotionStats {
  /** Frames until settle. */
  frames: number;
  /** Largest per-frame movement of any column (cells; wraps at 10). */
  maxStep: number;
  /**
   * Largest cumulative backward movement of one column (cells). A step is
   * backward when it goes against the direction of the displayed magnitude
   * in that frame (`|getDisplayValue()|` rising → columns must not go down).
   */
  backward: number;
}

/** `d` folded into [-5, 5): the shortest signed distance on the 10-cell wheel. */
export const wrap5 = (d: number): number => ((((d + 5) % 10) + 10) % 10) - 5;

/**
 * Max step and backward movement of the columns over consecutive samples.
 * `exclude` lists column keys left out of the backward measure: reels
 * (§5.3) spin one way whatever the magnitude does, by design.
 */
export function motionStats(samples: FrameSample[], options: { exclude?: readonly string[] } = {}): MotionStats {
  const exclude = new Set(options.exclude ?? []);
  const cumulative = new Map<string | null, number>();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dir = Math.sign(Math.abs(b.display) - Math.abs(a.display));
    if (dir === 0) continue;
    const prev = new Map(a.cols.map((c) => [c.key, c.cells]));
    for (const col of b.cols) {
      if (col.key !== null && exclude.has(col.key)) continue;
      const from = prev.get(col.key);
      if (from == null || col.cells == null) continue;
      const d = wrap5(col.cells - from);
      if (d * dir < -0.002) cumulative.set(col.key, (cumulative.get(col.key) ?? 0) + Math.abs(d));
    }
  }
  return {
    frames: samples.length - 1,
    maxStep: maxStepCells(samples.map((s) => s.cols)),
    backward: Math.max(0, ...cumulative.values())
  };
}

/** Presence (`--rn-in`, 1 when absent) of the column or token `key` in each sample; `null` where the node does not exist. */
export function presenceOf(samples: FrameSample[], key: string): (number | null)[] {
  return samples.map((s) => {
    const node = s.cols.find((c) => c.key === key) ?? s.tokens.find((t) => t.key === key);
    return node ? (node.inn ?? 1) : null;
  });
}

/** True when the numbers never decrease (`dir` 1) / never increase (`dir` -1), within `eps`. */
export function isMonotone(values: number[], dir: 1 | -1 = 1, eps = 1e-6): boolean {
  for (let i = 1; i < values.length; i++) if ((values[i] - values[i - 1]) * dir < -eps) return false;
  return true;
}

/** Decoded image (RGBA, 8 bits per channel). */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Decodes the PNGs Playwright produces (8-bit RGB/RGBA, non-interlaced), so
 * two screenshots taken in the same run can be compared pixel by pixel. Such
 * same-run comparisons do not depend on the fonts or the rasterizer of the
 * machine, unlike stored baselines.
 */
export function decodePng(png: Buffer): Rgba {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      if (depth !== 8 || body[12] !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG (depth ${depth}, color ${color})`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = cur[x * channels];
      out[(y * width + x) * 4 + 1] = cur[x * channels + 1];
      out[(y * width + x) * 4 + 2] = cur[x * channels + 2];
      out[(y * width + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

/** Pixels whose largest channel difference exceeds `threshold` (0–255), and where they are. */
export interface ImageDiff {
  /** Differing pixels. */
  count: number;
  /** Rows that contain at least one differing pixel. */
  rows: number[];
  /** Differing pixels per row (one entry per row of the image). */
  perRow: number[];
  width: number;
  height: number;
}

/** Compares two same-size screenshots (PNG buffers) taken in the same run. */
export function diffImages(a: Buffer, b: Buffer, threshold = 0): ImageDiff {
  const x = decodePng(a);
  const y = decodePng(b);
  if (x.width !== y.width || x.height !== y.height) {
    throw new Error(`size mismatch: ${x.width}×${x.height} vs ${y.width}×${y.height}`);
  }
  let count = 0;
  const perRow = new Array<number>(x.height).fill(0);
  for (let i = 0; i < x.data.length; i += 4) {
    const d = Math.max(
      Math.abs(x.data[i] - y.data[i]),
      Math.abs(x.data[i + 1] - y.data[i + 1]),
      Math.abs(x.data[i + 2] - y.data[i + 2]),
      Math.abs(x.data[i + 3] - y.data[i + 3])
    );
    if (d > threshold) {
      count++;
      perRow[Math.floor(i / 4 / x.width)]++;
    }
  }
  const rows = perRow.flatMap((n, row) => (n > 0 ? [row] : []));
  return { count, rows, perRow, width: x.width, height: x.height };
}

/**
 * Rows of a diff where at least `fraction` of the pixels differ: horizontal
 * lines (text decorations), as opposed to glyph antialiasing noise.
 */
export function lineRows(diff: ImageDiff, fraction = 0.5): number[] {
  return diff.perRow.flatMap((n, row) => (n >= fraction * diff.width ? [row] : []));
}

/** Pixels of a screenshot that differ from `background` (RGB) by more than `threshold`, optionally inside a rectangle. */
export function inkPixels(
  png: Buffer,
  background: [number, number, number] = [255, 255, 255],
  threshold = 24,
  rect?: { x: number; y: number; width: number; height: number }
): number {
  const img = decodePng(png);
  const x0 = Math.max(0, Math.floor(rect?.x ?? 0));
  const y0 = Math.max(0, Math.floor(rect?.y ?? 0));
  const x1 = Math.min(img.width, Math.ceil(rect ? rect.x + rect.width : img.width));
  const y1 = Math.min(img.height, Math.ceil(rect ? rect.y + rect.height : img.height));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const d = Math.max(
        Math.abs(img.data[i] - background[0]),
        Math.abs(img.data[i + 1] - background[1]),
        Math.abs(img.data[i + 2] - background[2])
      );
      if (d > threshold) n++;
    }
  }
  return n;
}

/**
 * What the columns of `host` show, read from the layout (not from
 * `data-digit`): for each `.rn-col`, the text of the cell that covers the
 * middle of the column window, `?` when none does. Works with any stylesheet
 * (pinned 1.2 sheets included) and any font.
 */
export async function visibleDigits(host: Locator): Promise<string> {
  return host.evaluate((el) =>
    Array.from(el.querySelectorAll(':scope > .rn-col'), (col) => {
      const box = col.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      const cell = Array.from(col.querySelectorAll('.rn-cell')).find((c) => {
        const r = c.getBoundingClientRect();
        return r.top <= mid && r.bottom > mid;
      });
      return cell ? cell.textContent : '?';
    }).join('')
  );
}
