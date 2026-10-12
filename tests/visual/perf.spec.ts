/**
 * Performance smoke test (docs/design/v1.3.md §11 WP11): 500 counters
 * animating together, timed per frame.
 *
 * page.clock fakes `performance.now()`, so this spec drives the frames
 * itself: `requestAnimationFrame` is replaced by a queue and the page runs
 * the queued callbacks with timestamps 16 ms apart, timing each frame with
 * the real `performance.now()`. Every frame therefore does a deterministic
 * amount of work (one 1000 ms motion = 63 frames) whatever the speed of the
 * machine's renderer, and the time measured is the scripting of the frame
 * callback: the core math plus its DOM writes. Style, layout and paint run
 * outside the callback (a forced style or layout inside it would show up
 * here as a large time, since every frame leaves invalidations behind).
 *
 * Chromium only, report-only (see below).
 * The first frame (one style read that resolves the timing, plus measuring
 * the entering nodes, i.e. the style and layout of 500 changed counters) and
 * the settle frame are reported but not budgeted.
 */
import { expect, test, type Page } from '@playwright/test';
import { STAGE } from './_harness';

/** Animates 500 counters (2 to 6 digits, some crossing zero, digits entering and leaving); returns each frame's time (ms). */
async function animate500(page: Page): Promise<{ times: number[]; wrong: number }> {
  await page.goto(STAGE);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  return page.evaluate(async () => {
    const stage = document.getElementById('stage')!;
    stage.style.cssText = 'font-size: 14px; display: grid; grid-template-columns: repeat(20, 1fr); gap: 4px';
    const cores = [];
    const targets: number[] = [];
    for (let i = 0; i < 500; i++) {
      const el = document.createElement('span');
      stage.appendChild(el);
      cores.push(new window.RN.RollingNumberCore(el, { value: (i * 7919) % 10000, duration: 1000 }));
      targets.push(i % 5 === 0 ? -((i * 104729) % 100000) : (i * 104729) % 100000);
    }
    // Let the page render once, then take over the frames.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const queue: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (cb) => queue.push(cb);
    window.cancelAnimationFrame = () => {};

    const settled = Promise.all(cores.map((core, i) => core.setValue(targets[i])));
    const times: number[] = [];
    let t = performance.now();
    for (let frame = 0; frame < 200 && queue.length > 0; frame++) {
      const callbacks = queue.splice(0);
      t += 16;
      const t0 = performance.now();
      for (const cb of callbacks) cb(t);
      times.push(performance.now() - t0);
    }
    await settled;
    const wrong = cores.filter((core, i) => core.getDisplayValue() !== targets[i]).length;
    return { times, wrong };
  });
}

function summary(times: number[]) {
  // The first frame resolves the timing (one style read) and measures entering nodes; the last one settles 500 hosts.
  const steady = times.slice(1, -1).sort((a, b) => a - b);
  return {
    frames: times.length,
    first: times[0],
    last: times[times.length - 1],
    median: steady[Math.floor(steady.length / 2)],
    p90: steady[Math.floor(steady.length * 0.9)]
  };
}

const describe = (s: ReturnType<typeof summary>) =>
  `frames ${s.frames}, first ${s.first.toFixed(1)} ms, median ${s.median.toFixed(2)} ms, p90 ${s.p90.toFixed(2)} ms, last ${s.last.toFixed(1)} ms`;

/**
 * Report-only: the §11 WP11 budget (≤ 4 ms of scripting per steady frame) is
 * not asserted, because the numbers depend on the machine and its load. The
 * per-frame times are attached to the report as annotations; the test only
 * asserts that every counter ends exactly on its target.
 */
test('500 counters: settle exactly (per-frame scripting times reported)', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'timed on Chromium only');
  const result = await animate500(page);
  const s = summary(result.times);
  info.annotations.push({ type: 'perf', description: describe(s) + ' (budget 4 ms, not asserted)' });
  console.log(`[perf] 500 counters: ${describe(s)}`);
  expect(result.wrong).toBe(0);
});
