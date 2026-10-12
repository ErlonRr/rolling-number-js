/**
 * Smoke test of the built demo (`pnpm build:demo`, served at `/` by
 * `pnpm preview`): it loads on the built package without errors, every
 * section renders, and the React and Vue islands animate. Real time, no fake
 * clock; external font requests are blocked so the test runs offline.
 */
import { expect, test } from '@playwright/test';

test('the demo renders every section on the built package without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The blocked font requests log "Failed to load resource"; anything else counts.
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().startsWith('Failed to load resource')) errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { demoReady?: boolean }).demoReady === true)).toBe(true);

  await expect(page.locator('#heroCounter')).toHaveAttribute('aria-label', '1234');
  expect(await page.locator('#heroCounter > .rn-col').count()).toBe(4);
  await expect(page.locator('#inputCounter')).toHaveValue('$1,520.40');
  await expect(page.locator('#textareaCounter')).toHaveValue('Total: 82 items');
  await expect(page.locator('#svgCounter')).toHaveText('9,200 pts');
  await expect(page.locator('#fmtCurrency')).toHaveAttribute('aria-label', '€1,234.50');
  await expect(page.locator('#notifCounter')).toHaveAttribute('aria-label', '7 unread notifications');
  expect(await page.locator('#stressContainer rolling-number').count()).toBe(100);

  // Islands.
  const react = page.locator('#react-island .rn-rolling-number');
  const vue = page.locator('#vue-island .rn-rolling-number');
  await expect(react).toHaveAttribute('aria-label', '$19.99');
  await expect(vue).toHaveAttribute('aria-label', '1280');
  await page.locator('#react-island button').first().click();
  await expect(react).toHaveAttribute('aria-label', '$20.99');
  await expect(page.locator('#react-island code')).toHaveText('rn-end 20.99');
  await page.locator('#vue-island button').first().click();
  await expect(page.locator('#vue-island code')).toHaveText('rn-end 1290');

  // Events and promises.
  await page.locator('#btnEvents').click();
  await expect(page.locator('#eventsLog li.end')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('#eventsLog li.promise')).toContainText('"completed":true');

  // Language switch keeps the counters.
  await page.locator('#btnLangIT').click();
  await expect(page.locator('[data-i18n="heroTitle"]')).toHaveText('Demo interattiva');
  await expect(page.locator('#spanCounter')).toHaveAttribute('aria-label', '$48,250');

  // trigger: 'visible' counters wait for the viewport.
  const band = page.locator('[data-visible="128450"]');
  await band.scrollIntoViewIfNeeded();
  await expect(band).toHaveAttribute('aria-label', '128,450');
  await expect.poll(() => band.evaluate((el) => el.hasAttribute('data-rn-state')), { timeout: 5000 }).toBe(false);
  await expect.poll(() => band.evaluate((el) => Array.from(el.querySelectorAll('.rn-col'), (c) => c.getAttribute('data-digit')).join(''))).toBe('128450');

  expect(errors).toEqual([]);
});
