/**
 * Frame scenarios of docs/design/v1.3.md §14.1, replayed on the built package
 * under `page.clock` (16 ms frames). Every motion is driven by rAF, so each
 * step is one rendered frame.
 *
 * Asserted through the inline state the core writes (the `.rn-scale`
 * transforms, `--rn-in`, `data-digit`) and the public API (`getDisplayValue`):
 * - the exact final DOM: digits, sign, affixes, sizer text, `aria-label`;
 * - no leftover inline style, `data-rn-in`/`data-rn-lead` or `data-rn-state`;
 * - the largest per-frame step (cells), against the §14.1 measurements;
 * - no backward motion where §14.1 measured none, and the bounded
 *   partial-carry undo on retargets (≤ 1.1 cells cumulative, §5.5, §11 WP1 d);
 * - enter/leave, sign and overflow fades that change monotonically.
 *
 * A few chosen frames are attached to the HTML report as screenshots, for
 * review only: assertions never depend on stored images (see README of the
 * suite in AGENTS.md).
 */
import { expect, test, type Locator, type TestInfo } from '@playwright/test';
import type { RollingNumberUpdate } from '../../src/types';
import {
  addCounter,
  isMonotone,
  leftovers,
  motionStats,
  openStage,
  presenceOf,
  recordEvents,
  runMotion,
  sampleHost,
  setValue,
  stepFrames,
  wrap5,
  type FrameSample
} from './_harness';

/** §14.1 step bounds are measured values: allow 10% for frame-phase differences between engines. */
const bound = (measured: number): number => measured * 1.1 + 0.005;

/**
 * Keys of the integer columns that run as reels (§5.3) for a default-timed
 * count `A0 → A1` (integers): true travel `T_k > max(10, L)`, with
 * `L = V_MAX·D/E'max = 0.04·D/3` for ease-out-cubic. Reels spin one way by
 * design, so they are left out of the backward measure.
 */
function reelKeys(A0: number, A1: number, D = 400): string[] {
  const L = (0.04 * D) / 3;
  const M0 = Math.abs(A0);
  const M1 = Math.abs(A1);
  const cross = A0 * A1 < 0;
  const keys: string[] = [];
  for (let k = 0, P = 1; P <= Math.max(M0, M1); k++, P *= 10) {
    const T = cross ? Math.floor(M0 / P) + Math.floor(M1 / P) : Math.abs(Math.floor(M1 / P) - Math.floor(M0 / P));
    if (T > Math.max(10, L)) keys.push('i' + k);
  }
  return keys;
}

/** The exact settled DOM shared by every scenario. */
async function expectAtRest(host: Locator, text: string, label: string): Promise<FrameSample> {
  const last = await sampleHost(host);
  expect(last.text).toBe(text);
  expect(last.state).toBeNull();
  expect(last.cols.every((c) => c.transform === '' && c.inn === null && !c.lead)).toBe(true);
  expect(last.tokens.every((t) => t.inn === null)).toBe(true);
  expect(await leftovers(host)).toEqual([]);
  await expect(host).not.toHaveClass(/rn-interpolating/);
  await expect(host).toHaveAttribute('aria-label', label);
  // The sizer holds the digit at rest (stable width, 1.x scrapers).
  const sizers = await host.evaluate((el) =>
    Array.from(el.querySelectorAll(':scope > .rn-col'), (c) => [c.getAttribute('data-digit'), c.querySelector('.rn-sizer')?.textContent])
  );
  for (const [digit, sizer] of sizers) expect(sizer).toBe(digit);
  expect(await host.evaluate((el) => el.rnCore!.isAnimating())).toBe(false);
  return last;
}

/** Attaches screenshots of `host` taken at the chosen frames (report only). */
function filmstrip(info: TestInfo, host: Locator, name: string, frames: number[]) {
  return async (frame: number): Promise<void> => {
    if (!frames.includes(frame) || info.project.name !== 'chromium') return;
    await info.attach(`${name} · frame ${frame}`, { body: await host.screenshot(), contentType: 'image/png' });
  };
}

/** Number of samples where a presence is strictly between 0 and 1. */
const partial = (values: (number | null)[]): number => values.filter((v) => v !== null && v > 0.001 && v < 0.999).length;

interface CountCase {
  name: string;
  init: RollingNumberUpdate & { value: number };
  to: number;
  text: string;
  label: string;
  /** §14.1 measured max step (cells per frame). */
  maxStep: number;
  /** Displayed value when the motion starts (`detail.from`): the clamped display. */
  from?: number;
  check?: (samples: FrameSample[]) => void;
}

const COUNT: CountCase[] = [
  {
    name: '19→20: tens and units in lockstep through the wrap cell',
    init: { value: 19 },
    to: 20,
    text: '20',
    label: '20',
    maxStep: 0.115,
    check(samples) {
      const moving = samples.filter((s) => s.state !== null && s.cols.every((c) => c.cells !== null));
      expect(moving.length).toBeGreaterThan(20);
      for (const s of moving) {
        const [tens, units] = s.cols;
        expect([tens.key, units.key]).toEqual(['i1', 'i0']);
        // Units 9 → 10 (the wrap cell holds the 0) while tens 1 → 2: same fraction in every frame.
        expect(Math.abs(wrap5(units.cells! - 9 - (tens.cells! - 1)))).toBeLessThan(0.002);
      }
      expect(moving.some((s) => s.cols[1].cells! > 9.5 && s.cols[1].cells! < 10)).toBe(true);
    }
  },
  {
    name: '99→100: the hundreds column grows in from blank on the left',
    init: { value: 99 },
    to: 100,
    text: '100',
    label: '100',
    maxStep: 0.115,
    check(samples) {
      const moving = samples.slice(0, -1);
      for (const s of moving) expect(s.cols.map((c) => c.key)).toEqual(['i2', 'i1', 'i0']);
      const inn = presenceOf(moving, 'i2') as number[];
      expect(inn[0]).toBe(0);
      expect(inn[2]).toBeGreaterThan(0.1);
      expect(inn[2]).toBeLessThan(0.13);
      expect(isMonotone(inn)).toBe(true);
      expect(isMonotone(moving.map((s) => s.cols[0].width))).toBe(true);
      expect(moving[0].cols[0].width).toBe(0);
      expect(moving.every((s) => s.cols[0].lead)).toBe(true);
    }
  },
  { name: '0→1000', init: { value: 0 }, to: 1000, text: '1000', label: '1000', maxStep: 1.15 },
  {
    name: '5→−5: the sign fades in',
    init: { value: 5 },
    to: -5,
    text: '−5',
    label: '-5',
    maxStep: 1.15,
    check(samples) {
      const sign = presenceOf(samples.slice(0, -1), 'sign') as number[];
      expect(sign.every((v) => v !== null)).toBe(true);
      expect(isMonotone(sign)).toBe(true);
      expect(partial(sign)).toBeGreaterThanOrEqual(10); // §14.1: partial for 17 frames
    }
  },
  {
    name: '−50→50: the sign fades out over several frames (no pop)',
    init: { value: -50 },
    to: 50,
    text: '50',
    label: '50',
    maxStep: 1.15,
    check(samples) {
      const sign = presenceOf(samples.slice(0, -1), 'sign') as number[];
      expect(isMonotone(sign, -1)).toBe(true);
      expect(partial(sign)).toBeGreaterThanOrEqual(3); // §14.1: 5 frames
    }
  },
  { name: '−1000→1000', init: { value: -1000 }, to: 1000, text: '1000', label: '1000', maxStep: 1.15 },
  {
    name: '1.25→3.50 with decimals: 2',
    init: { value: 1.25, decimals: 2 },
    to: 3.5,
    text: '3.50',
    label: '3.50',
    maxStep: 1.73,
    check(samples) {
      const last = samples[samples.length - 1];
      expect(last.cols.map((c) => c.key)).toEqual(['i0', 'f1', 'f2']);
      expect(last.tokens.map((t) => [t.part, t.text])).toEqual([['decimal', '.']]);
    }
  },
  { name: '0→9,876,543 (reels)', init: { value: 0 }, to: 9876543, text: '9876543', label: '9876543', maxStep: 2.08 },
  {
    name: '1000→995: the thousands column leaves',
    init: { value: 1000 },
    to: 995,
    text: '995',
    label: '995',
    maxStep: 0.58,
    check(samples) {
      const inn = presenceOf(samples.slice(0, -1), 'i3') as number[];
      expect(isMonotone(inn, -1)).toBe(true);
      expect(inn[inn.length - 1]).toBe(0);
      expect(samples[samples.length - 1].cols.map((c) => c.key)).toEqual(['i2', 'i1', 'i0']);
    }
  },
  {
    name: '95→150, max 99: the overflow suffix fades in',
    init: { value: 95, max: 99, overflowSuffix: '+' },
    to: 150,
    text: '99+',
    label: '150',
    maxStep: 0.46,
    check(samples) {
      const ovf = presenceOf(samples.slice(0, -1), 'ovf') as number[];
      expect(isMonotone(ovf)).toBe(true);
      expect(partial(ovf)).toBeGreaterThanOrEqual(10); // §14.1: 20 frames
    }
  },
  {
    name: '150→20, max 99: the overflow suffix leaves',
    init: { value: 150, max: 99, overflowSuffix: '+' },
    to: 20,
    text: '20',
    label: '20',
    maxStep: 2.19,
    from: 99,
    check(samples) {
      expect(samples[0].text).toBe('99+');
      expect(isMonotone(presenceOf(samples.slice(0, -1), 'ovf') as number[], -1)).toBe(true);
    }
  },
  {
    name: '0→1000 over 2000 ms',
    init: { value: 0, duration: 2000 },
    to: 1000,
    text: '1000',
    label: '1000',
    maxStep: 0.48,
    check(samples) {
      expect(samples.length).toBeGreaterThan(120);
    }
  }
];

test.describe('count path (§14.1)', () => {
  test.beforeEach(async ({ page }) => {
    await openStage(page);
  });

  for (const c of COUNT) {
    test(c.name, async ({ page }, info) => {
      const host = await addCounter(page, 'n', c.init);
      const events = await recordEvents(host);
      await setValue(host, c.to);
      const film = c.name.startsWith('19→20') || c.name.startsWith('99→100') || c.name.startsWith('−50→50');
      const samples = await runMotion(page, host, film ? { onFrame: filmstrip(info, host, c.name.split(':')[0], [0, 4, 8, 14]) } : {});
      const stats = motionStats(samples, { exclude: reelKeys(c.init.value, c.to, c.init.duration ?? 400) });
      info.annotations.push({ type: 'stats', description: JSON.stringify(stats) });

      await expectAtRest(host, c.text, c.label);
      expect(stats.maxStep).toBeLessThanOrEqual(bound(c.maxStep));
      expect(stats.backward).toBeLessThanOrEqual(0.002);
      expect(samples.slice(0, -1).every((s) => s.state === 'animating')).toBe(true);
      c.check?.(samples);
      const log = await events.all();
      expect(log.map((e) => e.type)).toEqual(['rn-start', 'rn-end']);
      expect(log[1].detail).toEqual({ value: c.to, from: c.from ?? c.init.value, animated: true });
    });
  }
});

interface RetargetCase {
  name: string;
  from: number;
  first: number;
  /** Frames before the retarget. */
  after: number;
  /** New target relative to the rounded displayed value, or absolute. */
  delta?: number;
  to?: number;
  maxStep: number;
  /** Cumulative backward bound (cells): 0 where §14.1 measured none. */
  backward: number;
}

// §14.1 "Retargets R1–R10" (the critic-B cases), each re-planned from the display.
const RETARGETS: RetargetCase[] = [
  { name: 'R1 0→10000, at 80 ms → display+50', from: 0, first: 10000, after: 5, delta: 50, maxStep: 2.42, backward: 1.1 },
  { name: 'R2 0→10000, at 80 ms → display+20', from: 0, first: 10000, after: 5, delta: 20, maxStep: 2.42, backward: 1.1 },
  { name: 'R3 0→10000, at 80 ms → display+7', from: 0, first: 10000, after: 5, delta: 7, maxStep: 2.42, backward: 1.1 },
  { name: 'R4 0→1000, at 64 ms → display+3', from: 0, first: 1000, after: 4, delta: 3, maxStep: 2.42, backward: 1.1 },
  { name: 'R5 0→100000, at 112 ms → display+130', from: 0, first: 100000, after: 7, delta: 130, maxStep: 2.42, backward: 1.1 },
  { name: 'R6 0→1000, at 64 ms → display−40 (reversal)', from: 0, first: 1000, after: 4, delta: -40, maxStep: 1.15, backward: 0.002 },
  { name: 'R7 0→100, at 48 ms → display+1', from: 0, first: 100, after: 3, delta: 1, maxStep: 2.42, backward: 1.1 },
  { name: 'R8 0→1000, at 96 ms → display+1000', from: 0, first: 1000, after: 6, delta: 1000, maxStep: 1.15, backward: 0.002 },
  { name: 'R9 500→0, at 96 ms → display+5', from: 500, first: 0, after: 6, delta: 5, maxStep: 2.42, backward: 1.1 },
  { name: 'R10 0→100, at 160 ms → 300', from: 0, first: 100, after: 10, to: 300, maxStep: 1.15, backward: 0.002 }
];

test.describe('retargets (§14.1, §5.5, §5.6)', () => {
  test.beforeEach(async ({ page }) => {
    await openStage(page);
  });

  for (const r of RETARGETS) {
    test(r.name, async ({ page }, info) => {
      const host = await addCounter(page, 'n', { value: r.from });
      const events = await recordEvents(host);
      const firstOutcome = host.evaluate((el, v) => el.rnCore!.setValue(v), r.first);
      const samples = [await sampleHost(host)];
      for (let i = 0; i < r.after; i++) {
        await stepFrames(page, 1);
        samples.push(await sampleHost(host));
      }
      const to = r.to ?? Math.round(samples[samples.length - 1].display) + r.delta!;
      await setValue(host, to);
      samples.push(...(await runMotion(page, host)));
      const stats = motionStats(samples);
      info.annotations.push({ type: 'stats', description: JSON.stringify({ to, ...stats }) });

      await expectAtRest(host, String(to), String(to));
      expect(stats.maxStep).toBeLessThanOrEqual(bound(r.maxStep));
      expect(stats.backward).toBeLessThanOrEqual(r.backward);
      expect(await firstOutcome).toEqual({ value: r.first, completed: false });
      // A retarget does not restart the session: one rn-start, one rn-end.
      const log = await events.all();
      expect(log.map((e) => e.type)).toEqual(['rn-start', 'rn-end']);
      expect(log[1].detail).toEqual({ value: to, from: r.from, animated: true });
    });
  }

  test('R11 eight rapid +1 clicks, 48 ms apart', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 0 });
    const samples = [await sampleHost(host)];
    for (let v = 1; v <= 8; v++) {
      await setValue(host, v);
      for (let i = 0; i < 3; i++) {
        await stepFrames(page, 1);
        samples.push(await sampleHost(host));
      }
    }
    samples.push(...(await runMotion(page, host)));
    const stats = motionStats(samples);
    await expectAtRest(host, '8', '8');
    expect(stats.maxStep).toBeLessThanOrEqual(bound(0.32));
    expect(stats.backward).toBeLessThanOrEqual(0.002);
  });
});

/** Signed travel of a column over the samples (cells, wrap-aware). */
function travel(samples: FrameSample[], key: string): { total: number; steps: number[] } {
  const steps: number[] = [];
  let prev: number | null = null;
  for (const s of samples) {
    const cells = s.cols.find((c) => c.key === key)?.cells ?? null;
    if (prev !== null && cells !== null) steps.push(wrap5(cells - prev));
    if (cells !== null) prev = cells;
  }
  return { total: steps.reduce((a, b) => a + b, 0), steps };
}

test.describe('roll path (interpolate: false, §5.7)', () => {
  test.beforeEach(async ({ page }) => {
    await openStage(page);
  });

  test('17→22 is pinned synchronously, then rolls forward through 9 → 0', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 17 });
    const events = await recordEvents(host);
    await setValue(host, 22, false);
    // Before any frame: data-digit is the target (1.2 compatibility), the transforms
    // pin the digits on screen (no flash of the target, crit-B H4).
    const sync = await host.evaluate((el) => {
      const cols = Array.from(el.querySelectorAll<HTMLElement>(':scope > .rn-col'));
      return cols.map((col) => {
        const scale = col.querySelector<HTMLElement>('.rn-scale')!;
        return {
          digit: col.getAttribute('data-digit'),
          offset: (scale.getBoundingClientRect().top - col.getBoundingClientRect().top) / col.getBoundingClientRect().height
        };
      });
    });
    expect(sync.map((c) => c.digit)).toEqual(['2', '2']);
    expect(sync.map((c) => Math.round(c.offset * 1000) / 1000)).toEqual([-1, -7]);
    expect(await host.evaluate((el) => el.rnCore!.isAnimating())).toBe(true);

    const samples = await runMotion(page, host);
    await expectAtRest(host, '22', '22');
    const stats = motionStats(samples);
    expect(stats.maxStep).toBeLessThanOrEqual(bound(0.78));
    const units = travel(samples, 'i0');
    expect(units.steps.every((d) => d >= -1e-6)).toBe(true); // forward only (B19)
    expect(units.total).toBeCloseTo(5, 2); // 7 → 8 → 9 → 0 → 1 → 2
    expect(travel(samples, 'i1').total).toBeCloseTo(1, 2);
    const log = await events.all();
    expect(log.map((e) => [e.type, e.detail.animated])).toEqual([
      ['rn-start', true],
      ['rn-end', true]
    ]);
  });

  test('99→100 keeps the units and tens nodes, and the hundreds enters on the left (B18)', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 99 });
    await host.evaluate((el) => {
      for (const col of Array.from(el.querySelectorAll<HTMLElement>('.rn-col'))) col.dataset.mark = col.dataset.rnKey;
    });
    await setValue(host, 100, false);
    const samples = await runMotion(page, host);
    await expectAtRest(host, '100', '100');
    expect(motionStats(samples).maxStep).toBeLessThanOrEqual(bound(0.78));
    expect(travel(samples, 'i0').total).toBeCloseTo(1, 2); // 9 → 0 forward
    expect(travel(samples, 'i1').total).toBeCloseTo(1, 2);
    expect(isMonotone(presenceOf(samples.slice(0, -1), 'i2') as number[])).toBe(true);
    const marks = await host.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('.rn-col'), (c) => c.dataset.mark ?? null));
    expect(marks).toEqual([null, 'i1', 'i0']);
  });

  test('100→99 rolls back through 0 → 9 and the hundreds leaves', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 100 });
    await setValue(host, 99, false);
    const samples = await runMotion(page, host);
    await expectAtRest(host, '99', '99');
    expect(motionStats(samples).maxStep).toBeLessThanOrEqual(bound(0.78));
    expect(travel(samples, 'i0').total).toBeCloseTo(-1, 2);
    expect(isMonotone(presenceOf(samples.slice(0, -1), 'i2') as number[], -1)).toBe(true);
  });

  test('5→−5 fades the sign in', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 5 });
    await setValue(host, -5, false);
    const samples = await runMotion(page, host);
    await expectAtRest(host, '−5', '-5');
    const sign = presenceOf(samples.slice(0, -1), 'sign') as number[];
    expect(isMonotone(sign)).toBe(true);
    expect(partial(sign)).toBeGreaterThanOrEqual(10);
  });

  test('roll retarget 10→90, at 80 ms → 20', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 10 });
    await setValue(host, 90, false);
    const samples = [await sampleHost(host)];
    for (let i = 0; i < 5; i++) {
      await stepFrames(page, 1);
      samples.push(await sampleHost(host));
    }
    await setValue(host, 20, false);
    samples.push(...(await runMotion(page, host)));
    await expectAtRest(host, '20', '20');
    expect(motionStats(samples).maxStep).toBeLessThanOrEqual(bound(1.75));
  });

  test('count → roll: 0→1000, at 80 ms roll → 500', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 0 });
    await setValue(host, 1000);
    const samples = [await sampleHost(host)];
    for (let i = 0; i < 5; i++) {
      await stepFrames(page, 1);
      samples.push(await sampleHost(host));
    }
    await setValue(host, 500, false);
    samples.push(...(await runMotion(page, host)));
    await expectAtRest(host, '500', '500');
    expect(motionStats(samples).maxStep).toBeLessThanOrEqual(bound(1.75));
  });

  test('roll → count: 0→90 rolling, at 80 ms count → 300', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 0 });
    await setValue(host, 90, false);
    const samples = [await sampleHost(host)];
    for (let i = 0; i < 5; i++) {
      await stepFrames(page, 1);
      samples.push(await sampleHost(host));
    }
    await setValue(host, 300);
    samples.push(...(await runMotion(page, host)));
    await expectAtRest(host, '300', '300');
    expect(motionStats(samples).maxStep).toBeLessThanOrEqual(bound(1.75));
  });
});

test.describe('geometry while moving', () => {
  // Client rects include transforms and zoom; --rn-w must be a layout width, or the
  // entering nodes grow past (scale > 1) or short of (scale < 1) their final width.
  for (const style of ['transform: scale(2); transform-origin: 0 0', 'transform: scale(0.5); transform-origin: 0 0', 'zoom: 2']) {
    test(`entering nodes grow to their layout width under ${style}`, async ({ page }) => {
      await openStage(page);
      const host = await addCounter(page, 'n', { value: 5, suffixText: ' kg' }, { style });
      await setValue(host, -1000, false);
      const widths: number[] = [];
      await runMotion(page, host, {
        onFrame: async () => void widths.push(await host.evaluate((el) => (el as HTMLElement).offsetWidth))
      });
      const final = widths[widths.length - 1];
      expect(isMonotone(widths, 1, 1)).toBe(true);
      expect(Math.max(...widths)).toBeLessThanOrEqual(final + 1);
      expect(widths[widths.length - 2]).toBeGreaterThanOrEqual(final - 2);
    });
  }

  test('the window shows the cell given by the inline transform, including the wrap cell', async ({ page }) => {
    await openStage(page);
    const host = await addCounter(page, 'n', { value: 19 });
    await setValue(host, 20);
    await runMotion(page, host, {
      onFrame: async (_frame, s: FrameSample) => {
        if (s.state === null) return;
        // The scale is offset by exactly `cells` cell heights inside the column (B20-proof).
        const offsets = await host.evaluate((el) =>
          Array.from(el.querySelectorAll<HTMLElement>(':scope > .rn-col'), (col) => {
            const scale = col.querySelector<HTMLElement>('.rn-scale')!;
            const h = col.getBoundingClientRect().height;
            return -(scale.getBoundingClientRect().top - col.getBoundingClientRect().top) / h;
          })
        );
        s.cols.forEach((c, i) => expect(offsets[i]).toBeCloseTo(c.cells!, 2));
      }
    });
  });
});

