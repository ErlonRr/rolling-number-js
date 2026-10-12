/**
 * Text mode (docs/design/v1.3.md §6) in real engines: `<input>`, `<textarea>`
 * and SVG `<text>` hosts count through formatted strings, never dispatch
 * `input`/`change`, and never write into a focused control.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addCounter, FRAME_MS, inkPixels, openStage, recordEvents, setValue } from './_harness';

test.beforeEach(async ({ page }) => {
  await openStage(page);
});

/** Shown text of a text-mode host: `value` for form controls, `textContent` otherwise. */
const shown = (host: Locator): Promise<string> =>
  host.evaluate((el) => ('value' in el && typeof (el as HTMLInputElement).value === 'string' ? (el as HTMLInputElement).value : el.textContent ?? ''));

/** Steps frames until `data-rn-state` is gone; returns the text shown after each frame. */
async function runText(page: Page, host: Locator, maxFrames = 200): Promise<string[]> {
  const out = [await shown(host)];
  for (let i = 0; i < maxFrames; i++) {
    await page.clock.runFor(FRAME_MS);
    out.push(await shown(host));
    if ((await host.getAttribute('data-rn-state')) === null) return out;
  }
  throw new Error('still animating');
}

/** Records `input` / `change` events on `host` (text mode must never dispatch them). */
async function formEvents(host: Locator): Promise<() => Promise<string[]>> {
  await host.evaluate((el) => {
    const log: string[] = ((el as unknown as { formLog: string[] }).formLog = []);
    for (const type of ['input', 'change']) el.addEventListener(type, () => log.push(type));
  });
  return () => host.evaluate((el) => (el as unknown as { formLog: string[] }).formLog.slice());
}

const numeric = (s: string): number => Number(s.replace(/[^\d.-]/g, ''));

test('<input> counts through grouped values and ends on the formatted target', async ({ page }) => {
  const host = await addCounter(page, 'in', { value: 0, locale: 'en-US' }, { tag: 'input', style: 'font-size: 24px' });
  const form = await formEvents(host);
  const events = await recordEvents(host);
  expect(await host.evaluate((el) => el.rnCore!.getMode())).toBe('text');
  expect(await shown(host)).toBe('0');
  await setValue(host, 12345);
  expect(await host.getAttribute('data-rn-state')).toBe('animating');
  const frames = await runText(page, host);
  expect(frames[frames.length - 1]).toBe('12,345');
  const values = frames.map(numeric);
  for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  expect(new Set(frames).size).toBeGreaterThan(10);
  expect(frames.every((f) => /^\d{1,3}(,\d{3})*$/.test(f))).toBe(true);
  expect(await form()).toEqual([]);
  // Text mode leaves the control's role, label and class alone.
  expect(await host.evaluate((el) => [el.getAttribute('role'), el.getAttribute('aria-label'), el.className])).toEqual([null, null, '']);
  expect((await events.all()).map((e) => e.type)).toEqual(['rn-start', 'rn-end']);
});

test('<input type="number"> receives plain ASCII numbers', async ({ page }) => {
  const host = await addCounter(page, 'num', { value: 0, locale: 'de-DE', decimals: 1 }, { tag: 'input', attrs: { type: 'number' } });
  expect(await shown(host)).toBe('0.0');
  await setValue(host, 1234.5);
  const frames = await runText(page, host);
  expect(frames[frames.length - 1]).toBe('1234.5');
  expect(frames.every((f) => /^-?\d+(\.\d)?$/.test(f))).toBe(true);
});

test('<textarea> shows a currency format with affixes', async ({ page }) => {
  const host = await addCounter(
    page,
    'ta',
    { value: 0, locale: 'en-US', format: { style: 'currency', currency: 'USD' }, suffixText: ' total' },
    { tag: 'textarea' }
  );
  await setValue(host, 1234.5);
  const frames = await runText(page, host);
  expect(frames[frames.length - 1]).toBe('$1,234.50 total');
  expect(frames.every((f) => /^\$[\d,]+\.\d\d total$/.test(f))).toBe(true);
});

test('SVG <text> counts and paints', async ({ page }) => {
  const host = await addCounter(page, 'svgtext', { value: 0, suffixText: ' pts' }, { tag: 'text', style: 'font-size: 40px' });
  expect(await host.evaluate((el) => el.rnCore!.getMode())).toBe('text');
  await setValue(host, 250);
  const frames = await runText(page, host);
  expect(frames[frames.length - 1]).toBe('250 pts');
  const values = frames.map((f) => Number(f.replace(' pts', '')));
  for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  const svg = page.locator('svg:has(#svgtext)');
  expect(inkPixels(await svg.screenshot())).toBeGreaterThan(50);
});

test('a focused <input> is not written while focused; the final value lands on blur', async ({ page }) => {
  const host = await addCounter(page, 'in', { value: 5 }, { tag: 'input' });
  const events = await recordEvents(host);
  await host.focus();
  await setValue(host, 42);
  // Instant change (no motion on a focused control): events with animated: false, value deferred.
  expect(await shown(host)).toBe('5');
  expect(await host.getAttribute('data-rn-state')).toBeNull();
  expect((await events.all()).map((e) => [e.type, e.detail.animated])).toEqual([
    ['rn-start', false],
    ['rn-end', false]
  ]);
  await host.blur();
  expect(await shown(host)).toBe('42');
});

test('a user edit made while focused wins over the deferred value', async ({ page }) => {
  const host = await addCounter(page, 'in', { value: 5 }, { tag: 'input' });
  await host.focus();
  await setValue(host, 42);
  await page.keyboard.press('End');
  await page.keyboard.type('9');
  await host.blur();
  expect(await shown(host)).toBe('59');
});
