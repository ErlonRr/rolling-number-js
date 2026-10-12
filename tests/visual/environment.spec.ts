/**
 * The page environment around the motion: reduced motion (`emulateMedia`),
 * a background tab whose frames stop (watchdog, §8.2 step 7) and
 * `trigger: 'visible'` with a real IntersectionObserver (§8.3).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addCounter, leftovers, openStage, recordEvents, runMotion, sampleHost, setValue, stepFrames } from './_harness';

test.describe('prefers-reduced-motion: reduce', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openStage(page);
  });

  test('changes are applied at once; the events still fire, with animated: false', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 5 });
    const events = await recordEvents(host);
    for (const [to, animate] of [
      [1234, undefined],
      [-56, false]
    ] as const) {
      const sync = await host.evaluate((el, [v, a]) => {
        void el.rnCore!.setValue(v, a);
        // Read synchronously, before any frame or microtask.
        return {
          digits: Array.from(el.querySelectorAll(':scope > .rn-col'), (c) => c.getAttribute('data-digit')).join(''),
          state: el.getAttribute('data-rn-state'),
          animating: el.rnCore!.isAnimating()
        };
      }, [to, animate] as const);
      expect(sync).toEqual({ digits: String(Math.abs(to)), state: null, animating: false });
      expect(await leftovers(host)).toEqual([]);
    }
    expect((await events.all()).map((e) => [e.type, e.detail.value, e.detail.animated])).toEqual([
      ['rn-start', 1234, false],
      ['rn-end', 1234, false],
      ['rn-start', -56, false],
      ['rn-end', -56, false]
    ]);
    expect((await sampleHost(host)).text).toBe('−56');
  });

  test('the from → value intro is skipped', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 50, from: 0 });
    expect((await sampleHost(host)).text).toBe('50');
    expect(await host.getAttribute('data-rn-state')).toBeNull();
  });
});

test.describe('background tab', () => {
  test.beforeEach(async ({ page }) => {
    await openStage(page);
    // Frames stop while the tab is hidden; timers keep running (throttled). Emulated by
    // holding back requestAnimationFrame callbacks while `rnHidden` is set.
    await page.evaluate(() => {
      const w = window as unknown as { rnHidden: boolean; rnHeld: FrameRequestCallback[] };
      const raf = window.requestAnimationFrame.bind(window);
      w.rnHidden = false;
      w.rnHeld = [];
      window.requestAnimationFrame = (cb) => {
        if (!w.rnHidden) return raf(cb);
        w.rnHeld.push(cb);
        return -w.rnHeld.length;
      };
    });
  });

  /** Calls setValue in the page and keeps its outcome on the host (read back with {@link outcomeOf}). */
  const start = (host: Locator, value: number, animate?: boolean) =>
    host.evaluate((el, [v, a]) => {
      void el.rnCore!.setValue(v, a).then((r) => ((el as unknown as { outcome: unknown }).outcome = r));
    }, [value, animate] as const);
  const outcomeOf = (host: Locator) => host.evaluate((el) => (el as unknown as { outcome?: unknown }).outcome ?? null);

  const hide = (hidden: boolean) =>
    async ({ page }: { page: Page }) => {
      await page.evaluate((h) => {
        const w = window as unknown as { rnHidden: boolean; rnHeld: FrameRequestCallback[] };
        w.rnHidden = h;
        if (!h) {
          // Visible again: held frames run (a stale one must do nothing).
          const held = w.rnHeld.splice(0);
          requestAnimationFrame((t) => held.forEach((cb) => cb(t)));
        }
      }, hidden);
    };

  test('frames stopping mid-motion: the watchdog lands on the target; the next change animates again', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 0 });
    const events = await recordEvents(host);
    await start(host, 1000);
    await stepFrames(page, 3);
    expect(await host.getAttribute('data-rn-state')).toBe('animating');
    await hide(true)({ page });
    await stepFrames(page, 2);
    const frozen = await sampleHost(host);
    expect(frozen.state).toBe('animating');

    expect(await outcomeOf(host)).toBeNull();
    await page.clock.runFor(5000);
    expect(await outcomeOf(host)).toEqual({ value: 1000, completed: true });
    const settled = await sampleHost(host);
    expect(settled.text).toBe('1000');
    expect(await leftovers(host)).toEqual([]);
    expect((await events.all()).map((e) => e.type)).toEqual(['rn-start', 'rn-end']);

    await hide(false)({ page });
    await stepFrames(page, 2);
    expect((await sampleHost(host)).text).toBe('1000');
    await setValue(host, 2000);
    const samples = await runMotion(page, host);
    expect(samples.length).toBeGreaterThan(20);
    expect(samples[samples.length - 1].text).toBe('2000');
  });

  test('a change made while hidden finishes without frames', async ({ page }) => {
    const host = await addCounter(page, 'n', { value: 7 });
    const events = await recordEvents(host);
    await hide(true)({ page });
    await start(host, 99, false);
    expect(await host.getAttribute('data-rn-state')).toBe('animating');
    await page.clock.runFor(5000);
    expect(await outcomeOf(host)).toEqual({ value: 99, completed: true });
    expect((await sampleHost(host)).text).toBe('99');
    expect(await leftovers(host)).toEqual([]);
    expect((await events.all()).map((e) => [e.type, e.detail.animated])).toEqual([
      ['rn-start', false],
      ['rn-end', false]
    ]);
  });
});

test.describe("trigger: 'visible'", () => {
  test('a counter below the fold waits, then plays its intro once it scrolls into view', async ({ page }) => {
    await openStage(page);
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.getElementById('stage')!.appendChild(spacer);
    });
    const host = await addCounter(page, 'n', { value: 500, from: 0, trigger: 'visible' });
    const events = await recordEvents(host);
    await stepFrames(page, 10);
    expect((await sampleHost(host)).text).toBe('0');
    expect(await host.getAttribute('aria-label')).toBe('500');
    expect(await host.getAttribute('data-rn-state')).toBeNull();

    await host.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      await stepFrames(page, 1);
      return host.getAttribute('data-rn-state');
    }).toBe('animating');
    const samples = await runMotion(page, host);
    expect(samples[samples.length - 1].text).toBe('500');
    expect((await events.all()).map((e) => [e.type, e.detail.from, e.detail.value])).toEqual([
      ['rn-start', 0, 500],
      ['rn-end', 0, 500]
    ]);
  });
});
